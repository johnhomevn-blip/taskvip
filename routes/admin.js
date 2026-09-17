const express = require('express');
const db = require('../db');
const breaker = require('../lib/breaker');
const fraud = require('../lib/fraud');
const { creditAttemptReward } = require('../lib/attemptFlow');
const router = express.Router();

// Kiem tra quyen admin - CHI ap dung cho duong dan bat dau bang '/admin'
// (router nay duoc mount o prefix '/' trong server.js de cac duong dan noi
// bo nhu '/admin/tasks' hoat dong, nen KHONG duoc dat middleware nay o
// server.js cho toan bo request nhu truoc - se chan oan ca nhung duong dan
// khong lien quan gi den admin, gay ra loi "Khong co quyen" o trang chu).
router.use('/admin', (req, res, next) => {
  if (!req.user?.is_admin) return res.status(403).send('Không có quyền');
  next();
});

router.get('/admin', async (req, res) => {
  const tasks = await db.q('SELECT t.*, c.name as cat_name FROM tasks t LEFT JOIN task_categories c ON c.id=t.category_id ORDER BY t.id DESC');
  const categories = await db.q('SELECT * FROM task_categories ORDER BY sort_order');
  const providers = await db.q('SELECT * FROM providers ORDER BY id');
  const withdrawals = await db.q(`SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' ORDER BY w.created_at ASC`);
  const orders = await db.q(`SELECT o.*, u.username, p.name as pname FROM orders o JOIN users u ON u.id=o.user_id JOIN products p ON p.id=o.product_id WHERE o.status='pending' ORDER BY o.created_at ASC`);
  const announcements = await db.q('SELECT * FROM announcements ORDER BY created_at DESC');
  const popups = await db.q('SELECT * FROM popups ORDER BY created_at DESC');
  const regs = await db.q('SELECT * FROM regulations ORDER BY sort_order, id');
  const users = await db.q('SELECT id, username, ncoin, vcoin, exp, level, is_banned, reg_ip, created_at FROM users ORDER BY id DESC LIMIT 100');
  const shopCategories = await db.q('SELECT * FROM shop_categories ORDER BY sort_order, id');
  const products = await db.q(`
    SELECT p.*, sc.name as cat_name,
      (SELECT COUNT(*)::int FROM product_stock ps WHERE ps.product_id=p.id AND ps.status='available') as pool_available
    FROM products p LEFT JOIN shop_categories sc ON sc.id=p.category_id ORDER BY p.id DESC
  `);
  const settings = await db.q('SELECT * FROM settings');
  const s = {}; settings.forEach(x => s[x.key]=x.value);

  // Giam sat IP toan he thong: cac lan vuot link gan day + so tai khoan khac dung chung IP
  const ipMonitor = await db.q(`
    SELECT ta.id, ta.ip_created, ta.fingerprint, ta.status, ta.created_at,
    u.username, t.name as task_name, t.provider as task_provider,
    (SELECT COUNT(*) FROM ip_user_map WHERE ip=ta.ip_created AND user_id != ta.user_id) as other_accounts,
    (SELECT COUNT(*) FROM fp_user_map WHERE fingerprint=ta.fingerprint AND user_id != ta.user_id AND ta.fingerprint IS NOT NULL AND ta.fingerprint != '') as other_accounts_fp
    FROM task_attempts ta
    JOIN users u ON u.id = ta.user_id
    JOIN tasks t ON t.id = ta.task_id
    ORDER BY ta.created_at DESC LIMIT 100
  `);

  // ===== TAB BAO MAT (chong gian lan) =====
  const breakerStatus = await breaker.getStatus();
  const breakerLogs = await db.q('SELECT * FROM breaker_logs ORDER BY triggered_at DESC LIMIT 30');
  // Nhiem vu dang "cho_duyet" - vi cau dao trigger hoac vi tai khoan bi gan co nghi ngo
  const heldAttempts = await db.q(`
    SELECT ta.*, u.username, u.fraud_score, u.fraud_reason, t.name as task_name
    FROM task_attempts ta
    JOIN users u ON u.id = ta.user_id
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.status='cho_duyet'
    ORDER BY ta.completed_at ASC
  `);
  const flaggedUsers = await db.q(`
    SELECT id, username, fraud_score, fraud_reason, reg_ip, created_at
    FROM users WHERE fraud_flag=1 ORDER BY fraud_score DESC, id DESC LIMIT 100
  `);
  const securityEvents = await db.q('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 100');

  res.render('admin', { tasks, categories, providers, withdrawals, orders, announcements, popups, regs, users, products, shopCategories, settings: s, ipMonitor,
    breakerStatus, breakerLogs, heldAttempts, flaggedUsers, securityEvents,
    error: req.query.error||null, ok: req.query.ok||null });
});

