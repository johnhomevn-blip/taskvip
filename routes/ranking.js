const express = require('express');
const db = require('../db');
const { maskUsername } = require('../lib/mask');
const { checkAndDistributeAllRewards } = require('../lib/rewardCron');
const router = express.Router();

function getWeekStart() {
  const now = new Date();
  const gmt7 = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 7*3600000);
  const day = gmt7.getDay();
  gmt7.setDate(gmt7.getDate() - day + (day===0?-6:1));
  gmt7.setHours(0,0,0,0);
  return gmt7.getTime() - 7*3600000;
}

router.get('/ranking', async (req, res) => {
  // Kiem tra du phong (ngoai setInterval trong server.js) phong khi server
  // vua restart dung luc lo mat 1 nhip trao thuong - ham nay tu return ngay
  // neu chu ky gan nhat da duoc xu ly roi nen khong ton kem.
  await checkAndDistributeAllRewards();
  const enabledRow = await db.get("SELECT value FROM settings WHERE key='ranking_enabled'");
  const enabled = enabledRow?.value === '1';
  const weekStart = getWeekStart();
  const rankings = enabled ? await db.q(
    `SELECT wr.*, u.username FROM weekly_rankings wr JOIN users u ON u.id=wr.user_id
     WHERE wr.week_start=$1 ORDER BY wr.task_count DESC LIMIT 10`, [weekStart]
  ) : [];
  const settings = await db.q("SELECT * FROM settings WHERE key LIKE 'weekly_reward_%'");
  const rewards = {}; settings.forEach(s => rewards[s.key]=parseInt(s.value));
  const secondsLeft = Math.max(0, Math.floor((getWeekStart()+7*24*60*60*1000 - Date.now())/1000));
  const myRankRow = enabled ? await db.get(
    `SELECT COUNT(*)+1 as rank FROM weekly_rankings WHERE week_start=$1 AND task_count>(SELECT COALESCE(task_count,0) FROM weekly_rankings WHERE user_id=$2 AND week_start=$1)`,
    [weekStart, req.user.id]
  ) : null;
  // Che ten khi hien thi cong khai tren bang xep hang, tranh lo username
  // that cua nguoi khac (van giu username that neu la chinh minh de de nhan ra)
  const maskedRankings = rankings.map(r => ({
    ...r,
    displayName: r.user_id === req.user.id ? `${r.username} (Bạn)` : maskUsername(r.username)
  }));
  res.render('ranking', { user: req.user, rankings: maskedRankings, rewards, secondsLeft, enabled, myRank: parseInt(myRankRow?.rank||0) });
});

module.exports = router;
