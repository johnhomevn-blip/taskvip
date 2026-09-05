const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/admin', async (req, res) => {
  const tasks = await db.q('SELECT t.*, c.name as cat_name FROM tasks t LEFT JOIN task_categories c ON c.id=t.category_id ORDER BY t.id DESC');
  const categories = await db.q('SELECT * FROM task_categories ORDER BY sort_order');
  const providers = await db.q('SELECT * FROM providers ORDER BY id');
  const withdrawals = await db.q(`SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' ORDER BY w.created_at ASC`);
  const orders = await db.q(`SELECT o.*, u.username, p.name as pname FROM orders o JOIN users u ON u.id=o.user_id JOIN products p ON p.id=o.product_id WHERE o.status='pending' ORDER BY o.created_at ASC`);
  const announcements = await db.q('SELECT * FROM announcements ORDER BY created_at DESC');
  const popups = await db.q('SELECT * FROM popups ORDER BY created_at DESC');
  const regs = await db.q('SELECT * FROM regulations ORDER BY sort_order, id');
  const users = await db.q('SELECT id, username, ncoin, vcoin, exp, level, reg_ip, created_at FROM users ORDER BY id DESC LIMIT 100');
  const products = await db.q('SELECT * FROM products ORDER BY id DESC');
  const settings = await db.q('SELECT * FROM settings');
  const s = {}; settings.forEach(x => s[x.key]=x.value);

  res.render('admin', { tasks, categories, providers, withdrawals, orders, announcements, popups, regs, users, products, settings: s,
    error: req.query.error||null, ok: req.query.ok||null });
});

// PROVIDERS
router.post('/admin/providers', async (req, res) => {
  const { id, api_key } = req.body;
  if (id && api_key !== undefined) {
    await db.run('UPDATE providers SET api_key=$1 WHERE id=$2', [api_key, id]);
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

// CATEGORIES
router.post('/admin/categories', async (req, res) => {
  const { name, icon, sort_order } = req.body;
  await db.run('INSERT INTO task_categories (name,icon,sort_order,active,created_at) VALUES ($1,$2,$3,1,$4)', [name, icon||'⚡', parseInt(sort_order)||0, Date.now()]);
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
  const { name, category_id, provider, target_url, base_reward, exp_reward, min_seconds, daily_limit, ip_daily_limit } = req.body;
  if (!name||!target_url||!base_reward) return res.redirect('/admin?error=Thiếu thông tin');
  await db.run(
    `INSERT INTO tasks (name,category_id,provider,target_url,base_reward,exp_reward,min_seconds,daily_limit,ip_daily_limit,active,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
    [name, category_id||null, provider||'link4m', target_url, parseInt(base_reward),
     parseInt(exp_reward)||1, parseInt(min_seconds)||15, parseInt(daily_limit)||2, parseInt(ip_daily_limit)||2, Date.now()]
  );
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
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE withdrawals SET status='rejected', processed_at=$1 WHERE id=$2", [Date.now(), id]);
      await client.query('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [w.amount, w.user_id]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); } finally { client.release(); }
  }
  res.redirect('/admin#withdrawals');
});

// BUFF NCOIN (test/top)
router.post('/admin/buff', async (req, res) => {
  const { user_id, ncoin_amount, vcoin_amount, note } = req.body;
  if (!user_id) return res.redirect('/admin?error=Chọn user');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (parseInt(ncoin_amount) > 0) {
      await client.query('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [parseInt(ncoin_amount), user_id]);
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'topup',$2,'ncoin',$3,$4)`,
        [user_id, parseInt(ncoin_amount), `Admin cộng Ncoin: ${note||''}`, Date.now()]);
    }
    if (parseInt(vcoin_amount) > 0) {
      await client.query('UPDATE users SET vcoin=vcoin+$1 WHERE id=$2', [parseInt(vcoin_amount), user_id]);
      const lockMs = 28 * 24 * 60 * 60 * 1000;
      await client.query(`INSERT INTO topups (user_id,amount,coin_type,note,status,topup_at,withdrawable_at,created_at,admin_id) VALUES ($1,$2,'vcoin',$3,'approved',$4,$5,$4,$6)`,
        [user_id, parseInt(vcoin_amount), note||'Admin cộng', Date.now(), Date.now() + lockMs, req.user.id]);
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'topup',$2,'vcoin',$3,$4)`,
        [user_id, parseInt(vcoin_amount), `Admin cộng Vcoin: ${note||''}`, Date.now()]);
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); } finally { client.release(); }
  res.redirect('/admin?ok=1#users');
});

// PRODUCTS + ORDERS
router.post('/admin/products', async (req, res) => {
  const { name, description, price_ncoin, price_vcoin, stock } = req.body;
  await db.run('INSERT INTO products (name,description,price_ncoin,price_vcoin,stock,active,created_at) VALUES ($1,$2,$3,$4,$5,1,$6)',
    [name, description||'', parseInt(price_ncoin)||0, parseInt(price_vcoin)||0, parseInt(stock)||-1, Date.now()]);
  res.redirect('/admin#shop');
});
router.post('/admin/products/:id/toggle', async (req, res) => {
  const p = await db.get('SELECT * FROM products WHERE id=$1', [req.params.id]);
  if (p) await db.run('UPDATE products SET active=$1 WHERE id=$2', [p.active?0:1, p.id]);
  res.redirect('/admin#shop');
});
router.post('/admin/orders/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (action==='done') await db.run("UPDATE orders SET status='completed', processed_at=$1 WHERE id=$2", [Date.now(), id]);
  else {
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
    'withdraw_fee_first','withdraw_fee_percent','topup_notice','topup_guide','admin_bank',
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

module.exports = router;
