const express = require('express');
const db = require('../db');
const token = require('../lib/token');
const { getLevelInfo } = require('../lib/level');
const router = express.Router();

router.get('/verify', async (req, res) => {
  const { tid, sig } = req.query;
  if (!tid || !sig) return res.render('verify', { status:'error', message:'Thiếu thông tin xác nhận.', reward:0, multiplier:1, targetUrl:null });

  const attempt = await db.get('SELECT * FROM task_attempts WHERE id=$1', [tid]);
  if (!attempt) return res.render('verify', { status:'error', message:'Nhiệm vụ không tồn tại.', reward:0, multiplier:1, targetUrl:null });
  if (!token.verify(tid, sig)) return res.render('verify', { status:'error', message:'Chữ ký không hợp lệ.', reward:0, multiplier:1, targetUrl:null });
  if (attempt.status !== 'pending') return res.render('verify', { status:'error', message:'Nhiệm vụ này đã được xử lý rồi.', reward:0, multiplier:1, targetUrl:null });
  if (Date.now() > parseInt(attempt.expires_at)) {
    await db.run("UPDATE task_attempts SET status='expired' WHERE id=$1", [tid]);
    return res.render('verify', { status:'error', message:'Link đã hết hạn, vui lòng thực hiện lại.', reward:0, multiplier:1, targetUrl:null });
  }

  const task = await db.get('SELECT * FROM tasks WHERE id=$1', [attempt.task_id]);
  const elapsed = (Date.now() - parseInt(attempt.created_at)) / 1000;
  if (elapsed < task.min_seconds) {
    return res.render('verify', { status:'error', message:'Chưa hoàn thành đủ thời gian yêu cầu.', reward:0, multiplier:1, targetUrl:null });
  }

  const ip = req.ip;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE task_attempts SET status='completed', completed_at=$1, ip_verified=$2 WHERE id=$3",
      [Date.now(), ip, tid]
    );
    const updUser = await client.query(
      'UPDATE users SET ncoin=ncoin+$1, exp=exp+$2 WHERE id=$3 RETURNING exp',
      [attempt.reward_actual, task.exp_reward, attempt.user_id]
    );
    const newExp = updUser.rows[0].exp;
    const { level } = getLevelInfo(newExp);
    await client.query('UPDATE users SET level=$1 WHERE id=$2', [level, attempt.user_id]);

    // Ghi transaction
    await client.query(
      'INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [attempt.user_id, 'earn', attempt.reward_actual, 'ncoin', `Vượt link: ${task.name}`, Date.now()]
    );

    // Cap nhat weekly ranking
    const weekStart = getWeekStart();
    await client.query(
      `INSERT INTO weekly_rankings (user_id,week_start,task_count,ncoin_earned) VALUES ($1,$2,1,$3)
       ON CONFLICT (user_id,week_start) DO UPDATE SET task_count=weekly_rankings.task_count+1, ncoin_earned=weekly_rankings.ncoin_earned+$3`,
      [attempt.user_id, weekStart, attempt.reward_actual]
    );

    // Ghi nhan IP
    await client.query(
      `INSERT INTO ip_user_map (ip,user_id,first_seen,last_seen) VALUES ($1,$2,$3,$3)
       ON CONFLICT (ip,user_id) DO UPDATE SET last_seen=$3`,
      [ip, attempt.user_id, Date.now()]
    );

    await client.query('COMMIT');
  } catch(err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.render('verify', { status:'error', message:'Có lỗi xảy ra, thử lại sau.', reward:0, multiplier:1, targetUrl:null });
  } finally { client.release(); }

  res.render('verify', { status:'success', message:'Hoàn thành!', reward: attempt.reward_actual, multiplier: attempt.multiplier, targetUrl: task.target_url });
});

function getWeekStart() {
  const now = new Date();
  const gmt7 = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 7*3600000);
  const day = gmt7.getDay();
  gmt7.setDate(gmt7.getDate() - day + (day===0?-6:1));
  gmt7.setHours(0,0,0,0);
  return gmt7.getTime() - 7*3600000;
}

module.exports = router;
