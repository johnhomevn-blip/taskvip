const express = require('express');
const db = require('../db');
const { getLevelInfo, getLevelTag } = require('../lib/level');
const router = express.Router();
const DAY_MS = 24*60*60*1000;

router.get('/dashboard', async (req, res) => {
  const user = req.user;
  const levelInfo = getLevelInfo(user.exp);
  const tag = getLevelTag(levelInfo.level);

  const days = [];
  for (let i=6; i>=0; i--) {
    const start = Date.now() - i*DAY_MS, end = start + DAY_MS;
    const row = await db.get(
      `SELECT COALESCE(SUM(reward_actual),0) as total FROM task_attempts
       WHERE user_id=$1 AND status='completed' AND created_at>=$2 AND created_at<$3`,
      [user.id, start, end]
    );
    const d = new Date(start);
    days.push({ date:`${d.getDate()}/${d.getMonth()+1}`, total: parseInt(row.total) });
  }

  const weekStart = Date.now() - 7*DAY_MS;
  const monthStart = Date.now() - 30*DAY_MS;
  const weekCount = await db.get(`SELECT COUNT(*) as c FROM task_attempts WHERE user_id=$1 AND status='completed' AND created_at>=$2`, [user.id, weekStart]);
  const monthCount = await db.get(`SELECT COUNT(*) as c FROM task_attempts WHERE user_id=$1 AND status='completed' AND created_at>=$2`, [user.id, monthStart]);
  const weekNcoin = await db.get(`SELECT COALESCE(SUM(reward_actual),0) as t FROM task_attempts WHERE user_id=$1 AND status='completed' AND created_at>=$2`, [user.id, weekStart]);
  const monthNcoin = await db.get(`SELECT COALESCE(SUM(reward_actual),0) as t FROM task_attempts WHERE user_id=$1 AND status='completed' AND created_at>=$2`, [user.id, monthStart]);
  const announcements = await db.q("SELECT * FROM announcements WHERE active=1 ORDER BY created_at DESC LIMIT 3");

  res.render('dashboard', {
    user, levelInfo, tag, days, announcements,
    weekCount: parseInt(weekCount.c), monthCount: parseInt(monthCount.c),
    weekNcoin: parseInt(weekNcoin.t), monthNcoin: parseInt(monthNcoin.t)
  });
});

module.exports = router;
