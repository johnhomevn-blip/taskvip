const express = require('express');
const db = require('../db');
const token = require('../lib/token');
const { createShortLink } = require('../lib/shortener');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_TTL_MS = 30 * 60 * 1000;

router.get('/tasks', async (req, res) => {
  const user = req.user;
  const tasks = await db.q('SELECT * FROM tasks WHERE active = 1 ORDER BY id DESC');
  const since = Date.now() - DAY_MS;

  const tasksWithCount = await Promise.all(tasks.map(async (t) => {
    const row = await db.get(
      `SELECT COUNT(*) as c FROM task_attempts
       WHERE user_id = $1 AND task_id = $2 AND status = 'completed' AND created_at > $3`,
      [user.id, t.id, since]
    );
    return { ...t, remaining: Math.max(0, t.daily_limit - parseInt(row.c)) };
  }));

  res.render('tasks', { user, tasks: tasksWithCount, error: req.query.error || null, done: req.query.done || null });
});

router.post('/tasks/:id/start', async (req, res) => {
  const user = req.user;
  const task = await db.get('SELECT * FROM tasks WHERE id = $1 AND active = 1', [req.params.id]);
  if (!task) return res.redirect('/tasks?error=Nhiệm vụ không tồn tại');

  const since = Date.now() - DAY_MS;
  const row = await db.get(
    `SELECT COUNT(*) as c FROM task_attempts
     WHERE user_id = $1 AND task_id = $2 AND status = 'completed' AND created_at > $3`,
    [user.id, task.id, since]
  );
  if (parseInt(row.c) >= task.daily_limit) {
    return res.redirect('/tasks?error=Bạn đã hết lượt cho nhiệm vụ này hôm nay');
  }

  const now = Date.now();
  const attempt = await db.get(
    `INSERT INTO task_attempts (user_id, task_id, status, created_at, expires_at, ip_created)
     VALUES ($1,$2,'pending',$3,$4,$5) RETURNING id`,
    [user.id, task.id, now, now + ATTEMPT_TTL_MS, req.ip]
  );

  const attemptId = attempt.id;
  const sig = token.sign(attemptId);
  const verifyUrl = `${process.env.BASE_URL}/verify?tid=${attemptId}&sig=${sig}`;

  try {
    const shortUrl = await createShortLink(task.provider, verifyUrl);
    await db.run('UPDATE task_attempts SET short_url = $1 WHERE id = $2', [shortUrl, attemptId]);
    res.redirect(shortUrl);
  } catch (err) {
    console.error(err);
    res.redirect('/tasks?error=Không tạo được link nhiệm vụ, thử lại sau');
  }
});

module.exports = router;
