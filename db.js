const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Ket noi PostgreSQL qua DATABASE_URL (Railway tu dong inject)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Tao tat ca bang neu chua co
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      exp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      target_url TEXT NOT NULL,
      reward INTEGER NOT NULL,
      exp_reward INTEGER NOT NULL DEFAULT 1,
      min_seconds INTEGER NOT NULL DEFAULT 15,
      daily_limit INTEGER NOT NULL DEFAULT 2,
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      status TEXT NOT NULL DEFAULT 'pending',
      short_url TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      completed_at BIGINT,
      ip_created TEXT,
      ip_verified TEXT
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      processed_at BIGINT
    );
  `);
  console.log('Database PostgreSQL da san sang');
}

init().catch(err => {
  console.error('Loi khoi tao database:', err);
  process.exit(1);
});

// Helper: chay query va tra ve ket qua
pool.q = async (text, params) => {
  const res = await pool.query(text, params);
  return res.rows;
};

// Helper: tra ve 1 dong duy nhat (tuong duong .get() cua SQLite)
pool.get = async (text, params) => {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
};

// Helper: tra ve so rows bi anh huong (tuong duong .run() cua SQLite)
pool.run = async (text, params) => {
  const res = await pool.query(text, params);
  return { changes: res.rowCount, lastID: res.rows[0]?.id };
};

module.exports = pool;
