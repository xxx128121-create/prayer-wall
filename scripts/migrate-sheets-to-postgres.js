require('dotenv').config();

const initGoogleSheets = require('../db/google-sheets');
const initPostgres = require('../db/postgres');

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toText(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  return value;
}

function addPrayer(map, row, statusOverride) {
  const id = toNumber(row.id);
  if (!id) return false;
  if (map.has(id)) return false;

  const status = statusOverride || row.status || 'PENDING';
  const normalizedStatus = status === 'EXPIRED' ? 'APPROVED' : status;

  map.set(id, {
    id,
    display_name: toText(row.display_name),
    content: toText(row.content) || '',
    status: normalizedStatus,
    created_at: normalizeTimestamp(row.created_at),
    approved_at: normalizeTimestamp(row.approved_at),
    approved_by: toText(row.approved_by),
    expires_at: normalizeTimestamp(row.expires_at),
    duration_days: toNumber(row.duration_days) || 7,
    ip_hash: toText(row.ip_hash)
  });

  return true;
}

async function main() {
  const truncate = process.argv.includes('--truncate');

  const sheets = await initGoogleSheets();
  const pg = await initPostgres();
  const pool = pg.db;

  if (truncate) {
    console.log('[Migrate] Truncating tables...');
    await pool.query('TRUNCATE TABLE audit_log, prayers, admins RESTART IDENTITY');
  }

  console.log('[Migrate] Loading data from Google Sheets...');
  const pending = await sheets.prayerOps.getPending.all();
  const approved = await sheets.prayerOps.getApprovedAll.all();
  const expired = await sheets.prayerOps.getExpired.all();
  const rejected = await sheets.prayerOps.getRejected.all();
  const admins = await sheets.adminOps.getAll.all();
  const logs = await sheets.auditOps.getRecent.all(1000000);

  const prayerMap = new Map();
  let skipped = 0;

  for (const row of pending) if (!addPrayer(prayerMap, row, 'PENDING')) skipped += 1;
  for (const row of approved) if (!addPrayer(prayerMap, row, 'APPROVED')) skipped += 1;
  for (const row of expired) if (!addPrayer(prayerMap, row, 'APPROVED')) skipped += 1;
  for (const row of rejected) if (!addPrayer(prayerMap, row, 'REJECTED')) skipped += 1;

  const prayers = Array.from(prayerMap.values());

  console.log(`[Migrate] Prayers to insert: ${prayers.length} (skipped duplicates/invalid: ${skipped})`);
  for (const row of prayers) {
    await pool.query(
      `
        INSERT INTO prayers (
          id, display_name, content, status, created_at, approved_at, approved_by, expires_at, duration_days, ip_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        row.id,
        row.display_name,
        row.content,
        row.status,
        row.created_at,
        row.approved_at,
        row.approved_by,
        row.expires_at,
        row.duration_days,
        row.ip_hash
      ]
    );
  }

  console.log(`[Migrate] Admins to insert: ${admins.length}`);
  for (const row of admins) {
    const id = toNumber(row.id);
    if (!id) continue;
    await pool.query(
      `
        INSERT INTO admins (id, username, password_hash, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
      `,
      [id, toText(row.username), toText(row.password_hash) || '', normalizeTimestamp(row.created_at)]
    );
  }

  console.log(`[Migrate] Logs to insert: ${logs.length}`);
  for (const row of logs) {
    const id = toNumber(row.id);
    if (!id) continue;
    await pool.query(
      `
        INSERT INTO audit_log (id, event_type, prayer_id, admin_username, ip_hash, details, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        id,
        toText(row.event_type) || '',
        toNumber(row.prayer_id),
        toText(row.admin_username),
        toText(row.ip_hash),
        toText(row.details),
        normalizeTimestamp(row.created_at)
      ]
    );
  }

  await pool.query(
    "SELECT setval(pg_get_serial_sequence('prayers','id'), COALESCE((SELECT MAX(id) FROM prayers), 1))"
  );
  await pool.query(
    "SELECT setval(pg_get_serial_sequence('admins','id'), COALESCE((SELECT MAX(id) FROM admins), 1))"
  );
  await pool.query(
    "SELECT setval(pg_get_serial_sequence('audit_log','id'), COALESCE((SELECT MAX(id) FROM audit_log), 1))"
  );

  console.log('[Migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Migrate] Failed:', err);
  process.exit(1);
});
