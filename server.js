require("dotenv").config()
const jwt = require("jsonwebtoken")
const sanitizeHTML = require("sanitize-html")
const bcrypt = require("bcryptjs")
const cookieParser = require("cookie-parser")
const express = require("express")
const db = require("./db")

const app = express()

app.set("view engine", "ejs")
app.use(express.urlencoded({ extended: false }))
app.use(express.static("public"))
app.use(cookieParser())

// runs on every request: decode the login cookie and load the employer's company
app.use(function (req, res, next) {
  res.locals.errors = []
  res.locals.notice = ""

  try {
    req.user = jwt.verify(req.cookies.internlink, process.env.JWTSECRET)
  } catch (err) {
    req.user = false
  }

  // look the company up fresh each time, because an admin can verify it at any moment
  req.company = false
  if (req.user && req.user.companyid) {
    req.company = db.prepare("SELECT * FROM companies WHERE company_id = ?").get(req.user.companyid) || false
  }

  res.locals.user = req.user
  res.locals.company = req.company
  next()
})

/* ---------- helpers ---------- */

function clean(value) {
  if (typeof value !== "string") value = ""
  return sanitizeHTML(value.trim(), { allowedTags: [], allowedAttributes: {} })
}

function setLoginCookie(res, user) {
  const token = jwt.sign(
    { exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, userid: user.user_id, email: user.email, role: user.role, companyid: user.company_id },
    process.env.JWTSECRET
  )
  res.cookie("internlink", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24
  })
}

// only logged-in users with role 'employer' get past this (SR17: role-appropriate content)
function mustBeEmployer(req, res, next) {
  if (req.user && req.user.role === "employer" && req.company) return next()
  return res.redirect("/")
}

// employers may log in while "pending", but cannot post or screen until an admin verifies them
function mustBeVerified(req, res, next) {
  if (req.company.verification_status === "verified") return next()
  return res.redirect("/")
}

// loads a listing only if it belongs to the logged-in employer's company
function loadOwnListing(req, res, next) {
  const listing = db.prepare("SELECT * FROM listings WHERE listing_id = ? AND company_id = ?").get(req.params.id, req.company.company_id)
  if (!listing) return res.redirect("/")
  req.listing = listing
  next()
}

/* ---------- WBS 4.4.1  Company registration & verification ---------- */

app.get("/", (req, res) => {
  if (req.user && req.user.role === "employer" && req.company) {
    const listings = db
      .prepare(
        `SELECT listings.*, (SELECT COUNT(*) FROM applications WHERE applications.listing_id = listings.listing_id) AS applicant_count
         FROM listings WHERE company_id = ? ORDER BY created_at DESC`
      )
      .all(req.company.company_id)

    // placements the university has approved, which still need the employer's feedback
    const placements = db
      .prepare(
        `SELECT placements.*, student_profiles.full_name, listings.title
         FROM placements
         JOIN applications ON placements.application_id = applications.application_id
         JOIN student_profiles ON applications.student_id = student_profiles.student_id
         JOIN listings ON applications.listing_id = listings.listing_id
         WHERE listings.company_id = ? AND placements.approval_status = 'approved'`
      )
      .all(req.company.company_id)

    return res.render("dashboard", { listings, placements })
  }
  res.render("homepage")
})

app.post("/register", (req, res) => {
  const errors = []

  const companyName = clean(req.body.companyName)
  const sector = clean(req.body.sector)
  const location = clean(req.body.location)
  const email = clean(req.body.email).toLowerCase()
  const password = typeof req.body.password === "string" ? req.body.password : ""

  if (!companyName) errors.push("You must provide a company name.")
  if (!email) errors.push("You must provide an email.")
  if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.push("That email address is not valid.")
  if (email && db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) errors.push("That email is already registered.")
  if (password.length < 8) errors.push("Password must be at least 8 characters.")
  if (password.length > 70) errors.push("Password cannot exceed 70 characters.")

  if (errors.length) return res.render("homepage", { errors })

  const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10))

  // create the company AND its employer user together, or neither
  const register = db.transaction(() => {
    const companyResult = db.prepare("INSERT INTO companies (name, sector, location) VALUES (?, ?, ?)").run(companyName, sector, location)
    const userResult = db
      .prepare("INSERT INTO users (email, password_hash, role, status, company_id) VALUES (?, ?, 'employer', 'active', ?)")
      .run(email, passwordHash, companyResult.lastInsertRowid)
    return userResult.lastInsertRowid
  })

  const userId = register()
  setLoginCookie(res, db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId))
  res.redirect("/")
})

app.get("/login", (req, res) => {
  res.render("login")
})

app.post("/login", (req, res) => {
  const email = clean(req.body.email).toLowerCase()
  const password = typeof req.body.password === "string" ? req.body.password : ""
  const fail = ["Invalid email / password."]

  if (!email || !password) return res.render("login", { errors: fail })

  const found = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'employer'").get(email)
  if (!found) return res.render("login", { errors: fail })
  if (!bcrypt.compareSync(password, found.password_hash)) return res.render("login", { errors: fail })

  setLoginCookie(res, found)
  res.redirect("/")
})

app.get("/logout", (req, res) => {
  res.clearCookie("internlink")
  res.redirect("/")
})

/* ---------- WBS 4.4.2  Opportunity posting & management ---------- */

