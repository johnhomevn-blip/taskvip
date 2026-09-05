const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      ncoin INTEGER NOT NULL DEFAULT 0,
      vcoin INTEGER NOT NULL DEFAULT 0,
      exp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0,
      phone TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      bank_account TEXT DEFAULT '',
      bank_owner TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      reg_ip TEXT DEFAULT '',
      reg_fingerprint TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS task_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '⚡',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT DEFAULT '',
      api_endpoint TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES task_categories(id),
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'link4m',
      target_url TEXT NOT NULL,
      base_reward INTEGER NOT NULL,
      exp_reward INTEGER NOT NULL DEFAULT 1,
      min_seconds INTEGER NOT NULL DEFAULT 15,
      daily_limit INTEGER NOT NULL DEFAULT 2,
      ip_daily_limit INTEGER NOT NULL DEFAULT 2,
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      status TEXT NOT NULL DEFAULT 'pending',
      short_url TEXT,
      reward_actual INTEGER DEFAULT 0,
      multiplier NUMERIC(6,4) DEFAULT 1.0,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      completed_at BIGINT,
      ip_created TEXT,
      ip_verified TEXT,
      fingerprint TEXT
    );

    CREATE TABLE IF NOT EXISTS ip_user_map (
      ip TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      PRIMARY KEY (ip, user_id)
    );

    CREATE TABLE IF NOT EXISTS fp_user_map (
      fingerprint TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      PRIMARY KEY (fingerprint, user_id)
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT DEFAULT '',
      fee INTEGER DEFAULT 0,
      created_at BIGINT NOT NULL,
      processed_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS topups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      coin_type TEXT NOT NULL DEFAULT 'vcoin',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'approved',
      topup_at BIGINT NOT NULL,
      withdrawable_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      admin_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price_ncoin INTEGER DEFAULT 0,
      price_vcoin INTEGER DEFAULT 0,
      stock INTEGER DEFAULT -1,
      active INTEGER DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      price_ncoin INTEGER DEFAULT 0,
      price_vcoin INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      note TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      processed_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      coin_type TEXT NOT NULL DEFAULT 'ncoin',
      description TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS popups (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS regulations (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_rankings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      week_start BIGINT NOT NULL,
      task_count INTEGER NOT NULL DEFAULT 0,
      ncoin_earned INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, week_start)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT INTO settings VALUES ('weekly_reward_1','50000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('weekly_reward_2','30000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('weekly_reward_3','20000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_min','20000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_notice','Rút tiền sẽ được xử lý trong 24h. Vui lòng cập nhật đúng thông tin ngân hàng trước khi rút.') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('topup_notice','Liên hệ admin qua Telegram để nạp Vcoin. Admin sẽ xác nhận và cộng coin trong vòng 15 phút.') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('topup_guide','Bước 1: Chuyển khoản đến tài khoản admin\nBước 2: Ghi nội dung NapVcoin_[username]\nBước 3: Liên hệ admin gửi bill\nBước 4: Admin cộng Vcoin trong 15 phút') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('admin_bank','Chưa cập nhật thông tin ngân hàng admin') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('ranking_enabled','1') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('vcoin_lockdays','28') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_first','3000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_percent','1') ON CONFLICT DO NOTHING;

    INSERT INTO task_categories (name, icon, sort_order, active, created_at)
    VALUES ('Link Rút Gọn', '🔗', 1, 1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
    ON CONFLICT DO NOTHING;

    INSERT INTO providers (name, api_key, api_endpoint, active, created_at)
    VALUES ('link4m', '', 'https://link4m.co/api', 1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
    ON CONFLICT DO NOTHING;

    INSERT INTO providers (name, api_key, api_endpoint, active, created_at)
    VALUES ('site2s', '', 'https://site2s.com/api', 1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
    ON CONFLICT DO NOTHING;
  `);

  // Migration: them cac cot moi neu chua co
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ncoin INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS vcoin INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_owner TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reg_ip TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reg_fingerprint TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned INTEGER DEFAULT 0;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS reward_actual INTEGER DEFAULT 0;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS multiplier NUMERIC(6,4) DEFAULT 1.0;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS fingerprint TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category_id INTEGER;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ip_daily_limit INTEGER DEFAULT 2;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee INTEGER DEFAULT 0;
  `);

  console.log('Database san sang');
}

init().catch(err => { console.error('DB error:', err); process.exit(1); });

pool.q   = async (t, p) => (await pool.query(t, p)).rows;
pool.get = async (t, p) => (await pool.query(t, p)).rows[0] || null;
pool.run = async (t, p) => { const r = await pool.query(t, p); return { changes: r.rowCount, lastID: r.rows[0]?.id }; };

module.exports = pool;
// Tu dong cap nhat API key cho providers tu environment variables
async function updateProviderKeys() {
  if (process.env.LINK4M_API_KEY) {
    await pool.query("UPDATE providers SET api_key=$1 WHERE name='link4m' AND (api_key='' OR api_key IS NULL)", [process.env.LINK4M_API_KEY]);
  }
  if (process.env.SITE2S_API_KEY) {
    await pool.query("UPDATE providers SET api_key=$1 WHERE name='site2s' AND (api_key='' OR api_key IS NULL)", [process.env.SITE2S_API_KEY]);
  }
}
setTimeout(updateProviderKeys, 2000);