// PROVIDERS
router.post('/admin/providers', async (req, res) => {
  const { id, api_key, api_endpoint } = req.body;
  if (id && api_key !== undefined) {
    await db.run('UPDATE providers SET api_key=$1, api_endpoint=$2 WHERE id=$3', [api_key, api_endpoint||'', id]);
  }
  res.redirect('/admin#providers');
});
router.post('/admin/providers/add', async (req, res) => {
  const { name, api_key, api_endpoint } = req.body;
  if (name) await db.run('INSERT INTO providers (name,api_key,api_endpoint,active,created_at) VALUES ($1,$2,$3,1,$4)',
    [name, api_key||'', api_endpoint||'', Date.now()]);
  res.redirect('/admin#providers');
});
router.post('/admin/providers/:id/toggle', async (req, res) => {
  const p = await db.get('SELECT * FROM providers WHERE id=$1', [req.params.id]);
  if (p) await db.run('UPDATE providers SET active=$1 WHERE id=$2', [p.active?0:1, p.id]);
  res.redirect('/admin#providers');
});
// XOA NHA CUNG CAP: chi cho xoa neu khong con nhiem vu nao dang dung nha
// cung cap nay (tranh nhiem vu bi "mo coi" - con task nhung khong biet dung
// provider nao de tao link rut gon).
router.post('/admin/providers/:id/delete', async (req, res) => {
  const p = await db.get('SELECT * FROM providers WHERE id=$1', [req.params.id]);
  if (!p) return res.redirect('/admin?error=Nhà cung cấp không tồn tại#providers');
  const inUse = await db.get('SELECT COUNT(*)::int as c FROM tasks WHERE provider=$1', [p.name]);
  if (inUse.c > 0) {
    return res.redirect(`/admin?error=Không thể xóa: còn ${inUse.c} nhiệm vụ đang dùng nhà cung cấp này (hãy đổi nhiệm vụ sang NCC khác hoặc xóa nhiệm vụ trước)#providers`);
  }
  await db.run('DELETE FROM providers WHERE id=$1', [p.id]);
  res.redirect('/admin?ok=1#providers');
});

// CATEGORIES
router.post('/admin/categories', async (req, res) => {
  const { name, icon, sort_order } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin?error=Tên danh mục không được để trống');
  await db.run(
    'INSERT INTO task_categories (name,icon,sort_order,active,created_at) VALUES ($1,$2,$3,1,$4) ON CONFLICT (name) DO NOTHING',
    [name.trim(), icon||'⚡', parseInt(sort_order)||0, Date.now()]
  );
  res.redirect('/admin#tasks');
});
router.post('/admin/categories/:id/toggle', async (req, res) => {
  const c = await db.get('SELECT * FROM task_categories WHERE id=$1', [req.params.id]);
  if (c) await db.run('UPDATE task_categories SET active=$1 WHERE id=$2', [c.active?0:1, c.id]);
  res.redirect('/admin#tasks');
});
router.post('/admin/categories/:id/delete', async (req, res) => {
  await db.run('UPDATE tasks SET category_id=NULL WHERE category_id=$1', [req.params.id]);
  await db.run('DELETE FROM task_categories WHERE id=$1', [req.params.id]);
  res.redirect('/admin#tasks');
});

