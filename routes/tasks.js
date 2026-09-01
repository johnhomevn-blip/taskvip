const express = require('express');
const db = require('../db');
const token = require('../lib/token');
const { createShortLink } = require('../lib/shortener');

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_TTL_MS = 30 * 60 * 1000; // link nhiem vu het han sau 30 phut neu khong hoan thanh

router.get('/tasks', (req, res) => {
  const user = req.user;
  const tasks = db.prepare('SELECT * FROM tasks WHERE active = 1 ORDER BY id DESC').all();

  // tinh so lan da lam hom nay cho moi task, de hien thi "con lai x luot"
  const since = Date.now() - DAY_MS;
  const tasksWithCount = tasks.map((t) => {
    const count = db.prepare(
      `SELECT COUNT(*) as c FROM task_attempts
       WHERE user_id = ? AND task_id = ? AND status = 'completed' AND created_at > ?`
    ).get(user.id, t.id, since).c;
    return { ...t, remaining: Math.max(0, t.daily_limit - count) };
  });

  res.render('tasks', { user, tasks: tasksWithCount, error: req.query.error || null });
});

router.post('/tasks/:id/start', async (req, res) => {
  const user = req.user;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').get(req.params.id);
  if (!task) return res.redirect('/tasks?error=Nhiệm vụ không tồn tại');

  // kiem tra con luot khong
  const since = Date.now() - DAY_MS;
  const count = db.prepare(
    `SELECT COUNT(*) as c FROM task_attempts
     WHERE user_id = ? AND task_id = ? AND status = 'completed' AND created_at > ?`
  ).get(user.id, task.id, since).c;
  if (count >= task.daily_limit) {
    return res.redirect('/tasks?error=Bạn đã hết lượt cho nhiệm vụ này hôm nay');
  }

  const now = Date.now();
  const info = db.prepare(
    `INSERT INTO task_attempts (user_id, task_id, status, created_at, expires_at, ip_created)
     VALUES (?, ?, 'pending', ?, ?, ?)`
  ).run(user.id, task.id, now, now + ATTEMPT_TTL_MS, req.ip);

  const attemptId = info.lastInsertRowid;
  const sig = token.sign(attemptId);
  const verifyUrl = `${process.env.BASE_URL}/verify?tid=${attemptId}&sig=${sig}`;

  try {
    const shortUrl = await createShortLink(task.provider, verifyUrl);
    db.prepare('UPDATE task_attempts SET short_url = ? WHERE id = ?').run(shortUrl, attemptId);
    res.redirect(shortUrl);
  } catch (err) {
    console.error(err);
    res.redirect('/tasks?error=Không tạo được link nhiệm vụ, thử lại sau');
  }
});

module.exports = router;
