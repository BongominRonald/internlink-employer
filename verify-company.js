// Stand-in for the Admin approval queue (WBS 4.7.2, built later).
// Usage:  npm run verify            -> list companies
//         npm run verify -- 1       -> verify company 1
//         npm run verify -- 1 reject
const db = require("./db")
const [id, action] = process.argv.slice(2)

if (!id) {
  console.table(db.prepare("SELECT company_id, name, verification_status FROM companies").all())
} else {
  const status = action === "reject" ? "rejected" : "verified"
  const r = db.prepare("UPDATE companies SET verification_status = ? WHERE company_id = ?").run(status, id)
  console.log(r.changes ? `Company ${id} is now ${status}` : `No company with id ${id}`)
}