// TASKS
router.post('/admin/tasks', async (req, res) => {
  const { name, category_id, provider, target_url, base_reward, exp_reward, min_seconds, daily_limit, ip_daily_limit, reset_mode, reset_hours, require_review } = req.body;
  if (!name||!base_reward) return res.redirect('/admin?error=Thiếu thông tin');
  // URL dich khong bat buoc - mac dinh dua nguoi dung ve trang nhiem vu sau khi hoan thanh
  const finalTargetUrl = (target_url && target_url.trim()) ? target_url.trim() : `${process.env.BASE_URL}/tasks`;
  const finalResetMode = reset_mode === 'rolling' ? 'rolling' : 'daily';
  await db.run(
    `INSERT INTO tasks (name,category_id,provider,target_url,base_reward,exp_reward,min_seconds,daily_limit,ip_daily_limit,reset_mode,reset_hours,require_review,active,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13)`,
    [name, category_id||null, provider||'link4m', finalTargetUrl, parseInt(base_reward),
     parseInt(exp_reward)||1, parseInt(min_seconds)||15, parseInt(daily_limit)||2, parseInt(ip_daily_limit)||2,
     finalResetMode, parseInt(reset_hours)||24, require_review === 'on' ? 1 : 0, Date.now()]
  );
  res.redirect('/admin#tasks');
});
router.post('/admin/tasks/:id/toggle-review', async (req, res) => {
  const t = await db.get('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
  if (t) await db.run('UPDATE tasks SET require_review=$1 WHERE id=$2', [t.require_review?0:1, t.id]);
  res.redirect('/admin#tasks');
});
router.post('/admin/tasks/:id/toggle', async (req, res) => {
  const t = await db.get('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
  if (t) await db.run('UPDATE tasks SET active=$1 WHERE id=$2', [t.active?0:1, t.id]);
  res.redirect('/admin#tasks');
});
router.post('/admin/tasks/:id/delete', async (req, res) => {
  // Xoa task_attempts truoc
  await db.run('DELETE FROM task_attempts WHERE task_id=$1', [req.params.id]);
  await db.run('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  res.redirect('/admin#tasks');
});

// WITHDRAWALS
router.post('/admin/withdrawals/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const w = await db.get('SELECT * FROM withdrawals WHERE id=$1', [id]);
  if (!w||w.status!=='pending') return res.redirect('/admin#withdrawals');
  if (action==='approve') {
    await db.run("UPDATE withdrawals SET status='approved', processed_at=$1 WHERE id=$2", [Date.now(), id]);
  } else {
    // VA LOI DA SUA (2026-09, lo hong "rua" Vcoin khoa thanh Ncoin tu do):
    // truoc day LUON hoan toan bo w.amount ve Ncoin, bat ke phan bi tru luc
    // tao yeu cau la Ncoin hay Vcoin. Gio hoan LAI DUNG LOAI COIN da tru that
    // su (w.ncoin_used / w.vcoin_used, luu tu luc tao yeu cau - xem
    // routes/wallet.js), dam bao Vcoin dang bi khoa 28 ngay khong the "hoa
    // than" thanh Ncoin tu do chi qua 1 thao tac rut roi tu choi.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE withdrawals SET status='rejected', processed_at=$1 WHERE id=$2", [Date.now(), id]);
      if (w.ncoin_used > 0) await client.query('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [w.ncoin_used, w.user_id]);
      if (w.vcoin_used > 0) await client.query('UPDATE users SET vcoin=vcoin+$1 WHERE id=$2', [w.vcoin_used, w.user_id]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); console.error(e); return res.redirect('/admin?error=Lỗi khi hoàn tiền, xem log server#withdrawals'); }
    finally { client.release(); }
  }
  res.redirect('/admin#withdrawals');
});

// DIEU CHINH COIN (cong hoac tru - dung so am de tru)
router.post('/admin/buff', async (req, res) => {
  const { user_id, ncoin_amount, vcoin_amount, note } = req.body;
  if (!user_id) return res.redirect('/admin?error=Chọn user');
  const ncoinAmt = parseInt(ncoin_amount) || 0;
  const vcoinAmt = parseInt(vcoin_amount) || 0;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (ncoinAmt !== 0) {
      await client.query('UPDATE users SET ncoin=GREATEST(ncoin+$1,0) WHERE id=$2', [ncoinAmt, user_id]);
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,$2,$3,'ncoin',$4,$5)`,
        [user_id, ncoinAmt>0?'topup':'buy', Math.abs(ncoinAmt), `Admin ${ncoinAmt>0?'cộng':'trừ'} Ncoin: ${note||''}`, Date.now()]);
    }
    if (vcoinAmt !== 0) {
      await client.query('UPDATE users SET vcoin=GREATEST(vcoin+$1,0) WHERE id=$2', [vcoinAmt, user_id]);
      if (vcoinAmt > 0) {
        const lockMs = 28 * 24 * 60 * 60 * 1000;
        await client.query(`INSERT INTO topups (user_id,amount,coin_type,note,status,topup_at,withdrawable_at,created_at,admin_id) VALUES ($1,$2,'vcoin',$3,'approved',$4,$5,$4,$6)`,
          [user_id, vcoinAmt, note||'Admin cộng', Date.now(), Date.now() + lockMs, req.user.id]);
      }
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,$2,$3,'vcoin',$4,$5)`,
        [user_id, vcoinAmt>0?'topup':'buy', Math.abs(vcoinAmt), `Admin ${vcoinAmt>0?'cộng':'trừ'} Vcoin: ${note||''}`, Date.now()]);
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); } finally { client.release(); }
  res.redirect('/admin?ok=1#buff');
});

