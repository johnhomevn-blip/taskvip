const express = require('express');
const db = require('../db');
const token = require('../lib/token');

const router = express.Router();

router.get('/verify', async (req, res) => {
  const { tid, sig } = req.query;
  if (!tid || !sig) return res.send('Thiếu thông tin xác nhận.');

  const attempt = await db.get('SELECT * FROM task_attempts WHERE id = $1', [tid]);
  if (!attempt) return res.send('Nhiệm vụ không tồn tại.');
  if (!token.verify(tid, sig)) return res.send('Chữ ký không hợp lệ — có thể URL đã bị chỉnh sửa.');
  if (attempt.status !== 'pending') return res.send('Nhiệm vụ này đã được xử lý trước đó rồi.');
  if (Date.now() > parseInt(attempt.expires_at)) {
    await db.run("UPDATE task_attempts SET status = 'expired' WHERE id = $1", [tid]);
    return res.send('Link nhiệm vụ đã hết hạn, vui lòng thực hiện lại.');
  }

  const task = await db.get('SELECT * FROM tasks WHERE id = $1', [attempt.task_id]);
  const elapsedSeconds = (Date.now() - parseInt(attempt.created_at)) / 1000;
  if (elapsedSeconds < task.min_seconds) {
    return res.send('Có vẻ bạn chưa hoàn thành đủ thời gian yêu cầu của nhiệm vụ, vui lòng thử lại.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE task_attempts SET status = 'completed', completed_at = $1, ip_verified = $2 WHERE id = $3",
      [Date.now(), req.ip, tid]
    );
    await client.query(
      'UPDATE users SET balance = balance + $1, exp = exp + $2 WHERE id = $3',
      [task.reward, task.exp_reward, attempt.user_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.send('Có lỗi xảy ra, vui lòng thử lại.');
  } finally {
    client.release();
  }

  res.redirect('/tasks?done=1');
});

module.exports = router;
