const express = require('express');
const db = require('../db');

const router = express.Router();

const MIN_WITHDRAW = 20000; // rut toi thieu 20.000d, ban co the doi

router.get('/wallet', (req, res) => {
  const user = req.user;
  const history = db.prepare(
    'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(user.id);
  res.render('wallet', { user, history, error: req.query.error || null, ok: req.query.ok || null });
});

router.post('/wallet/withdraw', (req, res) => {
  const user = req.user;
  const amount = parseInt(req.body.amount, 10);
  const { method, detail } = req.body;

  if (!amount || amount < MIN_WITHDRAW) {
    return res.redirect(`/wallet?error=Số tiền rút tối thiểu là ${MIN_WITHDRAW.toLocaleString('vi-VN')}đ`);
  }
  if (amount > user.balance) {
    return res.redirect('/wallet?error=Số dư không đủ');
  }
  if (!['momo', 'bank', 'phonecard'].includes(method) || !detail) {
    return res.redirect('/wallet?error=Vui lòng chọn phương thức và nhập thông tin nhận tiền');
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, user.id);
    db.prepare(
      "INSERT INTO withdrawals (user_id, amount, method, detail, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)"
    ).run(user.id, amount, method, detail, Date.now());
  });
  tx();

  res.redirect('/wallet?ok=1');
});

module.exports = router;