// BUFF BANG XEP HANG TUAN (cong truc tiep vao weekly_rankings)
function getWeekStartForBuff() {
  const now = new Date();
  const gmt7 = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 7*3600000);
  const day = gmt7.getDay();
  gmt7.setDate(gmt7.getDate() - day + (day===0?-6:1));
  gmt7.setHours(0,0,0,0);
  return gmt7.getTime() - 7*3600000;
}
router.post('/admin/buff-ranking', async (req, res) => {
  const { user_id, task_count_add, ncoin_earned_add } = req.body;
  if (!user_id) return res.redirect('/admin?error=Chọn user');
  const weekStart = getWeekStartForBuff();
  const tc = parseInt(task_count_add) || 0;
  const ne = parseInt(ncoin_earned_add) || 0;
  await db.run(
    `INSERT INTO weekly_rankings (user_id,week_start,task_count,ncoin_earned) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id,week_start) DO UPDATE SET task_count=GREATEST(weekly_rankings.task_count+$3,0), ncoin_earned=GREATEST(weekly_rankings.ncoin_earned+$4,0)`,
    [user_id, weekStart, tc, ne]
  );
  res.redirect('/admin?ok=1#buff');
});

// BUFF BANG XEP HANG GIOI THIEU THANG (cong truc tiep vao referral_monthly,
// GIONG HET tinh than voi buff-ranking o tren: chi de day thu hang/hien thi,
// KHONG dung tien that vao vi cua ai ca)
function getMonthStartForBuff() {
  const now = new Date();
  const gmt7 = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 7*3600000);
  gmt7.setDate(1);
  gmt7.setHours(0,0,0,0);
  return gmt7.getTime() - 7*3600000;
}
router.post('/admin/buff-referral', async (req, res) => {
  const { user_id, ref_count_add, commission_earned_add } = req.body;
  if (!user_id) return res.redirect('/admin?error=Chọn user#buff');
  const monthStart = getMonthStartForBuff();
  const rc = parseInt(ref_count_add) || 0;
  const ce = parseInt(commission_earned_add) || 0;
  await db.run(
    `INSERT INTO referral_monthly (user_id,month_start,ref_count,commission_earned) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id,month_start) DO UPDATE SET ref_count=GREATEST(referral_monthly.ref_count+$3,0), commission_earned=GREATEST(referral_monthly.commission_earned+$4,0)`,
    [user_id, monthStart, rc, ce]
  );
  res.redirect('/admin?ok=1#buff');
});

// TAO TAI KHOAN THU CONG
router.post('/admin/users/create', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { username, password, ncoin, vcoin } = req.body;
  if (!username || !password || password.length < 6) return res.redirect('/admin?error=Thiếu tên đăng nhập hoặc mật khẩu tối thiểu 6 ký tự');
  // VA LOI: truoc day cho phep username tuy y do dai (kieu "a", "1"...) o day
  // dan den bug hien thi tren bang xep hang (nhieu user ten qua ngan nhin
  // giong het nhau sau khi che ten). Dong bo cung quy tac voi trang dang ky:
  // 4-20 ky tu, chi chu/so/gach duoi.
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) return res.redirect('/admin?error=Tên đăng nhập phải 4-20 ký tự (chữ/số/gạch dưới)');
  // VA LOI: kiem tra trung ten khong phan biet hoa/thuong, dong bo voi routes/auth.js
  const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (existing) return res.redirect('/admin?error=Tên đăng nhập đã tồn tại');
  const hash = bcrypt.hashSync(password, 10);
  // VA LOI: truoc day tai khoan admin tao thu cong khong duoc sinh
  // referral_code, khien user do khong co link gioi thieu rieng o trang
  // /referral. Sinh ma giong het luc dang ky thuong.
  const crypto = require('crypto');
  let myReferralCode;
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await db.get('SELECT 1 FROM users WHERE referral_code=$1', [code]);
    if (!exists) { myReferralCode = code; break; }
  }
  if (!myReferralCode) myReferralCode = crypto.randomBytes(8).toString('hex').toUpperCase();
  try {
    await db.run(
      `INSERT INTO users (username,password_hash,ncoin,vcoin,exp,level,is_admin,created_at,reg_ip,referral_code)
       VALUES ($1,$2,$3,$4,0,1,0,$5,'admin-created',$6)`,
      [username, hash, parseInt(ncoin)||0, parseInt(vcoin)||0, Date.now(), myReferralCode]
    );
  } catch (e) {
    if (e.code === '23505') return res.redirect('/admin?error=Tên đăng nhập đã tồn tại');
    throw e;
  }
  res.redirect('/admin?ok=1#users');
});

