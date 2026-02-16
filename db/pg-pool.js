const { Pool } = require('pg');

let pool;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL for Postgres/Supabase connection.');
  }

  const sslDisabled = process.env.PGSSLMODE === 'disable';
  pool = new Pool({
    connectionString,
    ssl: sslDisabled ? false : { rejectUnauthorized: false }
  });

  return pool;
}

module.exports = { getPool };
