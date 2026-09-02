const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/wallet', async (req, res) => {
  const user = req.user;
  const settings = await db.q("SELECT * FROM settings WHERE key IN ('withdraw_min','withdraw_notice')");
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const history = await db.q(`SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT 20`, [user.id]);
  res.render('wallet', { user, settings: s, history, error: req.query.error||null, ok: req.query.ok||null });
});

router.post('/wallet/withdraw', async (req, res) => {
  const user = req.user;
  const amount = parseInt(req.body.amount, 10);
  const { method, detail } = req.body;
  const minRow = await db.get("SELECT value FROM settings WHERE key='withdraw_min'");
  const min = parseInt(minRow?.value || 20000);

  if (!amount || amount < min) return res.redirect(`/wallet?error=Số Ncoin rút tối thiểu là ${min.toLocaleString('vi-VN')}`);
  if (amount > user.ncoin) return res.redirect('/wallet?error=Số Ncoin không đủ');
  if (!['momo','bank','phonecard'].includes(method)||!detail) return res.redirect('/wallet?error=Vui lòng nhập đầy đủ thông tin');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET ncoin=ncoin-$1 WHERE id=$2', [amount, user.id]);
    await client.query(`INSERT INTO withdrawals (user_id,amount,method,detail,status,created_at) VALUES ($1,$2,$3,$4,'pending',$5)`, [user.id, amount, method, detail, Date.now()]);
    await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'withdraw',$2,'ncoin',$3,$4)`, [user.id, amount, `Rút tiền qua ${method}`, Date.now()]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); return res.redirect('/wallet?error=Lỗi, thử lại sau'); }
  finally { client.release(); }
  res.redirect('/wallet?ok=1');
});

router.post('/wallet/profile', async (req, res) => {
  const { phone, bank_name, bank_account, bank_owner } = req.body;
  await db.run('UPDATE users SET phone=$1, bank_name=$2, bank_account=$3, bank_owner=$4 WHERE id=$5',
    [phone||'', bank_name||'', bank_account||'', bank_owner||'', req.user.id]);
  res.redirect('/wallet?ok=profile');
});

module.exports = router;