// KHOA / MO KHOA TAI KHOAN
router.post('/admin/users/:id/ban', async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (u) await db.run('UPDATE users SET is_banned=$1 WHERE id=$2', [u.is_banned?0:1, u.id]);
  res.redirect('/admin?ok=1#users');
});

// XOA TAI KHOAN (xoa toan bo du lieu lien quan)
router.post('/admin/users/:id/delete', async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.redirect('/admin?error=Không thể tự xóa tài khoản đang đăng nhập');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // VA LOI DA SUA (2026-09, "xóa tài khoản thất bại âm thầm"): thieu don
    // dep fp_user_map, custom_orders, referral_monthly (deu co khoa ngoai
    // NOT NULL toi users) va thieu go tham chieu tu-than "referred_by" (cot
    // nay trong CHINH bang users tro toi user khac ma nguoi do gioi thieu -
    // xoa 1 nguoi da tung gioi thieu ai do se vi pham khoa ngoai nay). Truoc
    // day thieu nhung dong nay khien Postgres TU CHOI DELETE FROM users (con
    // du lieu tham chieu), ROLLBACK toan bo, nhung code cu van redirect ve
    // "?ok=1" (thanh cong gia) o duoi cung bat ke catch co chay hay khong ->
    // admin tuong da xoa nhung tai khoan van con nguyen.
    await client.query('UPDATE users SET referred_by=NULL WHERE referred_by=$1', [id]);
    await client.query('DELETE FROM task_attempts WHERE user_id=$1', [id]);
    await client.query('DELETE FROM withdrawals WHERE user_id=$1', [id]);
    await client.query('DELETE FROM topups WHERE user_id=$1', [id]);
    await client.query('DELETE FROM orders WHERE user_id=$1', [id]);
    await client.query('DELETE FROM custom_orders WHERE user_id=$1', [id]);
    await client.query('DELETE FROM transactions WHERE user_id=$1', [id]);
    await client.query('DELETE FROM login_logs WHERE user_id=$1', [id]);
    await client.query('DELETE FROM ip_user_map WHERE user_id=$1', [id]);
    await client.query('DELETE FROM fp_user_map WHERE user_id=$1', [id]);
    await client.query('DELETE FROM weekly_rankings WHERE user_id=$1', [id]);
    await client.query('DELETE FROM referral_monthly WHERE user_id=$1', [id]);
    await client.query('DELETE FROM security_events WHERE user_id=$1', [id]); // khong co khoa ngoai nhung don cho sach lich su
    await client.query('DELETE FROM users WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('Lỗi xóa tài khoản:', e);
    // VA LOI DA SUA: truoc day loi o day bi NUOT AM THAM (chi console.error
    // roi van redirect "?ok=1" o cuoi ham) - gio tra loi ro rang cho admin
    // biet THAT SU that bai, khong con "thanh cong gia" nua.
    return res.redirect('/admin?error=Xóa thất bại (còn dữ liệu liên quan chưa xử lý hết), xem log server để biết chi tiết#users');
  } finally { client.release(); }
  res.redirect('/admin?ok=1#users');
});

