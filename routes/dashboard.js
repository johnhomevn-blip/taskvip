const express = require('express');
const db = require('../db');
const { getLevelInfo, getLevelTag } = require('../lib/level');
const { getDayStart, getWeekStart, getMonthStart } = require('../lib/period');
const router = express.Router();
const DAY_MS = 24*60*60*1000;

router.get('/dashboard', async (req, res) => {
  const user = req.user;

  // ADMIN: hien thong ke toan he thong thay vi thong ke ca nhan
  if (user.is_admin) {
    const period = ['day','week','month'].includes(req.query.period) ? req.query.period : 'day';
    let periodStart;
    if (period === 'day') periodStart = getDayStart();
    else if (period === 'week') periodStart = getWeekStart();
    else periodStart = getMonthStart();

    const totalNcoin = await db.get(
      `SELECT COALESCE(SUM(reward_actual),0) as t FROM task_attempts WHERE status='completed' AND created_at>=$1`,
      [periodStart]
    );
    const totalLinks = await db.get(
      `SELECT COUNT(*) as c FROM task_attempts WHERE status='completed' AND created_at>=$1`,
      [periodStart]
    );
    const totalUsers = await db.get(`SELECT COUNT(*) as c FROM users`);
    const totalWithdrawPending = await db.get(`SELECT COALESCE(SUM(amount),0) as t, COUNT(*) as c FROM withdrawals WHERE status='pending'`);

    // Top nguoi vuot nhieu link nhat trong khoang thoi gian da chon
    const topUsers = await db.q(
      `SELECT u.username, COUNT(*) as link_count, COALESCE(SUM(ta.reward_actual),0) as ncoin_sum
       FROM task_attempts ta JOIN users u ON u.id=ta.user_id
       WHERE ta.status='completed' AND ta.created_at>=$1
       GROUP BY u.username ORDER BY link_count DESC LIMIT 10`,
      [periodStart]
    );

    // Bieu do 7 ngay gan nhat (tong Ncoin toan he thong moi ngay)
    const days = [];
    for (let i=6; i>=0; i--) {
      const start = getDayStart(-i);
      const end = start + DAY_MS;
      const row = await db.get(
        `SELECT COALESCE(SUM(reward_actual),0) as total FROM task_attempts WHERE status='completed' AND created_at>=$1 AND created_at<$2`,
        [start, end]
      );
      const d = new Date(start);
      days.push({ date:`${d.getUTCDate()}/${d.getUTCMonth()+1}`, total: parseInt(row.total) });
    }

    return res.render('admin-dashboard', {
      user, period,
      totalNcoin: parseInt(totalNcoin.t),
      totalLinks: parseInt(totalLinks.c),
      totalUsers: parseInt(totalUsers.c),
      pendingWithdrawAmount: parseInt(totalWithdrawPending.t),
      pendingWithdrawCount: parseInt(totalWithdrawPending.c),
      topUsers, days
    });
  }

  // USER THUONG: thong ke ca nhan nhu cu
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
