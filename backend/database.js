const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'soil_analysis',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});

async function testConnection() {
  const connection = await pool.getConnection();
  try { await connection.query('SELECT 1'); }
  finally { connection.release(); }
}

module.exports = { pool, testConnection };
