const { Pool } = require('pg');
const crypto = require('crypto');

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
      reg_fingerprint TEXT DEFAULT '',
      referral_code TEXT,
      referred_by INTEGER REFERENCES users(id),
      referral_tier_locked INTEGER NOT NULL DEFAULT 1
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
      reset_mode TEXT NOT NULL DEFAULT 'daily',
      reset_hours INTEGER NOT NULL DEFAULT 24,
      require_review INTEGER NOT NULL DEFAULT 0,
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
      ncoin_used INTEGER NOT NULL DEFAULT 0,
      vcoin_used INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS shop_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🛍️',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES shop_categories(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price INTEGER DEFAULT 0,
      price_ncoin INTEGER DEFAULT 0,
      price_vcoin INTEGER DEFAULT 0,
      stock INTEGER DEFAULT -1,
      delivery_mode TEXT NOT NULL DEFAULT 'manual',
      active INTEGER DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    -- Kho tai khoan/thong tin cho san pham kieu "giao tu dong" (delivery_mode='pool'),
    -- vd danh muc Gmail: admin dan hang loat tai khoan:mat khau vao day truoc,
    -- moi luot mua se tu dong lay ra 1 dong con "available" va giao ngay lap tuc.
    CREATE TABLE IF NOT EXISTS product_stock (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      order_id INTEGER,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      order_code TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      price_ncoin INTEGER DEFAULT 0,
      price_vcoin INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      delivery_info TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      processed_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS custom_orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      order_code TEXT,
      title TEXT NOT NULL,
      details TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      quoted_price INTEGER,
      price_ncoin INTEGER DEFAULT 0,
      price_vcoin INTEGER DEFAULT 0,
      admin_note TEXT DEFAULT '',
      delivery_info TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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

    CREATE TABLE IF NOT EXISTS referral_monthly (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      month_start BIGINT NOT NULL,
      ref_count INTEGER NOT NULL DEFAULT 0,
      commission_earned INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, month_start)
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
    INSERT INTO settings VALUES ('withdraw_fee_rookie','3000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_silver','2500') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_gold','2000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_platinum','1500') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_diamond','1000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('withdraw_fee_legend','0') ON CONFLICT DO NOTHING;

    -- Chong VPN/Proxy/Hosting/mang di dong (xem lib/ipIntel.js). Mac dinh
    -- BAT san (nguoi dung yeu cau tinh nang nay ngay khi trien khai) nhung
    -- admin co the tat bat cu luc nao o Cai dat > Bao mat neu thay khong hop.
    INSERT INTO settings VALUES ('ipintel_enabled','1') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('ipintel_hold_vpn','1') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('ipintel_hold_mobile','1') ON CONFLICT DO NOTHING;

    INSERT INTO settings VALUES ('referral_enabled','1') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_ranking_enabled','1') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_threshold_2','51') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_threshold_3','101') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_rate_1','7') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_rate_2','12') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_rate_3','15') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_reward_1','40000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_reward_2','25000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('referral_reward_3','15000') ON CONFLICT DO NOTHING;

    INSERT INTO task_categories (name, icon, sort_order, active, created_at)
    VALUES ('Link Rút Gọn', '🔗', 1, 1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
    ON CONFLICT DO NOTHING;

    INSERT INTO providers (name, api_key, api_endpoint, active, created_at)
    VALUES ('link4m', '', 'https://link4m.co/full/?api={API_KEY}&url={URL_B64}&type=2', 1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
    ON CONFLICT DO NOTHING;

    INSERT INTO providers (name, api_key, api_endpoint, active, created_at)
    VALUES ('site2s', '', 'https://site2s.com/full/?api={API_KEY}&url={URL_B64}&type=2', 1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_tier_locked INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reset_mode TEXT NOT NULL DEFAULT 'daily';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reset_hours INTEGER NOT NULL DEFAULT 24;
    -- Cho nhiem vu ma nha cung cap yeu cau "IP chat luong" (khong phai proxy/
    -- datacenter): thay vi tu dong doan IP tot/xau (khong co du lieu tin cay
    -- de lam dieu do mien phi - xem giai thich trong lib/fraud.js), don gian
    -- hoa bang 1 cong tac: BAT thi MOI luot vuot cua nhiem vu nay LUON di
    -- vao "cho_duyet" de admin tu kiem tra tay truoc khi cong thuong, thay vi
    -- co gang doan IP tot/xau mot cach khong chinh xac.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS require_review INTEGER NOT NULL DEFAULT 0;
    -- VA LOI DA SUA (2026-09, "rua" Vcoin bi khoa thanh Ncoin tu do qua tao
    -- roi tu choi yeu cau rut tien): truoc day bang nay KHONG luu lai da
    -- tung tru bao nhieu Ncoin/Vcoin that su luc tao yeu cau rut, nen khi
    -- admin tu choi, code chi biet hoan LAI TOAN BO ve Ncoin (tu do, rut duoc
    -- ngay), bat ke phan do goc la Vcoin (dang bi khoa 28 ngay). Ai co Vcoin
    -- bi khoa chi can rut tien roi tu lam admin tu choi (hoac admin vo tinh
    -- tu choi giup) la "rua" duoc Vcoin khoa thanh Ncoin tu do ngay lap tuc.
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS ncoin_used INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS vcoin_used INTEGER NOT NULL DEFAULT 0;
    -- Backfill cho cac yeu cau rut tien CU dang con 'pending' tu truoc khi co
    -- 2 cot tren (ncoin_used/vcoin_used = 0 mac dinh): gan tam ncoin_used =
    -- amount, vi code CU (truoc ban va nay) trong thuc te CHUA TUNG THUC SU
    -- TRU PHI vao vi (chi ghi nhan "fee" de hien thi), nen so tien THAT SU
    -- da bi tru luc tao yeu cau CU chinh la "amount" (khong phai amount+fee).
    -- Chi ap dung cho don CON 'pending' - don da 'approved'/'rejected' roi
    -- thi khong con y nghia gi (khong con hoan tien lai nua).
    UPDATE withdrawals SET ncoin_used = amount WHERE status = 'pending' AND ncoin_used = 0 AND vcoin_used = 0 AND amount > 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_info TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE custom_orders ADD COLUMN IF NOT EXISTS order_code TEXT;
    ALTER TABLE custom_orders ADD COLUMN IF NOT EXISTS delivery_info TEXT DEFAULT '';
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS reward_actual INTEGER DEFAULT 0;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS multiplier NUMERIC(6,4) DEFAULT 1.0;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS fingerprint TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category_id INTEGER;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ip_daily_limit INTEGER DEFAULT 2;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee INTEGER DEFAULT 0;
    -- VA LOI DA SUA (2026-09, "khong xoa duoc san pham da co don hang"): truoc
    -- day route xoa san pham CHAN HOAN TOAN neu con don hang tham chieu toi,
    -- vi cac cau SELECT hien thi don hang dung JOIN products (INNER JOIN) de
    -- lay ten san pham - neu xoa san pham, JOIN nay se khong khop nua va DON
    -- HANG DO BIEN MAT KHOI LICH SU (ca trang "Don cua toi" cua user lan danh
    -- sach cho admin). De cho phep xoa that su ma khong mat lich su, luu san
    -- "chup" ten san pham vao chinh dong orders luc dat hang - sau nay du
    -- san pham goc co bi xoa, lich su van hien dung ten qua cot nay (xem
    -- COALESCE trong cac cau query o routes/shop.js va routes/admin.js).
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_name TEXT;
    UPDATE orders SET product_name = (SELECT name FROM products WHERE products.id = orders.product_id)
      WHERE product_name IS NULL;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS ip_is_vpn INTEGER;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS ip_is_mobile INTEGER;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS ip_isp TEXT;
    CREATE TABLE IF NOT EXISTS ip_intel_cache (
      ip TEXT PRIMARY KEY,
      is_proxy INTEGER NOT NULL DEFAULT 0,
      is_hosting INTEGER NOT NULL DEFAULT 0,
      is_mobile INTEGER NOT NULL DEFAULT 0,
      isp TEXT DEFAULT '',
      org TEXT DEFAULT '',
      ok INTEGER NOT NULL DEFAULT 1,
      checked_at BIGINT NOT NULL
    );
    -- YEU CAU KHACH NHAP THONG TIN LUC DAT HANG (2026-09, vd username Roblox
    -- de admin biet giao vao dau) - bat/tat va doi noi dung hoi duoc TUNG
    -- SAN PHAM rieng qua 2 cot nay (xem form Them/Sua san pham trong
    -- views/admin.ejs va logic bat buoc nhap o routes/shop.js). Gia tri
    -- khach nhap duoc luu vao cot orders.note co san tu truoc (chi la truoc
    -- day chua co noi nao ghi vao no).
    ALTER TABLE products ADD COLUMN IF NOT EXISTS require_note INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS note_label TEXT DEFAULT '';
    -- IPv4 "tu bao cao" (2026-09, theo yeu cau chu web: "muon thay ca IPv4
    -- lan IPv6 trong admin") - lay bang cach trinh duyet nguoi dung tu goi 1
    -- dich vu ngoai CHI CO ban ghi DNS IPv4 (api4.ipify.org, khong co ban ghi
    -- AAAA) nen trinh duyet BAT BUOC phai ket noi qua IPv4 cho request do, du
    -- may/mang ho dang uu tien IPv6 cho trang web chinh. Xem lib/ip.js va
    -- route POST /report-ipv4 trong routes/tasks.js.
    -- QUAN TRONG: gia tri nay la NGUOI DUNG TU BAO CAO qua script rieng, KHAC
    -- voi ip_created/ip_verified (do Cloudflare xac nhan, dang tin cay tuyet
    -- doi) - CHI dung de HIEN THI cho de doc + lam TIN HIEU PHU khi admin tu
    -- xem xet, KHONG dung de tu dong chan/giu lai vi ke gian co the gia mao
    -- gia tri nay qua devtools.
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS ip_v4_hint TEXT;
  `);

  // Don dep cac dong providers bi trung lap (bug cu do thieu rang buoc unique)
  // Giu lai dong co API Key da dien, neu khong co API Key thi giu dong id nho nhat
  await pool.query(`
    DELETE FROM providers WHERE id NOT IN (
      SELECT DISTINCT ON (name) id FROM providers
      ORDER BY name, (api_key <> '') DESC, id ASC
    );
    CREATE UNIQUE INDEX IF NOT EXISTS providers_name_key ON providers (name);
    UPDATE providers SET api_endpoint='https://link4m.co/full/?api={API_KEY}&url={URL_B64}&type=2' WHERE name='link4m' AND api_endpoint IN ('https://link4m.co/st','https://link4m.co/full/');
    UPDATE providers SET api_endpoint='https://site2s.com/full/?api={API_KEY}&url={URL_B64}&type=2' WHERE name='site2s' AND api_endpoint IN ('https://site2s.com/st','https://site2s.com/full/');
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price INTEGER DEFAULT 0;
    UPDATE products SET price = price_ncoin + price_vcoin WHERE price = 0 AND (price_ncoin > 0 OR price_vcoin > 0);
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS topup_at BIGINT DEFAULT 0;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS withdrawable_at BIGINT DEFAULT 0;
    UPDATE topups SET topup_at = created_at WHERE topup_at = 0;
    UPDATE topups SET withdrawable_at = created_at + 2419200000 WHERE withdrawable_at = 0;
    DELETE FROM weekly_rankings a USING weekly_rankings b
      WHERE a.id > b.id AND a.user_id = b.user_id AND a.week_start = b.week_start;
    CREATE UNIQUE INDEX IF NOT EXISTS weekly_rankings_user_week_key ON weekly_rankings (user_id, week_start);
  `);

  // Lop phong thu toan dien: dam bao moi cot co gia tri mac dinh deu ton tai
  // du bang da duoc tao tu truoc voi schema cu hon (tranh lap lai bug topups/weekly_rankings)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS exp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '⚡';
    ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
    ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_key TEXT DEFAULT '';
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_endpoint TEXT DEFAULT '';
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'link4m';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS exp_reward INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS min_seconds INTEGER NOT NULL DEFAULT 15;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 2;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS coin_type TEXT NOT NULL DEFAULT 'vcoin';
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT -1;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE popups ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE regulations ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
    ALTER TABLE regulations ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
  `);

  // Fix danh muc nhiem vu bi nhan ban moi lan deploy (thieu unique constraint, giong bug providers/weekly_rankings)
  await pool.query(`
    WITH survivors AS (
      SELECT name, MIN(id) as keep_id FROM task_categories GROUP BY name
    )
    UPDATE tasks
    SET category_id = s.keep_id
    FROM task_categories tc
    JOIN survivors s ON s.name = tc.name
    WHERE tasks.category_id = tc.id AND tc.id <> s.keep_id;

    DELETE FROM task_categories a USING task_categories b
      WHERE a.id > b.id AND a.name = b.name;

    CREATE UNIQUE INDEX IF NOT EXISTS task_categories_name_key ON task_categories (name);
  `);

  // Fix danh muc shop bi nhan ban (cung 1 nguyen nhan nhu task_categories o tren)
  await pool.query(`
    WITH survivors AS (
      SELECT name, MIN(id) as keep_id FROM shop_categories GROUP BY name
    )
    UPDATE products
    SET category_id = s.keep_id
    FROM shop_categories sc
    JOIN survivors s ON s.name = sc.name
    WHERE products.category_id = sc.id AND sc.id <> s.keep_id;

    DELETE FROM shop_categories a USING shop_categories b
      WHERE a.id > b.id AND a.name = b.name;

    CREATE UNIQUE INDEX IF NOT EXISTS shop_categories_name_key ON shop_categories (name);
  `);

  // Sinh ma gioi thieu (referral_code) cho user nao chua co (tai khoan tao truoc
  // khi co tinh nang gioi thieu, hoac phong khi sinh trung ma o buoc dang ky).
  // Lam tuan tu tung user de tranh trung ma (khong dung sinh hang loat mot cau lenh).
  const usersWithoutCode = await pool.query('SELECT id FROM users WHERE referral_code IS NULL OR referral_code = $1', ['']);
  for (const row of usersWithoutCode.rows) {
    let code, ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      code = crypto.randomBytes(4).toString('hex').toUpperCase();
      const exists = await pool.query('SELECT 1 FROM users WHERE referral_code=$1', [code]);
      ok = exists.rows.length === 0;
    }
    await pool.query('UPDATE users SET referral_code=$1 WHERE id=$2', [code, row.id]);
  }
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key ON users (referral_code);');

  // Sinh ma don hang (order_code) cho cac don hang cu chua co (tao truoc khi
  // co tinh nang nay). Lam tuan tu tung dong de tranh trung ma.
  const ordersWithoutCode = await pool.query('SELECT id FROM orders WHERE order_code IS NULL');
  for (const row of ordersWithoutCode.rows) {
    let code, ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      code = 'DH' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const exists1 = await pool.query('SELECT 1 FROM orders WHERE order_code=$1', [code]);
      const exists2 = await pool.query('SELECT 1 FROM custom_orders WHERE order_code=$1', [code]);
      ok = exists1.rows.length === 0 && exists2.rows.length === 0;
    }
    await pool.query('UPDATE orders SET order_code=$1 WHERE id=$2', [code, row.id]);
  }
  const customOrdersWithoutCode = await pool.query('SELECT id FROM custom_orders WHERE order_code IS NULL');
  for (const row of customOrdersWithoutCode.rows) {
    let code, ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      code = 'DH' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const exists1 = await pool.query('SELECT 1 FROM orders WHERE order_code=$1', [code]);
      const exists2 = await pool.query('SELECT 1 FROM custom_orders WHERE order_code=$1', [code]);
      ok = exists1.rows.length === 0 && exists2.rows.length === 0;
    }
    await pool.query('UPDATE custom_orders SET order_code=$1 WHERE id=$2', [code, row.id]);
  }

  // VA LOI: username truoc day chi chan trung khi GIONG HET hoa/thuong (vd
  // "NguyenVanA" va "nguyenvana" duoc coi la 2 tai khoan khac nhau), gay nham
  // lan khi dang nhap va co the bi loi dung de tao nhieu tai khoan gan giong
  // nhau. Them unique index tren LOWER(username) de DATABASE tu chan trung ten
  // khong phan biet hoa/thuong (lop bao ve cuoi cung, kem voi kiem tra o
  // routes/auth.js va routes/admin.js). Boc rieng trong try/catch: neu server
  // cua ban da co san 2 tai khoan trung ten chi khac hoa/thuong tu truoc, lenh
  // nay se bao loi nhung KHONG lam sap server - chi in canh bao de ban tu xu ly.
  try {
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (LOWER(username));');
  } catch (e) {
    console.warn('[CANH BAO] Khong the tao rang buoc chong trung ten (khong phan biet hoa/thuong).');
    console.warn('[CANH BAO] Co the da ton tai 2 tai khoan trung ten chi khac hoa/thuong tu truoc. Chi tiet loi:', e.message);
    console.warn('[CANH BAO] He thong van hoat dong binh thuong, nhung nen tim va xu ly (doi ten/khoa bot) cac tai khoan trung nay.');
  }

  // ================================================================
  // CHONG GIAN LAN (2026-09): cau dao Ncoin/gio + hang cho duyet thu
  // cong + co ro nghi ngo da tai khoan/farm. Xem lib/breaker.js,
  // lib/fraud.js, lib/attemptFlow.js va routes/verify.js de biet cach
  // dung. Tat ca đều CONG THEM vao schema cu, khong doi hanh vi cac
  // cot/bang da co.
  // ================================================================
  await pool.query(`
    -- Cau dao: nguong Ncoin/gio (admin chinh trong Admin > Bao mat),
    -- trang thai dang bat/tat, va thoi diem trigger gan nhat (de tinh
    -- cooldown tu dong resume). Gia tri mac dinh chi la khoi diem, admin
    -- BAT BUOC phai vao chinh lai cho phu hop quy mo thuc te cua site.
    INSERT INTO settings VALUES ('breaker_hourly_threshold','1000000') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('breaker_active','0') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('breaker_tripped_at','0') ON CONFLICT DO NOTHING;

    -- Nhat ky moi lan cau dao trigger/resume, de admin xem lai lich su
    -- (thoi diem, so lieu vuot nguong, ai/cai gi resume) du da tu dong
    -- resume roi.
    CREATE TABLE IF NOT EXISTS breaker_logs (
      id SERIAL PRIMARY KEY,
      triggered_at BIGINT NOT NULL,
      ncoin_total INTEGER NOT NULL,
      threshold INTEGER NOT NULL,
      resumed_at BIGINT,
      resumed_by TEXT,
      note TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );

    -- Nhat ky su kien bao mat chung (honeypot dinh bay, v.v.) de admin
    -- xem lai, khong lam sap ca he thong neu 1 loai su kien nao đó bi
    -- ghi lai qua nhieu (chi la 1 bang log don gian).
    CREATE TABLE IF NOT EXISTS security_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      ip TEXT DEFAULT '',
      user_id INTEGER,
      detail TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    );

    -- Diem/co nghi ngo da tai khoan-farm cho tung user (xem lib/fraud.js).
    -- fraud_flag=1 nghia la lan vuot link tiep theo cua user nay se bi
    -- dua vao hang "cho duyet" thay vi cong coin ngay, KHONG tu dong khoa
    -- tai khoan hay chan thao tac gi khac.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS fraud_flag INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS fraud_score INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS fraud_reason TEXT DEFAULT '';

    -- Lien ket 1 dong transactions voi task_attempts.id ma no dai dien,
    -- de khi admin duyet/tu choi 1 nhiem vu dang "cho_duyet", ta CAP NHAT
    -- LAI dung dong nay (tu earn_pending -> earn hoac earn_rejected) thay
    -- vi phai doan hoac tao dong moi - giu lich su giao dich nhat quan.
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ref_attempt_id INTEGER;

    -- Ly do 1 attempt bi giu lai cho duyet (vd 'breaker' hoac 'fraud'),
    -- hien thi cho admin trong hang cho duyet de biet vi sao ma khong
    -- can doan lai tu dau.
    ALTER TABLE task_attempts ADD COLUMN IF NOT EXISTS held_reason TEXT DEFAULT '';

    CREATE INDEX IF NOT EXISTS idx_transactions_type_created ON transactions (type, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_attempts_status ON task_attempts (status);
    CREATE INDEX IF NOT EXISTS idx_transactions_ref_attempt ON transactions (ref_attempt_id);
  `);

  // Nap 8 quy dinh mac dinh (lib/defaultRegulations.js) vao bang regulations
  // DUNG MOT LAN. Co "regulations_seed_v1" trong bang settings dam bao:
  // deploy lai KHONG nhan ban quy dinh, va quy dinh admin da xoa khong tu
  // quay lai. (Cung nguyen nhan bug danh muc bi nhan ban o tren - nen o day
  // dung co danh dau thay vi doan bang cach dem so dong.)
  const regSeeded = await pool.query("SELECT 1 FROM settings WHERE key='regulations_seed_v1'");
  if (regSeeded.rows.length === 0) {
    const defaultRegs = require('./lib/defaultRegulations');
    for (let i = 0; i < defaultRegs.length; i++) {
      const r = defaultRegs[i];
      await pool.query(
        `INSERT INTO regulations (title,content,sort_order,active,created_at)
         SELECT $1::text,$2::text,$3::int,1,$4::bigint
         WHERE NOT EXISTS (SELECT 1 FROM regulations WHERE title=$1::text)`,
        [r.title, r.content, i + 1, Date.now()]
      );
    }
    await pool.query("INSERT INTO settings VALUES ('regulations_seed_v1','1') ON CONFLICT DO NOTHING");
  }

  console.log('Database san sang');
}

const dbReadyPromise = init().catch(err => { console.error('DB error:', err); process.exit(1); });

pool.q   = async (t, p) => (await pool.query(t, p)).rows;
pool.get = async (t, p) => (await pool.query(t, p)).rows[0] || null;
pool.run = async (t, p) => { const r = await pool.query(t, p); return { changes: r.rowCount, lastID: r.rows[0]?.id }; };
// Cho phep cac script chay rieng le (vd create-admin.js) cho den khi init()
// tao xong bang/cot thay vi phai doan bang setTimeout co dinh.
pool.ready = dbReadyPromise;

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