// DANH MUC SAN PHAM (shop_categories)
router.post('/admin/shop-categories', async (req, res) => {
  const { name, icon, sort_order } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin?error=Tên danh mục không được để trống');
  await db.run(
    'INSERT INTO shop_categories (name,icon,sort_order,active,created_at) VALUES ($1,$2,$3,1,$4) ON CONFLICT (name) DO NOTHING',
    [name.trim(), icon||'🛍️', parseInt(sort_order)||0, Date.now()]
  );
  res.redirect('/admin#shop');
});
router.post('/admin/shop-categories/:id/toggle', async (req, res) => {
  const c = await db.get('SELECT * FROM shop_categories WHERE id=$1', [req.params.id]);
  if (c) await db.run('UPDATE shop_categories SET active=$1 WHERE id=$2', [c.active?0:1, c.id]);
  res.redirect('/admin#shop');
});
router.post('/admin/shop-categories/:id/delete', async (req, res) => {
  await db.run('UPDATE products SET category_id=NULL WHERE category_id=$1', [req.params.id]);
  await db.run('DELETE FROM shop_categories WHERE id=$1', [req.params.id]);
  res.redirect('/admin?ok=1#shop');
});

// PRODUCTS (KHO HANG) + ORDERS
router.post('/admin/products', async (req, res) => {
  const { name, description, category_id, price, stock, delivery_mode } = req.body;
  await db.run('INSERT INTO products (category_id,name,description,price,stock,delivery_mode,active,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7)',
    [category_id||null, name, description||'', parseInt(price)||0, parseInt(stock)||-1, delivery_mode==='pool'?'pool':'manual', Date.now()]);
  res.redirect('/admin#shop');
});
router.post('/admin/products/:id/toggle', async (req, res) => {
  const p = await db.get('SELECT * FROM products WHERE id=$1', [req.params.id]);
  if (p) await db.run('UPDATE products SET active=$1 WHERE id=$2', [p.active?0:1, p.id]);
  res.redirect('/admin#shop');
});
router.post('/admin/products/:id/restock', async (req, res) => {
  const { stock } = req.body;
  if (stock === undefined || stock === '') return res.redirect('/admin?error=Nhập số lượng kho mới');
  await db.run('UPDATE products SET stock=$1 WHERE id=$2', [parseInt(stock), req.params.id]);
  res.redirect('/admin#shop');
});
// Them hang loat tai khoan/thong tin vao "kho" cua 1 san pham kieu 'pool'
// (moi dong 1 mon hang, se tu dong giao cho khach khi ho mua - xem routes/shop.js)
router.post('/admin/products/:id/stock', async (req, res) => {
  const { items } = req.body;
  if (!items || !items.trim()) return res.redirect('/admin?error=Chưa nhập nội dung kho hàng');
  const lines2 = items.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines2.length === 0) return res.redirect('/admin?error=Chưa nhập nội dung kho hàng');
  const now = Date.now();
  for (const line of lines2) {
    await db.run('INSERT INTO product_stock (product_id,content,status,created_at) VALUES ($1,$2,$3,$4)', [req.params.id, line, 'available', now]);
  }
  res.redirect('/admin?ok=1#shop');
});
// XOA SAN PHAM: chi cho xoa neu chua tung co ai mua (con don hang tham chieu
// toi) - tranh lam "mo coi" lich su don hang cua khach. Neu da co nguoi mua,
// chi nen Tat (an di) thay vi Xoa.
router.post('/admin/products/:id/delete', async (req, res) => {
  const inUse = await db.get('SELECT COUNT(*)::int as c FROM orders WHERE product_id=$1', [req.params.id]);
  if (inUse.c > 0) {
    return res.redirect(`/admin?error=Không thể xóa: đã có ${inUse.c} đơn hàng của sản phẩm này (dùng nút Tắt thay vì Xóa để giữ lịch sử)#shop`);
  }
  await db.run('DELETE FROM product_stock WHERE product_id=$1', [req.params.id]);
  await db.run('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.redirect('/admin?ok=1#shop');
});

// Xu ly don hang mua san pham (chi ap dung cho don kieu 'manual', vi don
// 'pool' da tu dong hoan tat + giao hang ngay luc mua roi)
router.post('/admin/orders/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (action === 'done') {
    const { delivery_info } = req.body;
    await db.run(
      "UPDATE orders SET status='completed', delivery_info=$1, processed_at=$2 WHERE id=$3",
      [delivery_info || '', Date.now(), id]
    );
  } else {
    const o = await db.get('SELECT * FROM orders WHERE id=$1', [id]);
    if (o) {
      if (o.price_ncoin>0) await db.run('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [o.price_ncoin, o.user_id]);
      if (o.price_vcoin>0) await db.run('UPDATE users SET vcoin=vcoin+$1 WHERE id=$2', [o.price_vcoin, o.user_id]);
      await db.run("UPDATE orders SET status='rejected', processed_at=$1 WHERE id=$2", [Date.now(), id]);
    }
  }
  res.redirect('/admin#shop');
});

