const express = require('express');
const db = require('../db');
const token = require('../lib/token');

const router = express.Router();

// Day la URL dich ma nha cung cap (Link4m/Uptolink) se redirect nguoi dung ve
// SAU KHI ho da hoan thanh nhiem vu that su ben do.
router.get('/verify', (req, res) => {
  const { tid, sig } = req.query;

  if (!tid || !sig) return res.send('Thiếu thông tin xác nhận.');

  const attempt = db.prepare('SELECT * FROM task_attempts WHERE id = ?').get(tid);
  if (!attempt) return res.send('Nhiệm vụ không tồn tại.');

  if (!token.verify(tid, sig)) {
    return res.send('Chữ ký không hợp lệ — có thể URL đã bị chỉnh sửa.');
  }

  if (attempt.status !== 'pending') {
    return res.send('Nhiệm vụ này đã được xử lý trước đó rồi.');
  }

  if (Date.now() > attempt.expires_at) {
    db.prepare("UPDATE task_attempts SET status = 'expired' WHERE id = ?").run(tid);
    return res.send('Link nhiệm vụ đã hết hạn, vui lòng thực hiện lại.');
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(attempt.task_id);

  // kiem tra thoi gian toi thieu hop ly (chong nguoi dung tu goi thang URL xac nhan)
  const elapsedSeconds = (Date.now() - attempt.created_at) / 1000;
  if (elapsedSeconds < task.min_seconds) {
    return res.send('Có vẻ bạn chưa hoàn thành đủ thời gian yêu cầu của nhiệm vụ, vui lòng thử lại.');
  }

  const update = db.transaction(() => {
    db.prepare(
      "UPDATE task_attempts SET status = 'completed', completed_at = ?, ip_verified = ? WHERE id = ?"
    ).run(Date.now(), req.ip, tid);
    db.prepare('UPDATE users SET balance = balance + ?, exp = exp + ? WHERE id = ?')
      .run(task.reward, task.exp_reward, attempt.user_id);
  });
  update();

  res.redirect('/tasks?done=1');
});

module.exports = router;
