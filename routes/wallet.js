const express = require('express');
const db = require('../db');
const { getLevelInfo, getLevelTag } = require('../lib/level');
const { getClientIp } = require('../lib/ip');
const { verifyTurnstile } = require('../lib/turnstile');
const { logSecurityEvent } = require('../lib/securityLog');
const router = express.Router();

// Anh xa ten tier (label tra ve tu getLevelTag) sang key luu trong settings
const TIER_SETTING_KEY = {
  Rookie: 'withdraw_fee_rookie',
  Silver: 'withdraw_fee_silver',
  Gold: 'withdraw_fee_gold',
  Platinum: 'withdraw_fee_platinum',
  Diamond: 'withdraw_fee_diamond',
  Legend: 'withdraw_fee_legend',
};

const PG_INT_MAX = 2147483647;

async function getFeeForUser(user) {
  const tag = getLevelTag(getLevelInfo(user.exp).level);
  const key = TIER_SETTING_KEY[tag.label] || 'withdraw_fee_rookie';
  const row = await db.get('SELECT value FROM settings WHERE key=$1', [key]);
  return { fee: parseInt(row?.value || 0), tierLabel: tag.label, tierTag: tag };
}

router.get('/wallet', async (req, res) => {
  const user = req.user;
  const settings = await db.q("SELECT * FROM settings WHERE key IN ('withdraw_min','withdraw_notice','vcoin_lockdays')");
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const history = await db.q('SELECT * FROM withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [user.id]);

  const lockDays = parseInt(s.vcoin_lockdays || 28);
  const unlocked = await db.get(
    'SELECT COALESCE(SUM(amount),0) as total FROM topups WHERE user_id=$1 AND withdrawable_at < $2',
    [user.id, Date.now()]
  );
  // VA LOI DA SUA (2026-09): SUM(amount) o tren la TONG GOC cua cac lan nap da
  // qua han khoa 28 ngay - no KHONG tru di phan Vcoin da tieu roi (mua Shop
  // hoac da rut truoc do), vi Vcoin la 1 quy chung (users.vcoin), khong theo
  // doi rieng tung lan nap da bi tieu bao nhieu. Vi vay so nay co the LON HON
  // user.vcoin thuc te dang co -> hien thi sai, gay hieu lam "con nhieu Vcoin
  // rut duoc" hon so voi that. Cach an toan/dung nhat: gioi han lai bang
  // Math.min voi so du Vcoin THAT SU dang co.
  const vcoinUnlocked = Math.min(parseInt(unlocked?.total || 0), user.vcoin);
  const { fee: currentFee, tierLabel, tierTag } = await getFeeForUser(user);

  res.render('wallet', { user, settings: s, history,
    vcoinUnlocked, currentFee, tierLabel, tierTag,
    error: req.query.error||null, ok: req.query.ok||null });
});

router.post('/wallet/withdraw', async (req, res) => {
  const user = req.user;
  const ip = getClientIp(req);

  // HONEYPOT + Turnstile: rut tien la noi tao gia tri (tien that ra khoi he
  // thong) nen ap dung ca 2 lop giong dang ky/dang nhap. Honeypot dinh bay
  // thi tra ve loi chung chung, khong tiet lo ly do that.
  if (req.body.hp_field) {
    await logSecurityEvent('honeypot', { ip, userId: user.id, detail: 'Điền vào honeypot field ở form rút tiền' });
    return res.redirect('/wallet?error=Có lỗi xảy ra, vui lòng thử lại');
  }
  const turnstileResult = await verifyTurnstile(req.body['cf-turnstile-response'], ip);
  if (!turnstileResult.success) {
    return res.redirect('/wallet?error=Xác minh bảo mật thất bại, vui lòng thử lại');
  }

  const amount = parseInt(req.body.amount, 10);
  const { method, detail } = req.body;
  const settings = await db.q("SELECT * FROM settings WHERE key IN ('withdraw_min','vcoin_lockdays')");
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const min = parseInt(s.withdraw_min || 20000);

  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > PG_INT_MAX) {
    return res.redirect('/wallet?error=Số tiền không hợp lệ');
  }
  if (amount < min) return res.redirect(`/wallet?error=Số tiền rút tối thiểu là ${min.toLocaleString('vi-VN')}đ`);
  if (!['momo','bank','phonecard'].includes(method)||!detail) return res.redirect('/wallet?error=Vui lòng nhập đầy đủ thông tin');

  // Phi rut tinh theo cap do (tier) hien tai cua user
  const { fee } = await getFeeForUser(user);

  // VA LOI DA SUA (2026-09, "rút 10k phí 2500 thì phải có 12k5"): truoc day
  // "fee" chi duoc GHI NHAN de hien thi, KHONG THUC SU bi tru khoi vi - nguoi
  // dung rut duoc dung "amount" ho yeu cau ma khong can du them tien cho phi.
  // Gio phi la khoan THEM VAO TREN "amount" (khong phai tru bot tu amount):
  // muon rut ve tay "amount" thi vi phai co it nhat "amount + fee".
  const totalCharge = amount + fee;

  // VA LOI RACE CONDITION (TOCTOU): truoc day so du duoc doc tu req.user (da
  // load san tu dau request, "cu"), roi UPDATE ncoin=ncoin-$1 / vcoin=vcoin-$1
  // KHONG co dieu kien rang buoc so du con lai. Neu nguoi dung (hoac script)
  // gui nhieu request rut tien DONG THOI, moi request deu thay so du cu con
  // du dieu kien, va deu duoc tru -> so du co the bi tru am, tuc rut duoc
  // nhieu hon so du that su co (that thoat tien that).
  //
  // Cach sua: dung SELECT ... FOR UPDATE de KHOA dong user ngay trong
  // transaction (cac transaction khac phai doi den khi transaction nay
  // commit/rollback moi doc duoc), doc lai so du MOI NHAT ngay luc do, roi
  // moi kiem tra + tru. Dong thoi them dieu kien "AND ncoin>=$1" /
  // "AND vcoin>=$1" ngay trong cau UPDATE nhu 1 lop phong thu thu 2.
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const lockRes = await client.query('SELECT ncoin, vcoin FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const freshUser = lockRes.rows[0];
    if (!freshUser) { await client.query('ROLLBACK'); return res.redirect('/wallet?error=Tài khoản không tồn tại'); }

    const unlockedRes = await client.query(
      'SELECT COALESCE(SUM(amount),0) as total FROM topups WHERE user_id=$1 AND withdrawable_at < $2',
      [user.id, Date.now()]
    );
    // Cung 1 loai loi da sua o GET /wallet phia tren - gioi han lai bang so
    // Vcoin THAT SU dang co (freshUser.vcoin, vua khoa dong o tren) de khong
    // tinh du thua phan da tieu roi.
    const freshVcoinUnlocked = Math.min(parseInt(unlockedRes.rows[0]?.total || 0), freshUser.vcoin);
    const totalAvailable = freshUser.ncoin + freshVcoinUnlocked;

    if (totalCharge > totalAvailable) {
      await client.query('ROLLBACK');
      return res.redirect(`/wallet?error=Số dư không đủ - cần ${totalCharge.toLocaleString('vi-VN')} coin (${amount.toLocaleString('vi-VN')} rút + ${fee.toLocaleString('vi-VN')} phí), hiện có Ncoin: ${freshUser.ncoin.toLocaleString('vi-VN')} + Vcoin đã mở khóa: ${freshVcoinUnlocked.toLocaleString('vi-VN')}`);
    }

    // Uu tien tru Ncoin truoc - tru DU CA PHI (totalCharge), khong chi tru "amount"
    let deductNcoin = Math.min(freshUser.ncoin, totalCharge);
    let deductVcoin = totalCharge - deductNcoin;

    if (deductVcoin > freshUser.vcoin) {
      // Phong thu them: khong the tru vcoin nhieu hon so du vcoin thuc te dang co
      await client.query('ROLLBACK');
      return res.redirect('/wallet?error=Số dư không đủ, vui lòng thử lại');
    }

    if (deductNcoin > 0) {
      const r1 = await client.query('UPDATE users SET ncoin=ncoin-$1 WHERE id=$2 AND ncoin>=$1', [deductNcoin, user.id]);
      if (r1.rowCount === 0) throw new Error('Không đủ Ncoin (race condition đã bị chặn)');
    }
    if (deductVcoin > 0) {
      const r2 = await client.query('UPDATE users SET vcoin=vcoin-$1 WHERE id=$2 AND vcoin>=$1', [deductVcoin, user.id]);
      if (r2.rowCount === 0) throw new Error('Không đủ Vcoin (race condition đã bị chặn)');
    }
    // Luu lai DUNG ty le Ncoin/Vcoin da tru (ncoin_used/vcoin_used) - de neu
    // admin tu choi sau nay, hoan tien LAI DUNG LOAI COIN da tru, khong hoan
    // nham tat ca thanh Ncoin (xem giai thich chi tiet trong db.js, cho ALTER
    // TABLE withdrawals ADD COLUMN ncoin_used/vcoin_used).
    await client.query(`INSERT INTO withdrawals (user_id,amount,method,detail,status,fee,ncoin_used,vcoin_used,created_at) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8)`,
      [user.id, amount, method, detail, fee, deductNcoin, deductVcoin, Date.now()]);
    // VA LOI GHI SAI LICH SU GIAO DICH DA SUA (2026-09, cung loai voi loi da
    // sua o routes/shop.js): truoc day LUON ghi 1 dong voi coin_type CO DINH
    // la 'ncoin' va amount = totalCharge, du thuc te co the da tru MOT PHAN
    // hoac TOAN BO tu Vcoin (deductVcoin). Bang "withdrawals" van luu dung
    // ncoin_used/vcoin_used nen tien khong sai, day CHI la lich su/thong ke
    // trong bang "transactions" bi sai lech theo loai coin. Gio tach dung.
    if (deductNcoin > 0) {
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'withdraw',$2,'ncoin',$3,$4)`,
        [user.id, deductNcoin, `Rút ${amount.toLocaleString('vi-VN')}đ qua ${method} (phí: ${fee.toLocaleString('vi-VN')}đ, tổng trừ: ${totalCharge.toLocaleString('vi-VN')})`, Date.now()]);
    }
    if (deductVcoin > 0) {
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'withdraw',$2,'vcoin',$3,$4)`,
        [user.id, deductVcoin, `Rút ${amount.toLocaleString('vi-VN')}đ qua ${method} (phí: ${fee.toLocaleString('vi-VN')}đ, tổng trừ: ${totalCharge.toLocaleString('vi-VN')})`, Date.now()]);
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); return res.redirect('/wallet?error=Lỗi, thử lại sau'); }
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
