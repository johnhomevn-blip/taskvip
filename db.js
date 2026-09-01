const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'db', 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,       -- so du tinh bang VND
  exp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,           -- link4m | uptolink
  target_url TEXT NOT NULL,         -- link goc user se den sau khi hoan thanh nhiem vu that
  reward INTEGER NOT NULL,          -- so tien thuong (VND)
  exp_reward INTEGER NOT NULL DEFAULT 1,
  min_seconds INTEGER NOT NULL DEFAULT 15, -- thoi gian toi thieu hop ly de hoan thanh
  daily_limit INTEGER NOT NULL DEFAULT 2,  -- so lan toi da / user / ngay
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | completed | expired
  short_url TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  ip_created TEXT,
  ip_verified TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,        -- momo | bank | phonecard
  detail TEXT NOT NULL,        -- so dien thoai momo / so tk+ngan hang / menh gia the
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);
`);

module.exports = db;