function listingValidation(req) {
  const errors = []
  req.body.title = clean(req.body.title)
  req.body.description = clean(req.body.description)
  req.body.required_skills = clean(req.body.required_skills) // comma separated, e.g. "Node, SQL"
  req.body.programme = clean(req.body.programme)
  req.body.duration = clean(req.body.duration)
  req.body.location = clean(req.body.location)
  req.body.slots = parseInt(req.body.slots, 10)

  if (!req.body.title) errors.push("You must provide a title.")
  if (!req.body.description) errors.push("You must provide a description.")
  if (!Number.isInteger(req.body.slots) || req.body.slots < 1) errors.push("Slots must be a number of 1 or more.")
  return errors
}

app.get("/create-listing", mustBeEmployer, mustBeVerified, (req, res) => {
  res.render("create-listing", { listing: {} })
})

app.post("/create-listing", mustBeEmployer, mustBeVerified, (req, res) => {
  const errors = listingValidation(req)
  if (errors.length) return res.render("create-listing", { errors, listing: req.body })

  const b = req.body
  db.prepare(
    `INSERT INTO listings (company_id, title, description, required_skills, programme, duration, slots, location, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.company.company_id, b.title, b.description, b.required_skills, b.programme, b.duration, b.slots, b.location, new Date().toISOString())

  res.redirect("/")
})

app.get("/edit-listing/:id", mustBeEmployer, mustBeVerified, loadOwnListing, (req, res) => {
  res.render("edit-listing", { listing: req.listing })
})

app.post("/edit-listing/:id", mustBeEmployer, mustBeVerified, loadOwnListing, (req, res) => {
  const errors = listingValidation(req)
  if (errors.length) return res.render("edit-listing", { errors, listing: { ...req.body, listing_id: req.listing.listing_id } })

  const b = req.body
  db.prepare(
    `UPDATE listings SET title = ?, description = ?, required_skills = ?, programme = ?, duration = ?, slots = ?, location = ?
     WHERE listing_id = ?`
  ).run(b.title, b.description, b.required_skills, b.programme, b.duration, b.slots, b.location, req.listing.listing_id)

  res.redirect("/")
})

// "delete" only closes the listing, so students' applications are never lost
app.post("/close-listing/:id", mustBeEmployer, loadOwnListing, (req, res) => {
  db.prepare("UPDATE listings SET status = 'closed' WHERE listing_id = ?").run(req.listing.listing_id)
  res.redirect("/")
})

app.post("/reopen-listing/:id", mustBeEmployer, mustBeVerified, loadOwnListing, (req, res) => {
  db.prepare("UPDATE listings SET status = 'open' WHERE listing_id = ?").run(req.listing.listing_id)
  res.redirect("/")
})

/* ---------- WBS 4.4.3  Applicant screening & shortlisting ---------- */

app.get("/listing/:id/applicants", mustBeEmployer, loadOwnListing, (req, res) => {
  const applicants = db
    .prepare(
      `SELECT applications.*, student_profiles.full_name, student_profiles.programme, student_profiles.year, student_profiles.skills
       FROM applications
       JOIN student_profiles ON applications.student_id = student_profiles.student_id
       WHERE applications.listing_id = ?
       ORDER BY applications.match_score DESC`
    )
    .all(req.listing.listing_id)

  res.render("applicants", { listing: req.listing, applicants })
})

app.post("/application/:id/decision", mustBeEmployer, mustBeVerified, (req, res) => {
  // find the application, and make sure its listing belongs to THIS employer's company
  const application = db
    .prepare(
      `SELECT applications.*, listings.company_id, listings.title, student_profiles.user_id AS student_user_id
       FROM applications
       JOIN listings ON applications.listing_id = listings.listing_id
       JOIN student_profiles ON applications.student_id = student_profiles.student_id
       WHERE applications.application_id = ?`
    )
    .get(req.params.id)

  if (!application || application.company_id !== req.company.company_id) return res.redirect("/")

  const decision = req.body.decision
  if (decision !== "shortlisted" && decision !== "rejected") return res.redirect(`/listing/${application.listing_id}/applicants`)

  db.transaction(() => {
    db.prepare("UPDATE applications SET status = ? WHERE application_id = ?").run(decision, application.application_id)
    // tell the student (Notification entity in the ERD)
    db.prepare("INSERT INTO notifications (user_id, message, sent_at) VALUES (?, ?, ?)").run(
      application.student_user_id,
      `${req.company.name} has ${decision === "shortlisted" ? "shortlisted" : "declined"} your application for "${application.title}".`,
      new Date().toISOString()
    )
  })()

  res.redirect(`/listing/${application.listing_id}/applicants`)
})

/* ---------- WBS 4.4.5  Completion & feedback recording ---------- */

app.post("/placement/:id/completion", mustBeEmployer, (req, res) => {
  const placement = db
    .prepare(
      `SELECT placements.*, listings.company_id
       FROM placements
       JOIN applications ON placements.application_id = applications.application_id
       JOIN listings ON applications.listing_id = listings.listing_id
       WHERE placements.placement_id = ?`
    )
    .get(req.params.id)

  if (!placement || placement.company_id !== req.company.company_id) return res.redirect("/")
  if (placement.approval_status !== "approved") return res.redirect("/")

  const note = clean(req.body.completion_note)
  if (note) db.prepare("UPDATE placements SET completion_note = ? WHERE placement_id = ?").run(note, placement.placement_id)

  res.redirect("/")
})

app.listen(3000, () => console.log("InternLink employer portal on http://localhost:3000"))