// ANNOUNCEMENTS
router.post('/admin/announcements', async (req, res) => {
  if (req.body.content) await db.run('INSERT INTO announcements (content,active,created_at) VALUES ($1,1,$2)', [req.body.content, Date.now()]);
  res.redirect('/admin#announcements');
});
router.post('/admin/announcements/:id/toggle', async (req, res) => {
  const a = await db.get('SELECT * FROM announcements WHERE id=$1', [req.params.id]);
  if (a) await db.run('UPDATE announcements SET active=$1 WHERE id=$2', [a.active?0:1, a.id]);
  res.redirect('/admin#announcements');
});
router.post('/admin/announcements/:id/delete', async (req, res) => {
  await db.run('DELETE FROM announcements WHERE id=$1', [req.params.id]);
  res.redirect('/admin#announcements');
});

// POPUPS
router.post('/admin/popups', async (req, res) => {
  const { title, content } = req.body;
  if (title && content) {
    await db.run("UPDATE popups SET active=0"); // chi 1 popup active tai 1 thoi diem
    await db.run('INSERT INTO popups (title,content,active,created_at) VALUES ($1,$2,1,$3)', [title, content, Date.now()]);
  }
  res.redirect('/admin#announcements');
});
router.post('/admin/popups/:id/toggle', async (req, res) => {
  const p = await db.get('SELECT * FROM popups WHERE id=$1', [req.params.id]);
  if (p) {
    if (!p.active) await db.run("UPDATE popups SET active=0");
    await db.run('UPDATE popups SET active=$1 WHERE id=$2', [p.active?0:1, p.id]);
  }
  res.redirect('/admin#announcements');
});
router.post('/admin/popups/:id/delete', async (req, res) => {
  await db.run('DELETE FROM popups WHERE id=$1', [req.params.id]);
  res.redirect('/admin#announcements');
});

// REGULATIONS
router.post('/admin/regulations', async (req, res) => {
  const { title, content, sort_order } = req.body;
  if (title && content) await db.run('INSERT INTO regulations (title,content,sort_order,active,created_at) VALUES ($1,$2,$3,1,$4)', [title, content, parseInt(sort_order)||0, Date.now()]);
  res.redirect('/admin#regulations');
});
router.post('/admin/regulations/:id/toggle', async (req, res) => {
  const r = await db.get('SELECT * FROM regulations WHERE id=$1', [req.params.id]);
  if (r) await db.run('UPDATE regulations SET active=$1 WHERE id=$2', [r.active?0:1, r.id]);
  res.redirect('/admin#regulations');
});
router.post('/admin/regulations/:id/delete', async (req, res) => {
  await db.run('DELETE FROM regulations WHERE id=$1', [req.params.id]);
  res.redirect('/admin#regulations');
});

// SETTINGS
router.post('/admin/settings', async (req, res) => {
  const fields = ['weekly_reward_1','weekly_reward_2','weekly_reward_3','withdraw_min','withdraw_notice',
    'withdraw_fee_rookie','withdraw_fee_silver','withdraw_fee_gold','withdraw_fee_platinum','withdraw_fee_diamond','withdraw_fee_legend',
    'topup_notice','topup_guide','admin_bank',
    'ranking_enabled','vcoin_lockdays'];
  for (const f of fields) {
    if (req.body[f] !== undefined) await db.run('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [f, req.body[f]]);
  }
  res.redirect('/admin?ok=1#settings');
});

// IP USER
router.get('/admin/user/:id/ips', async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!target) return res.status(404).send('Not found');
  const ips = await db.q(`
    SELECT m.ip, m.first_seen, m.last_seen,
    (SELECT COUNT(*) FROM task_attempts WHERE user_id=$1 AND ip_created=m.ip) as attempts,
    (SELECT COUNT(*) FROM task_attempts WHERE user_id=$1 AND ip_created=m.ip AND status='completed') as completed,
    (SELECT COUNT(*) FROM ip_user_map WHERE ip=m.ip AND user_id!=$1) as other_accounts
    FROM ip_user_map m WHERE m.user_id=$1 ORDER BY m.last_seen DESC`, [target.id]);
  res.render('admin_ips', { user: req.user, target, ips });
});

