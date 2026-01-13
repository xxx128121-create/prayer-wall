const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'prayer-wall.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  -- Prayers table
  CREATE TABLE IF NOT EXISTS prayers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    approved_by TEXT,
    expires_at DATETIME,
    duration_days INTEGER DEFAULT 7,
    ip_hash TEXT
  );

  -- Admins table
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Audit log table
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    prayer_id INTEGER,
    admin_username TEXT,
    ip_hash TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_prayers_status ON prayers(status);
  CREATE INDEX IF NOT EXISTS idx_prayers_created_at ON prayers(created_at);
  CREATE INDEX IF NOT EXISTS idx_prayers_expires_at ON prayers(expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
`);

// Migration: Check if duration_days exists, if not add it (for existing dbs)
try {
  const tableInfo = db.pragma('table_info(prayers)');
  const hasDurationDays = tableInfo.some(col => col.name === 'duration_days');
  if (!hasDurationDays) {
    console.log('[DB] Migrating: Adding duration_days column to prayers table');
    db.exec('ALTER TABLE prayers ADD COLUMN duration_days INTEGER DEFAULT 7');
  }
} catch (err) {
  console.error('[DB] Migration error:', err);
}

// Initialize default admin from environment variables
function initializeAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.log('[DB] No ADMIN_USERNAME or ADMIN_PASSWORD in .env, skipping admin initialization');
    return;
  }

  // Check if admin already exists
  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);

  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    console.log(`[DB] Created initial admin account: ${username}`);
  } else {
    console.log(`[DB] Admin account '${username}' already exists`);
  }
}

// Cleanup old data (called on server start and periodically)
function cleanupOldData() {
  // Delete rejected prayers older than 60 days
  const deletedPrayers = db.prepare(`
    DELETE FROM prayers 
    WHERE status = 'REJECTED' 
    AND approved_at < datetime('now', '-60 days')
  `).run();

  // Delete audit logs older than 60 days
  const deletedLogs = db.prepare(`
    DELETE FROM audit_log 
    WHERE created_at < datetime('now', '-60 days')
  `).run();

  if (deletedPrayers.changes > 0 || deletedLogs.changes > 0) {
    console.log(`[DB] Cleanup: Deleted ${deletedPrayers.changes} old rejected prayers, ${deletedLogs.changes} old logs`);
  }
}

// Prayer operations
const prayerOps = {
  create: db.prepare(`
    INSERT INTO prayers (display_name, content, ip_hash, duration_days)
    VALUES (@displayName, @content, @ipHash, @durationDays)
  `),

  getApproved: db.prepare(`
    SELECT id, display_name, content, created_at, approved_at, expires_at
    FROM prayers 
    WHERE status = 'APPROVED'
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY approved_at DESC
  `),

  getApprovedAll: db.prepare(`
    SELECT id, display_name, content, created_at, approved_at, expires_at
    FROM prayers 
    WHERE status = 'APPROVED'
    ORDER BY approved_at DESC
  `),

  getExpired: db.prepare(`
    SELECT id, display_name, content, created_at, approved_at, expires_at
    FROM prayers 
    WHERE status = 'APPROVED'
    AND expires_at IS NOT NULL 
    AND expires_at <= datetime('now')
    ORDER BY expires_at DESC
  `),

  getPending: db.prepare(`
    SELECT id, display_name, content, created_at, ip_hash, duration_days
    FROM prayers 
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
  `),

  getRejected: db.prepare(`
    SELECT id, display_name, content, created_at, approved_at, approved_by
    FROM prayers 
    WHERE status = 'REJECTED'
    ORDER BY approved_at DESC
    LIMIT 50
  `),

  getById: db.prepare(`
    SELECT * FROM prayers WHERE id = ?
  `),

  approve: db.prepare(`
    UPDATE prayers 
    SET status = 'APPROVED', 
        approved_at = CURRENT_TIMESTAMP, 
        approved_by = @adminUsername,
        expires_at = datetime('now', '+' || COALESCE(duration_days, 7) || ' days')
    WHERE id = @id AND status = 'PENDING'
  `),

  reject: db.prepare(`
    UPDATE prayers 
    SET status = 'REJECTED', approved_at = CURRENT_TIMESTAMP, approved_by = @adminUsername
    WHERE id = @id AND (status = 'PENDING' OR status = 'APPROVED')
  `),

  extendExpiry: db.prepare(`
    UPDATE prayers 
    SET expires_at = datetime(expires_at, '+7 days')
    WHERE id = @id AND status = 'APPROVED'
  `),

  countRecentByIp: db.prepare(`
    SELECT COUNT(*) as count 
    FROM prayers 
    WHERE ip_hash = ? AND created_at > datetime('now', '-5 minutes')
  `)
};

// Admin operations
const adminOps = {
  getByUsername: db.prepare('SELECT * FROM admins WHERE username = ?'),
  getById: db.prepare('SELECT id, username, created_at FROM admins WHERE id = ?'),
  getAll: db.prepare('SELECT id, username, created_at FROM admins ORDER BY created_at'),
  create: db.prepare('INSERT INTO admins (username, password_hash) VALUES (@username, @passwordHash)'),
  updatePassword: db.prepare('UPDATE admins SET password_hash = @passwordHash WHERE id = @id'),
  delete: db.prepare('DELETE FROM admins WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) as count FROM admins')
};

// Audit log operations
const auditOps = {
  log: db.prepare(`
    INSERT INTO audit_log (event_type, prayer_id, admin_username, ip_hash, details)
    VALUES (@eventType, @prayerId, @adminUsername, @ipHash, @details)
  `),

  getRecent: db.prepare(`
    SELECT * FROM audit_log 
    ORDER BY created_at DESC 
    LIMIT ?
  `)
};

module.exports = {
  db,
  initializeAdmin,
  cleanupOldData,
  prayerOps,
  adminOps,
  auditOps
};
