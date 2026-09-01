const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/admin', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
  const withdrawals = db.prepare(
    `SELECT withdrawals.*, users.username FROM withdrawals
     JOIN users ON users.id = withdrawals.user_id
     WHERE withdrawals.status = 'pending'
     ORDER BY withdrawals.created_at ASC`
  ).all();
  res.render('admin', { tasks, withdrawals, error: req.query.error || null });
});

router.post('/admin/tasks', (req, res) => {
  const { name, provider, target_url, reward, exp_reward, min_seconds, daily_limit } = req.body;
  if (!name || !provider || !target_url || !reward) {
    return res.redirect('/admin?error=Thiếu thông tin nhiệm vụ');
  }
  db.prepare(
    `INSERT INTO tasks (name, provider, target_url, reward, exp_reward, min_seconds, daily_limit, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    name, provider, target_url,
    parseInt(reward, 10), parseInt(exp_reward, 10) || 1,
    parseInt(min_seconds, 10) || 15, parseInt(daily_limit, 10) || 2,
    Date.now()
  );
  res.redirect('/admin');
});

router.post('/admin/tasks/:id/toggle', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (t) db.prepare('UPDATE tasks SET active = ? WHERE id = ?').run(t.active ? 0 : 1, t.id);
  res.redirect('/admin');
});

router.post('/admin/withdrawals/:id/:action', (req, res) => {
  const { id, action } = req.params;
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  if (!w || w.status !== 'pending') return res.redirect('/admin');

  if (action === 'approve') {
    db.prepare("UPDATE withdrawals SET status = 'approved', processed_at = ? WHERE id = ?")
      .run(Date.now(), id);
    // Luu y: day chi danh dau da duyet trong he thong.
    // Viec chuyen tien that qua Momo/ngan hang/the cao ban thuc hien thu cong
    // (hoac tich hop them cong thanh toan rieng sau nay).
  } else if (action === 'reject') {
    const tx = db.transaction(() => {
      db.prepare("UPDATE withdrawals SET status = 'rejected', processed_at = ? WHERE id = ?")
        .run(Date.now(), id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
    });
    tx();
  }
  res.redirect('/admin');
});

module.exports = router;
