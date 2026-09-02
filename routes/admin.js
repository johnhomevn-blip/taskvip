const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/admin', async (req, res) => {
  const tasks = await db.q('SELECT t.*, c.name as cat_name FROM tasks t LEFT JOIN task_categories c ON c.id=t.category_id ORDER BY t.id DESC');
  const categories = await db.q('SELECT * FROM task_categories ORDER BY sort_order');
  const withdrawals = await db.q(`SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' ORDER BY w.created_at ASC`);
  const orders = await db.q(`SELECT o.*, u.username, p.name as pname FROM orders o JOIN users u ON u.id=o.user_id JOIN products p ON p.id=o.product_id WHERE o.status='pending' ORDER BY o.created_at ASC`);
  const announcements = await db.q('SELECT * FROM announcements ORDER BY created_at DESC');
  const users = await db.q('SELECT id, username, ncoin, vcoin, exp, level, reg_ip, created_at FROM users ORDER BY id DESC LIMIT 100');
  const products = await db.q('SELECT * FROM products ORDER BY id DESC');
  const settings = await db.q('SELECT * FROM settings');
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const topups = await db.q(`SELECT t.*, u.username FROM topups t JOIN users u ON u.id=t.user_id WHERE t.status='pending' ORDER BY t.created_at ASC`);

  res.render('admin', { tasks, categories, withdrawals, orders, announcements, users, products, topups, settings: s,
    error: req.query.error||null, ok: req.query.ok||null });
});

// CATEGORIES
router.post('/admin/categories', async (req, res) => {
  const { name, icon, sort_order } = req.body;
  await db.run('INSERT INTO task_categories (name,icon,sort_order,active,created_at) VALUES ($1,$2,$3,1,$4)', [name, icon||'⚡', parseInt(sort_order)||0, Date.now()]);
  res.redirect('/admin#categories');
});
router.post('/admin/categories/:id/toggle', async (req, res) => {
  const c = await db.get('SELECT * FROM task_categories WHERE id=$1', [req.params.id]);
  if (c) await db.run('UPDATE task_categories SET active=$1 WHERE id=$2', [c.active?0:1, c.id]);
  res.redirect('/admin#categories');
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
  await db.run('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  res.redirect('/admin#tasks');
});

// WITHDRAWALS
router.post('/admin/withdrawals/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const w = await db.get('SELECT * FROM withdrawals WHERE id=$1', [id]);
  if (!w||w.status!=='pending') return res.redirect('/admin');
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

// TOPUPS - Cong Vcoin
router.post('/admin/topup', async (req, res) => {
  const { user_id, amount, note } = req.body;
  if (!user_id||!amount||parseInt(amount)<=0) return res.redirect('/admin?error=Thông tin không hợp lệ');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET vcoin=vcoin+$1 WHERE id=$2', [parseInt(amount), user_id]);
    await client.query(`INSERT INTO topups (user_id,amount,coin_type,note,status,created_at,admin_id) VALUES ($1,$2,'vcoin',$3,'approved',$4,$5)`,
      [user_id, parseInt(amount), note||'', Date.now(), req.user.id]);
    await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'topup',$2,'vcoin',$3,$4)`,
      [user_id, parseInt(amount), `Nạp Vcoin: ${note||'Admin cộng'}`, Date.now()]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); } finally { client.release(); }
  res.redirect('/admin?ok=1#users');
});

// PRODUCTS
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

// ORDERS
router.post('/admin/orders/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (action==='done') await db.run("UPDATE orders SET status='completed', processed_at=$1 WHERE id=$2", [Date.now(), id]);
  else if (action==='reject') {
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
  const { content } = req.body;
  if (content) await db.run('INSERT INTO announcements (content,active,created_at) VALUES ($1,1,$2)', [content, Date.now()]);
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

// SETTINGS
router.post('/admin/settings', async (req, res) => {
  const fields = ['weekly_reward_1','weekly_reward_2','weekly_reward_3','withdraw_min','withdraw_notice','topup_notice','ranking_enabled'];
  for (const f of fields) {
    if (req.body[f] !== undefined) await db.run('UPDATE settings SET value=$1 WHERE key=$2', [req.body[f], f]);
  }
  res.redirect('/admin?ok=1#settings');
});

// XEM IP USER
router.get('/admin/user/:id/ips', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!user) return res.status(404).send('Not found');
  const ips = await db.q(`SELECT m.ip, m.first_seen, m.last_seen,
    (SELECT COUNT(*) FROM task_attempts WHERE user_id=$1 AND ip_created=m.ip) as attempts,
    (SELECT COUNT(*) FROM task_attempts WHERE user_id=$1 AND ip_created=m.ip AND status='completed') as completed,
    (SELECT COUNT(*) FROM ip_user_map WHERE ip=m.ip AND user_id!=$1) as other_accounts
    FROM ip_user_map m WHERE m.user_id=$1 ORDER BY m.last_seen DESC`, [user.id]);
  res.render('admin_ips', { user: req.user, target: user, ips });
});

module.exports = router;
