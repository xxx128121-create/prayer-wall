const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const initGoogleSheets = require('./google-sheets');

// Ensure db directory exists
const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'prayer-wall.db');

// Helper: convert row arrays to objects
function toObject(columns, values) {
  const obj = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });
  return obj;
}

// Helper: convert better-sqlite3 style params to sql.js style
// better-sqlite3: { displayName: 'x' } with SQL @displayName
// sql.js: { '@displayName': 'x' } with SQL @displayName
function convertParams(params) {
  if (params === undefined || params === null) return undefined;
  if (typeof params !== 'object' || Array.isArray(params)) {
    return Array.isArray(params) ? params : [params];
  }
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    const prefixed = key.startsWith('@') || key.startsWith('$') || key.startsWith(':')
      ? key : '@' + key;
    result[prefixed] = value === undefined ? null : value;
  }
  return result;
}

// Create a prepared statement wrapper that mimics better-sqlite3 API
function createStatement(db, sql, saveDb) {
  return {
    run(params) {
      const converted = convertParams(params);
      if (converted !== undefined) {
        db.run(sql, converted);
      } else {
        db.run(sql);
      }
      const lastInsertRowid = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
      const changes = db.getRowsModified();
      saveDb();
      return { lastInsertRowid, changes };
    },
    get(params) {
      const converted = convertParams(params);
      let stmt;
      try {
        stmt = db.prepare(sql);
        if (converted !== undefined) {
          stmt.bind(converted);
        }
        if (stmt.step()) {
          const columns = stmt.getColumnNames();
          const values = stmt.get();
          return toObject(columns, values);
        }
        return undefined;
      } finally {
        if (stmt) stmt.free();
      }
    },
    all(params) {
      const converted = convertParams(params);
      const results = [];
      let stmt;
      try {
        stmt = db.prepare(sql);
        if (converted !== undefined) {
          stmt.bind(converted);
        }
        while (stmt.step()) {
          const columns = stmt.getColumnNames();
          const values = stmt.get();
          results.push(toObject(columns, values));
        }
        return results;
      } finally {
        if (stmt) stmt.free();
      }
    }
  };
}

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing DB or create new
  let db;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Save database to disk
  function saveDb() {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  // Helper to create prepared statements bound to this db
  function prepare(sql) {
    return createStatement(db, sql, saveDb);
  }

  // Create tables
  db.run(`
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      prayer_id INTEGER,
      admin_username TEXT,
      ip_hash TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_prayers_status ON prayers(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_prayers_created_at ON prayers(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_prayers_expires_at ON prayers(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)');

  saveDb();

  // Migration: Check if duration_days exists, if not add it (for existing dbs)
  try {
    const tableInfo = db.exec("PRAGMA table_info(prayers)");
    if (tableInfo.length > 0) {
      const columns = tableInfo[0].columns;
      const nameIdx = columns.indexOf('name');
      const hasDurationDays = tableInfo[0].values.some(row => row[nameIdx] === 'duration_days');
      if (!hasDurationDays) {
        console.log('[DB] Migrating: Adding duration_days column to prayers table');
        db.run('ALTER TABLE prayers ADD COLUMN duration_days INTEGER DEFAULT 7');
        saveDb();
      }
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

    const existingAdmin = prepare('SELECT id FROM admins WHERE username = ?').get(username);

    if (!existingAdmin) {
      const passwordHash = bcrypt.hashSync(password, 12);
      prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run([username, passwordHash]);
      console.log(`[DB] Created initial admin account: ${username}`);
    } else {
      console.log(`[DB] Admin account '${username}' already exists`);
    }
  }

  // Cleanup old data
  function cleanupOldData() {
    const deletedPrayers = prepare(`
      DELETE FROM prayers
      WHERE status = 'REJECTED'
      AND approved_at < datetime('now', '-60 days')
    `).run();

    const deletedLogs = prepare(`
      DELETE FROM audit_log
      WHERE created_at < datetime('now', '-60 days')
    `).run();

    if (deletedPrayers.changes > 0 || deletedLogs.changes > 0) {
      console.log(`[DB] Cleanup: Deleted ${deletedPrayers.changes} old rejected prayers, ${deletedLogs.changes} old logs`);
    }
  }

  // Prayer operations
  const prayerOps = {
    create: prepare(`
      INSERT INTO prayers (display_name, content, ip_hash, duration_days)
      VALUES (@displayName, @content, @ipHash, @durationDays)
    `),

    getApproved: prepare(`
      SELECT id, display_name, content, created_at, approved_at, expires_at
      FROM prayers
      WHERE status = 'APPROVED'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY approved_at DESC
    `),

    getApprovedAll: prepare(`
      SELECT id, display_name, content, created_at, approved_at, expires_at
      FROM prayers
      WHERE status = 'APPROVED'
      ORDER BY approved_at DESC
    `),

    getExpired: prepare(`
      SELECT id, display_name, content, created_at, approved_at, expires_at
      FROM prayers
      WHERE status = 'APPROVED'
      AND expires_at IS NOT NULL
      AND expires_at <= datetime('now')
      ORDER BY expires_at DESC
    `),

    getPending: prepare(`
      SELECT id, display_name, content, created_at, ip_hash, duration_days
      FROM prayers
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
    `),

    getRejected: prepare(`
      SELECT id, display_name, content, created_at, approved_at, approved_by
      FROM prayers
      WHERE status = 'REJECTED'
      ORDER BY approved_at DESC
      LIMIT 50
    `),

    getById: prepare(`
      SELECT * FROM prayers WHERE id = ?
    `),

    approve: prepare(`
      UPDATE prayers
      SET status = 'APPROVED',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = @adminUsername,
          expires_at = datetime('now', '+' || COALESCE(duration_days, 7) || ' days')
      WHERE id = @id AND status = 'PENDING'
    `),

    approveAll: prepare(`
      UPDATE prayers
      SET status = 'APPROVED',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = @adminUsername,
          expires_at = datetime('now', '+' || COALESCE(duration_days, 7) || ' days')
      WHERE status = 'PENDING'
    `),

    reject: prepare(`
      UPDATE prayers
      SET status = 'REJECTED', approved_at = CURRENT_TIMESTAMP, approved_by = @adminUsername
      WHERE id = @id AND (status = 'PENDING' OR status = 'APPROVED')
    `),

    extendExpiry: prepare(`
      UPDATE prayers
      SET expires_at = datetime(expires_at, '+7 days')
      WHERE id = @id AND status = 'APPROVED'
    `),

    setExpiryDate: prepare(`
      UPDATE prayers
      SET expires_at = @expiresAt
      WHERE id = @id AND status = 'APPROVED'
    `),

    recoverWithExpiry: prepare(`
      UPDATE prayers
      SET status = 'APPROVED',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = @adminUsername,
          expires_at = @expiresAt
      WHERE id = @id AND status = 'REJECTED'
    `),

    updateContent: prepare(`
      UPDATE prayers
      SET display_name = @displayName,
          content = @content
      WHERE id = @id AND status IN ('PENDING', 'APPROVED')
    `),

    countRecentByIp: prepare(`
      SELECT COUNT(*) as count
      FROM prayers
      WHERE ip_hash = ? AND created_at > datetime('now', '-5 minutes')
    `)
  };

  // Admin operations
  const adminOps = {
    getByUsername: prepare('SELECT * FROM admins WHERE username = ?'),
    getById: prepare('SELECT id, username, created_at FROM admins WHERE id = ?'),
    getAll: prepare('SELECT id, username, created_at FROM admins ORDER BY created_at'),
    create: prepare('INSERT INTO admins (username, password_hash) VALUES (@username, @passwordHash)'),
    updatePassword: prepare('UPDATE admins SET password_hash = @passwordHash WHERE id = @id'),
    delete: prepare('DELETE FROM admins WHERE id = ?'),
    count: prepare('SELECT COUNT(*) as count FROM admins')
  };

  // Audit log operations
  const auditOps = {
    log: prepare(`
      INSERT INTO audit_log (event_type, prayer_id, admin_username, ip_hash, details)
      VALUES (@eventType, @prayerId, @adminUsername, @ipHash, @details)
    `),

    getRecent: prepare(`
      SELECT * FROM audit_log
      ORDER BY created_at DESC
      LIMIT ?
    `)
  };

  return {
    db,
    initializeAdmin,
    cleanupOldData,
    prayerOps,
    adminOps,
    auditOps
  };
}

if (process.env.STORAGE_BACKEND === 'google_sheets') {
  module.exports = initGoogleSheets();
} else {
  module.exports = initDatabase();
}
