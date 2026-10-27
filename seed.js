// Adds sample students + applications so the applicants screen has something to show.
// Run AFTER you have registered a company and posted at least one listing:  npm run seed
const bcrypt = require("bcryptjs")
const db = require("./db")

const listing = db.prepare("SELECT * FROM listings ORDER BY listing_id LIMIT 1").get()
if (!listing) {
  console.log("Post a listing first (register -> npm run verify -- 1 -> Create listing), then run the seed again.")
  process.exit(0)
}

const uni = db.prepare("INSERT INTO universities (name, location, status) VALUES ('Mbarara University of Science and Technology', 'Mbarara', 'verified')").run()
const hash = bcrypt.hashSync("student-password", 10)
const students = [
  ["Akello Grace", "grace@must.ac.ug", "BSE", 3, "Node, SQL, Git", 91],
  ["Mugisha Peter", "peter@must.ac.ug", "BSE", 3, "Java, HTML", 62],
  ["Nabirye Sarah", "sarah@must.ac.ug", "BIT", 2, "Python, Excel", 45]
]
const appIds = []
for (const [name, email, programme, year, skills, score] of students) {
  const u = db.prepare("INSERT OR IGNORE INTO users (email, password_hash, role, status, university_id) VALUES (?, ?, 'student', 'active', ?)").run(email, hash, uni.lastInsertRowid)
  const userId = u.lastInsertRowid || db.prepare("SELECT user_id FROM users WHERE email = ?").get(email).user_id
  const s = db.prepare("INSERT INTO student_profiles (user_id, university_id, full_name, programme, year, skills) VALUES (?, ?, ?, ?, ?, ?)").run(userId, uni.lastInsertRowid, name, programme, year, skills)
  const a = db.prepare("INSERT INTO applications (student_id, listing_id, match_score, submitted_at) VALUES (?, ?, ?, ?)").run(s.lastInsertRowid, listing.listing_id, score, new Date().toISOString())
  appIds.push(a.lastInsertRowid)
}

// make the first applicant an approved placement so the "completion feedback" form appears
db.prepare("UPDATE applications SET status = 'accepted' WHERE application_id = ?").run(appIds[0])
db.prepare("INSERT INTO placements (application_id, approval_status, start_date, end_date) VALUES (?, 'approved', '2026-11-16', '2027-02-12')").run(appIds[0])
console.log(`Seeded 3 applicants on listing "${listing.title}" and 1 approved placement.`)
