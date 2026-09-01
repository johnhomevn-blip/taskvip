const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/admin', async (req, res) => {
  const tasks = await db.q('SELECT * FROM tasks ORDER BY id DESC');
  const withdrawals = await db.q(
    `SELECT withdrawals.*, users.username FROM withdrawals
     JOIN users ON users.id = withdrawals.user_id
     WHERE withdrawals.status = 'pending'
     ORDER BY withdrawals.created_at ASC`
  );
  res.render('admin', { tasks, withdrawals, error: req.query.error || null });
});

router.post('/admin/tasks', async (req, res) => {
  const { name, provider, target_url, reward, exp_reward, min_seconds, daily_limit } = req.body;
  if (!name || !provider || !target_url || !reward) {
    return res.redirect('/admin?error=Thiếu thông tin nhiệm vụ');
  }
  await db.run(
    `INSERT INTO tasks (name, provider, target_url, reward, exp_reward, min_seconds, daily_limit, active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
    [name, provider, target_url, parseInt(reward), parseInt(exp_reward)||1,
     parseInt(min_seconds)||15, parseInt(daily_limit)||2, Date.now()]
  );
  res.redirect('/admin');
});

router.post('/admin/tasks/:id/toggle', async (req, res) => {
  const t = await db.get('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (t) await db.run('UPDATE tasks SET active = $1 WHERE id = $2', [t.active ? 0 : 1, t.id]);
  res.redirect('/admin');
});

router.post('/admin/withdrawals/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const w = await db.get('SELECT * FROM withdrawals WHERE id = $1', [id]);
  if (!w || w.status !== 'pending') return res.redirect('/admin');

  if (action === 'approve') {
    await db.run("UPDATE withdrawals SET status = 'approved', processed_at = $1 WHERE id = $2", [Date.now(), id]);
  } else if (action === 'reject') {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE withdrawals SET status = 'rejected', processed_at = $1 WHERE id = $2", [Date.now(), id]);
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [w.amount, w.user_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
  res.redirect('/admin');
});

module.exports = router;