// RESET DU LIEU IP/FINGERPRINT CHO 1 USER CU THE (khi ho doi may/mang bi chan nham)
router.post('/admin/user/:id/reset-ip', async (req, res) => {
  await db.run('DELETE FROM ip_user_map WHERE user_id=$1', [req.params.id]);
  await db.run('DELETE FROM fp_user_map WHERE user_id=$1', [req.params.id]);
  res.redirect('/admin?ok=1#users');
});

// RESET TOAN BO DU LIEU IP/FINGERPRINT (dung khi du lieu test cu gay false-block)
router.post('/admin/reset-ip-data', async (req, res) => {
  await db.run('DELETE FROM ip_user_map');
  await db.run('DELETE FROM fp_user_map');
  res.redirect('/admin?ok=1#users');
});

// ================================================================
// TAB BAO MAT: cau dao Ncoin/gio + hang cho duyet + co nghi ngo farm
// ================================================================

router.post('/admin/breaker/threshold', async (req, res) => {
  const r = await breaker.setThreshold(req.body.threshold);
  if (!r.ok) return res.redirect('/admin?error=Ngưỡng không hợp lệ#security');
  res.redirect('/admin?ok=1#security');
});

router.post('/admin/breaker/trip', async (req, res) => {
  await breaker.manualTrip(req.user.username, req.body.note || '');
  res.redirect('/admin?ok=1#security');
});

router.post('/admin/breaker/resume', async (req, res) => {
  await breaker.manualResume(req.user.username);
  res.redirect('/admin?ok=1#security');
});

// Duyet 1 nhiem vu dang "cho_duyet" -> cong thuong that su (dung CHUNG logic
// voi luong /verify binh thuong qua lib/attemptFlow.js, xem giai thich trong
// file do vi sao lam vay).
router.post('/admin/attempts/:id/approve', async (req, res) => {
  const id = req.params.id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Dieu kien "AND status='cho_duyet'" dam bao khong duyet 2 lan neu admin
    // lo bam nut nhieu lan / mo 2 tab.
    const upd = await client.query("UPDATE task_attempts SET status='completed' WHERE id=$1 AND status='cho_duyet' RETURNING *", [id]);
    if (upd.rowCount === 0) { await client.query('ROLLBACK'); return res.redirect('/admin?error=Nhiệm vụ không ở trạng thái chờ duyệt#security'); }
    const attempt = upd.rows[0];
    const task = await client.query('SELECT * FROM tasks WHERE id=$1', [attempt.task_id]).then(r => r.rows[0]);
    await creditAttemptReward(client, {
      attempt, task, ip: attempt.ip_verified,
      hasPendingTransactionRow: true, approvedByAdmin: true,
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e);
    return res.redirect('/admin?error=Lỗi khi duyệt, thử lại sau#security');
  } finally { client.release(); }
  res.redirect('/admin?ok=1#security');
});

// Tu choi 1 nhiem vu dang "cho_duyet" -> KHONG cong thuong, chi cap nhat
// trang thai va dong giao dich 'earn_pending' tuong ung sang 'earn_rejected'
// de nguoi dung thay ro trong Lich su.
router.post('/admin/attempts/:id/reject', async (req, res) => {
  const id = req.params.id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query("UPDATE task_attempts SET status='rejected' WHERE id=$1 AND status='cho_duyet' RETURNING id, task_id", [id]);
    if (upd.rowCount === 0) { await client.query('ROLLBACK'); return res.redirect('/admin?error=Nhiệm vụ không ở trạng thái chờ duyệt#security'); }
    await client.query(
      "UPDATE transactions SET type='earn_rejected' WHERE ref_attempt_id=$1 AND type='earn_pending'",
      [id]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e);
    return res.redirect('/admin?error=Lỗi khi từ chối, thử lại sau#security');
  } finally { client.release(); }
  res.redirect('/admin?ok=1#security');
});

// Go co nghi ngo farm cho 1 user (danh cho truong hop admin da kiem tra thay
// khong phai gian lan - vd nguoi dung dung chung wifi phong tro voi ban be).
router.post('/admin/users/:id/clear-fraud-flag', async (req, res) => {
  await fraud.clearFraudFlag(req.params.id);
  res.redirect('/admin?ok=1#security');
});

module.exports = router;
