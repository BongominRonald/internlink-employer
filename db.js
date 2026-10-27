// Database setup - one table per ERD entity (Figure 2 of the progress report)
const db = require("better-sqlite3")("internlink.db")
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

const createTables = db.transaction(() => {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS universities (
      university_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    )`
  ).run()

  db.prepare(
    `CREATE TABLE IF NOT EXISTS companies (
      company_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sector TEXT,
      location TEXT,
      verification_status TEXT NOT NULL DEFAULT 'pending'   -- pending | verified | rejected
    )`
  ).run()

  // ONE users table for every role. An employer is a user with role = 'employer'
  // whose company_id points at their company (the ERD has no separate Employer table).
  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,              -- student | employer | coordinator | admin
      status TEXT NOT NULL DEFAULT 'pending',
      company_id INTEGER,
      university_id INTEGER,
      FOREIGN KEY (company_id) REFERENCES companies (company_id),
      FOREIGN KEY (university_id) REFERENCES universities (university_id)
    )`
  ).run()

  db.prepare(
    `CREATE TABLE IF NOT EXISTS student_profiles (
      student_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      university_id INTEGER,
      full_name TEXT,
      student_number TEXT,
      programme TEXT,
      year INTEGER,
      skills TEXT,
      cv_path TEXT,
      FOREIGN KEY (user_id) REFERENCES users (user_id),
      FOREIGN KEY (university_id) REFERENCES universities (university_id)
    )`
  ).run()

  db.prepare(
    `CREATE TABLE IF NOT EXISTS listings (
      listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      required_skills TEXT,
      programme TEXT,
      duration TEXT,
      slots INTEGER NOT NULL DEFAULT 1,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'open',   -- open | closed
      created_at TEXT,
      FOREIGN KEY (company_id) REFERENCES companies (company_id)
    )`
  ).run()

  db.prepare(
    `CREATE TABLE IF NOT EXISTS applications (
      application_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      listing_id INTEGER NOT NULL,
      match_score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted',  -- submitted | shortlisted | rejected | accepted
      submitted_at TEXT,
      FOREIGN KEY (student_id) REFERENCES student_profiles (student_id),
      FOREIGN KEY (listing_id) REFERENCES listings (listing_id)
    )`
  ).run()

  db.prepare(
    `CREATE TABLE IF NOT EXISTS placements (
      placement_id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL UNIQUE,    -- 1 : 0..1
      approval_status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
      rejection_reason TEXT,
      start_date TEXT,
      end_date TEXT,
      completion_note TEXT,
      FOREIGN KEY (application_id) REFERENCES applications (application_id)
    )`
  ).run()

  db.prepare(
    `CREATE TABLE IF NOT EXISTS notifications (
      notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in-app',
      is_read INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users (user_id)
    )`
  ).run()
})

createTables()

module.exports = db
