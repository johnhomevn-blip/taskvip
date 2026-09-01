const express = require('express');
const db = require('../db');

const router = express.Router();
const MIN_WITHDRAW = 20000;

router.get('/wallet', async (req, res) => {
  const user = req.user;
  const history = await db.q(
    'SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
    [user.id]
  );
  res.render('wallet', { user, history, error: req.query.error || null, ok: req.query.ok || null });
});

router.post('/wallet/withdraw', async (req, res) => {
  const user = req.user;
  const amount = parseInt(req.body.amount, 10);
  const { method, detail } = req.body;

  if (!amount || amount < MIN_WITHDRAW) {
    return res.redirect(`/wallet?error=Số tiền rút tối thiểu là ${MIN_WITHDRAW.toLocaleString('vi-VN')}đ`);
  }
  if (amount > user.balance) return res.redirect('/wallet?error=Số dư không đủ');
  if (!['momo', 'bank', 'phonecard'].includes(method) || !detail) {
    return res.redirect('/wallet?error=Vui lòng chọn phương thức và nhập thông tin nhận tiền');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, user.id]);
    await client.query(
      "INSERT INTO withdrawals (user_id, amount, method, detail, status, created_at) VALUES ($1,$2,$3,$4,'pending',$5)",
      [user.id, amount, method, detail, Date.now()]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.redirect('/wallet?error=Có lỗi xảy ra, thử lại sau');
  } finally {
    client.release();
  }

  res.redirect('/wallet?ok=1');
});

module.exports = router;
