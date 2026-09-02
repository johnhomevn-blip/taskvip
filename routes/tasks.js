const express = require('express');
const db = require('../db');
const token = require('../lib/token');
const { createShortLink } = require('../lib/shortener');
const { getMultiplier, getSecondsUntilReset } = require('../lib/multiplier');
const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_TTL_MS = 30 * 60 * 1000;

router.get('/tasks', async (req, res) => {
  const user = req.user;
  const categories = await db.q('SELECT * FROM task_categories WHERE active=1 ORDER BY sort_order');
  const tasks = await db.q('SELECT * FROM tasks WHERE active=1 ORDER BY category_id, id DESC');
  const since = Date.now() - DAY_MS;
  const multiplier = getMultiplier();
  const secondsUntilReset = getSecondsUntilReset();
  const announcements = await db.q("SELECT * FROM announcements WHERE active=1 ORDER BY created_at DESC LIMIT 3");

  const tasksWithInfo = await Promise.all(tasks.map(async t => {
    const done = await db.get(
      `SELECT COUNT(*) as c FROM task_attempts WHERE user_id=$1 AND task_id=$2 AND status='completed' AND created_at>$3`,
      [user.id, t.id, since]
    );
    const actualReward = Math.round(t.base_reward * multiplier);
    return { ...t, remaining: Math.max(0, t.daily_limit - parseInt(done.c)), actualReward };
  }));

  // Group tasks by category
  const grouped = categories.map(cat => ({
    ...cat,
    tasks: tasksWithInfo.filter(t => t.category_id === cat.id)
  }));
  const uncategorized = tasksWithInfo.filter(t => !t.category_id);

  res.render('tasks', { user, grouped, uncategorized, multiplier, secondsUntilReset, announcements,
    error: req.query.error || null, done: req.query.done || null });
});

router.post('/tasks/:id/start', async (req, res) => {
  const user = req.user;
  const ip = req.ip;
  const fp = req.body.fingerprint || '';
  const task = await db.get('SELECT * FROM tasks WHERE id=$1 AND active=1', [req.params.id]);
  if (!task) return res.redirect('/tasks?error=Nhiệm vụ không tồn tại');

  // Kiem tra IP da dung boi tai khoan khac chua
  const ipConflict = await db.get(
    'SELECT user_id FROM ip_user_map WHERE ip=$1 AND user_id != $2 LIMIT 1',
    [ip, user.id]
  );
  if (ipConflict) {
    return res.redirect('/tasks?error=IP này đã được sử dụng bởi tài khoản khác. Không thể tạo link.');
  }

  // Kiem tra gioi han IP theo nhiem vu
  const ipToday = await db.get(
    `SELECT COUNT(*) as c FROM task_attempts
     WHERE task_id=$1 AND ip_created=$2 AND status='completed' AND created_at>$3`,
    [task.id, ip, Date.now() - DAY_MS]
  );
  if (parseInt(ipToday.c) >= task.ip_daily_limit) {
    return res.redirect(`/tasks?error=IP này đã đạt giới hạn ${task.ip_daily_limit} lượt/ngày cho nhiệm vụ này`);
  }

  // Kiem tra gioi han user
  const since = Date.now() - DAY_MS;
  const userDone = await db.get(
    `SELECT COUNT(*) as c FROM task_attempts WHERE user_id=$1 AND task_id=$2 AND status='completed' AND created_at>$3`,
    [user.id, task.id, since]
  );
  if (parseInt(userDone.c) >= task.daily_limit) {
    return res.redirect('/tasks?error=Bạn đã hết lượt cho nhiệm vụ này hôm nay');
  }

  // Ghi nhan IP - user mapping
  await pool_upsert_ip(ip, user.id);

  const multiplier = getMultiplier();
  const rewardActual = Math.round(task.base_reward * multiplier);
  const now = Date.now();

  const attempt = await db.get(
    `INSERT INTO task_attempts (user_id,task_id,status,reward_actual,multiplier,created_at,expires_at,ip_created,fingerprint)
     VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.id, task.id, rewardActual, multiplier, now, now + ATTEMPT_TTL_MS, ip, fp]
  );

  const sig = token.sign(attempt.id);
  const verifyUrl = `${process.env.BASE_URL}/verify?tid=${attempt.id}&sig=${sig}`;
  try {
    const shortUrl = await createShortLink('link4m', verifyUrl);
    await db.run('UPDATE task_attempts SET short_url=$1 WHERE id=$2', [shortUrl, attempt.id]);
    res.redirect(shortUrl);
  } catch (err) {
    console.error(err);
    res.redirect('/tasks?error=Không tạo được link nhiệm vụ, thử lại sau');
  }
});

async function pool_upsert_ip(ip, userId) {
  const now = Date.now();
  try {
    await db.run(
      `INSERT INTO ip_user_map (ip, user_id, first_seen, last_seen) VALUES ($1,$2,$3,$3)
       ON CONFLICT (ip, user_id) DO UPDATE SET last_seen=$3`,
      [ip, userId, now]
    );
  } catch(e) {}
}

module.exports = router;
