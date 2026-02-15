const { google } = require('googleapis');
const bcrypt = require('bcryptjs');

const DEFAULT_SHEETS = {
  pending: 'PENDING',
  approved: 'APPROVED',
  expired: 'EXPIRED',
  rejected: 'REJECTED',
  admins: 'ADMINS',
  logs: 'LOGS'
};

const PRAYER_HEADERS = [
  'id',
  'display_name',
  'content',
  'status',
  'created_at',
  'approved_at',
  'approved_by',
  'expires_at',
  'duration_days',
  'ip_hash'
];

const ADMIN_HEADERS = [
  'id',
  'username',
  'password_hash',
  'created_at'
];

const LOG_HEADERS = [
  'id',
  'event_type',
  'prayer_id',
  'admin_username',
  'ip_hash',
  'details',
  'created_at'
];

function nowIso() {
  return new Date().toISOString();
}

function addDays(iso, days) {
  const base = iso ? new Date(iso) : new Date();
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function normalizeKey(key) {
  return key.replace(/^[@:$]/, '');
}

function buildRow(headers, data) {
  return headers.map((h) => (data[h] === undefined || data[h] === null ? '' : String(data[h])));
}

function rowsToObjects(headers, rows) {
  return rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });
}

function parseId(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sortByDateAsc(items, key) {
  return items.sort((a, b) => {
    const ad = a[key] ? new Date(a[key]).getTime() : 0;
    const bd = b[key] ? new Date(b[key]).getTime() : 0;
    return ad - bd;
  });
}

function sortByDateDesc(items, key) {
  return items.sort((a, b) => {
    const ad = a[key] ? new Date(a[key]).getTime() : 0;
    const bd = b[key] ? new Date(b[key]).getTime() : 0;
    return bd - ad;
  });
}

function generateNumericId() {
  return Math.floor(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

function normalizeEnvKey(key) {
  if (!key) return '';
  return key.replace(/\\n/g, '\n');
}

function pickTabsFromEnv() {
  return {
    pending: process.env.SHEETS_TAB_PENDING || DEFAULT_SHEETS.pending,
    approved: process.env.SHEETS_TAB_APPROVED || DEFAULT_SHEETS.approved,
    expired: process.env.SHEETS_TAB_EXPIRED || DEFAULT_SHEETS.expired,
    rejected: process.env.SHEETS_TAB_REJECTED || DEFAULT_SHEETS.rejected,
    admins: process.env.SHEETS_TAB_ADMINS || DEFAULT_SHEETS.admins,
    logs: process.env.SHEETS_TAB_LOGS || DEFAULT_SHEETS.logs
  };
}

async function initGoogleSheets() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = normalizeEnvKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('Missing Google Sheets credentials. Set GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const tabs = pickTabsFromEnv();

  async function getSheetTitles() {
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false
    });
    return res.data.sheets.map((s) => s.properties.title);
  }

  async function ensureSheet(title) {
    const titles = await getSheetTitles();
    if (titles.includes(title)) return;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    });
  }

  async function ensureHeaders(title, headers) {
    await ensureSheet(title);
    const range = `${title}!A1:${String.fromCharCode(64 + headers.length)}1`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const existing = res.data.values && res.data.values[0] ? res.data.values[0] : [];
    if (existing.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
    }
  }

  async function readAllRows(title, headers) {
    await ensureHeaders(title, headers);
    const range = `${title}!A2:${String.fromCharCode(64 + headers.length)}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];
    return rowsToObjects(headers, rows);
  }

  async function appendRow(title, headers, data) {
    await ensureHeaders(title, headers);
    const values = [buildRow(headers, data)];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });
  }

  async function overwriteRows(title, headers, rows) {
    await ensureHeaders(title, headers);
    const range = `${title}!A2:${String.fromCharCode(64 + headers.length)}`;
    const values = rows.map((row) => buildRow(headers, row));
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values }
    });
  }

  async function moveRowById(fromTitle, toTitle, headers, id, mutate) {
    const rows = await readAllRows(fromTitle, headers);
    const index = rows.findIndex((r) => String(r.id) === String(id));
    if (index === -1) return null;
    const row = rows[index];
    rows.splice(index, 1);
    if (mutate) mutate(row);
    await overwriteRows(fromTitle, headers, rows);
    await appendRow(toTitle, headers, row);
    return row;
  }

  async function updateRowById(title, headers, id, mutate) {
    const rows = await readAllRows(title, headers);
    const index = rows.findIndex((r) => String(r.id) === String(id));
    if (index === -1) return null;
    mutate(rows[index]);
    await overwriteRows(title, headers, rows);
    return rows[index];
  }

  async function refreshExpired() {
    const rows = await readAllRows(tabs.approved, PRAYER_HEADERS);
    const now = Date.now();
    const active = [];
    const expired = [];
    for (const row of rows) {
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
      if (expiresAt && expiresAt <= now) {
        row.status = 'EXPIRED';
        expired.push(row);
      } else {
        active.push(row);
      }
    }
    if (expired.length > 0) {
      await overwriteRows(tabs.approved, PRAYER_HEADERS, active);
      for (const row of expired) {
        await appendRow(tabs.expired, PRAYER_HEADERS, row);
      }
    }
    return { active, expired };
  }

  async function findPrayerById(id) {
    const collections = [
      tabs.pending,
      tabs.approved,
      tabs.expired,
      tabs.rejected
    ];
    for (const title of collections) {
      const rows = await readAllRows(title, PRAYER_HEADERS);
      const match = rows.find((r) => String(r.id) === String(id));
      if (match) return match;
    }
    return null;
  }

  async function countRecentByIp(ipHash) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    const collections = [
      tabs.pending,
      tabs.approved,
      tabs.expired,
      tabs.rejected
    ];
    let count = 0;
    for (const title of collections) {
      const rows = await readAllRows(title, PRAYER_HEADERS);
      for (const row of rows) {
        if (row.ip_hash !== ipHash) continue;
        const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
        if (createdAt > cutoff) count += 1;
      }
    }
    return count;
  }

  async function initializeAdmin() {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;

    if (!username || !password) {
      console.log('[Sheets] No ADMIN_USERNAME or ADMIN_PASSWORD, skipping admin initialization');
      return;
    }

    const admins = await readAllRows(tabs.admins, ADMIN_HEADERS);
    const existing = admins.find((a) => a.username === username);
    if (!existing) {
      const passwordHash = bcrypt.hashSync(password, 12);
      await appendRow(tabs.admins, ADMIN_HEADERS, {
        id: generateNumericId(),
        username,
        password_hash: passwordHash,
        created_at: nowIso()
      });
      console.log(`[Sheets] Created initial admin account: ${username}`);
    } else {
      console.log(`[Sheets] Admin account '${username}' already exists`);
    }
  }

  function cleanupOldData() {
    // No-op for Sheets. Keep manual cleanup simple.
  }

  const prayerOps = {
    create: {
      run: (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const id = generateNumericId();
        const row = {
          id,
          display_name: data.displayName || '',
          content: data.content || '',
          status: 'PENDING',
          created_at: nowIso(),
          approved_at: '',
          approved_by: '',
          expires_at: '',
          duration_days: data.durationDays || 7,
          ip_hash: data.ipHash || ''
        };
        return appendRow(tabs.pending, PRAYER_HEADERS, row).then(() => ({
          lastInsertRowid: id,
          changes: 1
        }));
      }
    },
    getApproved: {
      all: async () => {
        const { active } = await refreshExpired();
        const filtered = active.filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now());
        const normalized = filtered.map((r) => ({
          ...r,
          id: parseId(r.id),
          duration_days: toNumberOrNull(r.duration_days)
        }));
        return sortByDateDesc(normalized, 'approved_at');
      }
    },
    getApprovedAll: {
      all: async () => {
        const rows = await readAllRows(tabs.approved, PRAYER_HEADERS);
        const normalized = rows.map((r) => ({
          ...r,
          id: parseId(r.id),
          duration_days: toNumberOrNull(r.duration_days)
        }));
        return sortByDateDesc(normalized, 'approved_at');
      }
    },
    getExpired: {
      all: async () => {
        await refreshExpired();
        const rows = await readAllRows(tabs.expired, PRAYER_HEADERS);
        const normalized = rows.map((r) => ({
          ...r,
          id: parseId(r.id),
          duration_days: toNumberOrNull(r.duration_days)
        }));
        return sortByDateDesc(normalized, 'expires_at');
      }
    },
    getPending: {
      all: async () => {
        const rows = await readAllRows(tabs.pending, PRAYER_HEADERS);
        const normalized = rows.map((r) => ({
          ...r,
          id: parseId(r.id),
          duration_days: toNumberOrNull(r.duration_days)
        }));
        return sortByDateAsc(normalized, 'created_at');
      }
    },
    getRejected: {
      all: async () => {
        const rows = await readAllRows(tabs.rejected, PRAYER_HEADERS);
        const normalized = rows.map((r) => ({
          ...r,
          id: parseId(r.id),
          duration_days: toNumberOrNull(r.duration_days)
        }));
        return sortByDateDesc(normalized, 'approved_at');
      }
    },
    getById: {
      get: async (id) => {
        const row = await findPrayerById(id);
        if (!row) return undefined;
        return {
          ...row,
          id: parseId(row.id),
          duration_days: toNumberOrNull(row.duration_days)
        };
      }
    },
    approve: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const moved = await moveRowById(tabs.pending, tabs.approved, PRAYER_HEADERS, data.id, (row) => {
          row.status = 'APPROVED';
          row.approved_at = nowIso();
          row.approved_by = data.adminUsername || '';
          row.expires_at = addDays(row.approved_at, Number(row.duration_days || 7));
        });
        return { changes: moved ? 1 : 0 };
      }
    },
    reject: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        let moved = await moveRowById(tabs.pending, tabs.rejected, PRAYER_HEADERS, data.id, (row) => {
          row.status = 'REJECTED';
          row.approved_at = nowIso();
          row.approved_by = data.adminUsername || '';
        });
        if (!moved) {
          moved = await moveRowById(tabs.approved, tabs.rejected, PRAYER_HEADERS, data.id, (row) => {
            row.status = 'REJECTED';
            row.approved_at = nowIso();
            row.approved_by = data.adminUsername || '';
          });
        }
        return { changes: moved ? 1 : 0 };
      }
    },
    extendExpiry: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const updated = await updateRowById(tabs.approved, PRAYER_HEADERS, data.id, (row) => {
          const base = row.expires_at || nowIso();
          row.expires_at = addDays(base, 7);
        });
        return { changes: updated ? 1 : 0 };
      }
    },
    setExpiryDate: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const updated = await updateRowById(tabs.approved, PRAYER_HEADERS, data.id, (row) => {
          row.expires_at = data.expiresAt || '';
        });
        return { changes: updated ? 1 : 0 };
      }
    },
    recoverWithExpiry: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const moved = await moveRowById(tabs.rejected, tabs.approved, PRAYER_HEADERS, data.id, (row) => {
          row.status = 'APPROVED';
          row.approved_at = nowIso();
          row.approved_by = data.adminUsername || '';
          row.expires_at = data.expiresAt || addDays(row.approved_at, Number(row.duration_days || 7));
        });
        return { changes: moved ? 1 : 0 };
      }
    },
    updateContent: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        let updated = await updateRowById(tabs.pending, PRAYER_HEADERS, data.id, (row) => {
          row.display_name = data.displayName || '';
          row.content = data.content || '';
        });
        if (!updated) {
          updated = await updateRowById(tabs.approved, PRAYER_HEADERS, data.id, (row) => {
            row.display_name = data.displayName || '';
            row.content = data.content || '';
          });
        }
        return { changes: updated ? 1 : 0 };
      }
    },
    countRecentByIp: {
      get: async (ipHash) => {
        const count = await countRecentByIp(ipHash);
        return { count };
      }
    }
  };

  const adminOps = {
    getByUsername: {
      get: async (username) => {
        const rows = await readAllRows(tabs.admins, ADMIN_HEADERS);
        const admin = rows.find((r) => r.username === username);
        if (!admin) return undefined;
        return {
          id: parseId(admin.id),
          username: admin.username,
          password_hash: admin.password_hash,
          created_at: admin.created_at
        };
      }
    },
    getById: {
      get: async (id) => {
        const rows = await readAllRows(tabs.admins, ADMIN_HEADERS);
        const admin = rows.find((r) => String(r.id) === String(id));
        if (!admin) return undefined;
        return {
          id: parseId(admin.id),
          username: admin.username,
          created_at: admin.created_at
        };
      }
    },
    getAll: {
      all: async () => {
        const rows = await readAllRows(tabs.admins, ADMIN_HEADERS);
        return rows.map((r) => ({
          id: parseId(r.id),
          username: r.username,
          created_at: r.created_at
        }));
      }
    },
    create: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const row = {
          id: generateNumericId(),
          username: data.username || '',
          password_hash: data.passwordHash || '',
          created_at: nowIso()
        };
        await appendRow(tabs.admins, ADMIN_HEADERS, row);
        return { changes: 1 };
      }
    },
    updatePassword: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const updated = await updateRowById(tabs.admins, ADMIN_HEADERS, data.id, (row) => {
          row.password_hash = data.passwordHash || row.password_hash;
        });
        return { changes: updated ? 1 : 0 };
      }
    },
    delete: {
      run: async (id) => {
        const rows = await readAllRows(tabs.admins, ADMIN_HEADERS);
        const filtered = rows.filter((r) => String(r.id) !== String(id));
        await overwriteRows(tabs.admins, ADMIN_HEADERS, filtered);
        return { changes: rows.length - filtered.length };
      }
    },
    count: {
      get: async () => {
        const rows = await readAllRows(tabs.admins, ADMIN_HEADERS);
        return { count: rows.length };
      }
    }
  };

  const auditOps = {
    log: {
      run: async (params) => {
        const data = {};
        for (const [key, value] of Object.entries(params || {})) {
          data[normalizeKey(key)] = value;
        }
        const row = {
          id: generateNumericId(),
          event_type: data.eventType || '',
          prayer_id: data.prayerId || '',
          admin_username: data.adminUsername || '',
          ip_hash: data.ipHash || '',
          details: data.details || '',
          created_at: nowIso()
        };
        await appendRow(tabs.logs, LOG_HEADERS, row);
        return { changes: 1 };
      }
    },
    getRecent: {
      all: async (limit) => {
        const rows = await readAllRows(tabs.logs, LOG_HEADERS);
        const sorted = sortByDateDesc(rows, 'created_at');
        return sorted.slice(0, Number(limit) || 50);
      }
    }
  };

  await ensureHeaders(tabs.pending, PRAYER_HEADERS);
  await ensureHeaders(tabs.approved, PRAYER_HEADERS);
  await ensureHeaders(tabs.expired, PRAYER_HEADERS);
  await ensureHeaders(tabs.rejected, PRAYER_HEADERS);
  await ensureHeaders(tabs.admins, ADMIN_HEADERS);
  await ensureHeaders(tabs.logs, LOG_HEADERS);

  return {
    db: null,
    initializeAdmin,
    cleanupOldData,
    prayerOps,
    adminOps,
    auditOps
  };
}

module.exports = initGoogleSheets;
