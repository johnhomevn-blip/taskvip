const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/wallet', async (req, res) => {
  const user = req.user;
  const settings = await db.q("SELECT * FROM settings WHERE key IN ('withdraw_min','withdraw_notice','withdraw_fee_first','withdraw_fee_percent','vcoin_lockdays')");
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const history = await db.q('SELECT * FROM withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [user.id]);
  const withdrawCount = await db.get("SELECT COUNT(*) as c FROM withdrawals WHERE user_id=$1 AND status IN ('approved','pending')", [user.id]);

  // Tinh Vcoin co the rut (da qua lockdays ngay)
  const lockDays = parseInt(s.vcoin_lockdays || 28);
  const lockMs = lockDays * 24 * 60 * 60 * 1000;
  const unlocked = await db.get(
    'SELECT COALESCE(SUM(amount),0) as total FROM topups WHERE user_id=$1 AND withdrawable_at < $2',
    [user.id, Date.now()]
  );
  const vcoinUnlocked = parseInt(unlocked?.total || 0);

  res.render('wallet', { user, settings: s, history,
    isFirstWithdraw: parseInt(withdrawCount.c) === 0,
    vcoinUnlocked,
    error: req.query.error||null, ok: req.query.ok||null });
});

router.post('/wallet/withdraw', async (req, res) => {
  const user = req.user;
  const amount = parseInt(req.body.amount, 10);
  const { method, detail } = req.body;
  const settings = await db.q("SELECT * FROM settings WHERE key IN ('withdraw_min','withdraw_fee_first','withdraw_fee_percent','vcoin_lockdays')");
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const min = parseInt(s.withdraw_min || 20000);
  const feeFirst = parseInt(s.withdraw_fee_first || 3000);
  const feePercent = parseFloat(s.withdraw_fee_percent || 1) / 100;

  if (!amount || amount < min) return res.redirect(`/wallet?error=Số tiền rút tối thiểu là ${min.toLocaleString('vi-VN')}đ`);

  // Kiem tra du so du (Ncoin + Vcoin da unlock)
  const lockDays = parseInt(s.vcoin_lockdays || 28);
  const lockMs = lockDays * 24 * 60 * 60 * 1000;
  const unlocked = await db.get('SELECT COALESCE(SUM(amount),0) as total FROM topups WHERE user_id=$1 AND withdrawable_at < $2', [user.id, Date.now()]);
  const vcoinUnlocked = parseInt(unlocked?.total || 0);
  const totalAvailable = user.ncoin + vcoinUnlocked;

  if (amount > totalAvailable) return res.redirect(`/wallet?error=Số dư có thể rút không đủ (Ncoin: ${user.ncoin.toLocaleString('vi-VN')} + Vcoin đã mở khóa: ${vcoinUnlocked.toLocaleString('vi-VN')})`);
  if (!['momo','bank','phonecard'].includes(method)||!detail) return res.redirect('/wallet?error=Vui lòng nhập đầy đủ thông tin');

  // Tinh phi
  const withdrawCount = await db.get("SELECT COUNT(*) as c FROM withdrawals WHERE user_id=$1 AND status IN ('approved','pending')", [user.id]);
  const isFirst = parseInt(withdrawCount.c) === 0;
  const fee = isFirst ? feeFirst : Math.round(amount * feePercent);
  const amountAfterFee = amount - fee;

  // Uu tien tru Ncoin truoc
  let deductNcoin = Math.min(user.ncoin, amount);
  let deductVcoin = amount - deductNcoin;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (deductNcoin > 0) await client.query('UPDATE users SET ncoin=ncoin-$1 WHERE id=$2', [deductNcoin, user.id]);
    if (deductVcoin > 0) await client.query('UPDATE users SET vcoin=vcoin-$1 WHERE id=$2', [deductVcoin, user.id]);
    await client.query(`INSERT INTO withdrawals (user_id,amount,method,detail,status,fee,created_at) VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
      [user.id, amount, method, detail, fee, Date.now()]);
    await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'withdraw',$2,'ncoin',$3,$4)`,
      [user.id, amount, `Rút tiền qua ${method} (phí: ${fee.toLocaleString('vi-VN')}đ)`, Date.now()]);
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
