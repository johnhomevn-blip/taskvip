const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/history', async (req, res) => {
  const user = req.user;
  const cutoff = Date.now() - 30*24*60*60*1000;
  await db.run('DELETE FROM transactions WHERE user_id=$1 AND created_at<$2', [user.id, cutoff]);
  const transactions = await db.q('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [user.id]);

  // Nhat ky dang nhap
  const loginLogs = await db.q('SELECT * FROM login_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]);

  res.render('history', { user, transactions, loginLogs });
});

module.exports = router;
