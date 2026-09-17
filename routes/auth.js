const express = require('express');
const crypto = require('crypto');
const { getClientIp } = require('../lib/ip');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { getTierFromCount, parseReferralSettings, getMonthStart } = require('../lib/referral');
const { verifyTurnstile } = require('../lib/turnstile');
const { logSecurityEvent } = require('../lib/securityLog');
const router = express.Router();

router.get('/register', (req, res) => res.render('register', { error: null, refCode: req.query.ref || '' }));

// Sinh 1 ma gioi thieu ngau nhien chua ton tai (thu toi da vai lan de tranh trung)
async function generateReferralCode() {
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await db.get('SELECT 1 FROM users WHERE referral_code=$1', [code]);
    if (!exists) return code;
  }
  // Cuc hiem khi xay ra 10 lan trung lien tiep - fallback dai hon de chac chan khong trung
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

router.post('/register', async (req, res) => {
  const { username, password, password2 } = req.body;
  const refCodeInput = (req.body.ref || '').trim().toUpperCase();
  const fp = req.body.fingerprint || '';
  const ip = getClientIp(req);

  // HONEYPOT: o rieng dau tien, TRUOC ca validate binh thuong. Field nay an
  // bang CSS (xem public/css/style.css .hp-field) nen nguoi that khong bao
  // gio dien - script tu dong dien toan bo form (ke ca field an) thi se dinh.
  // Tra ve THANH CONG GIA (chuyen huong ve /login nhu the dang ky thanh cong)
  // thay vi bao loi, de KHONG "day" cho bot biet no bi phat hien va doi cach
  // tan cong khac - trong khi that ra khong co tai khoan nao duoc tao ca.
  if (req.body.hp_field) {
    await logSecurityEvent('honeypot', { ip, detail: 'Điền vào honeypot field ở form đăng ký' });
    return res.redirect('/login');
  }

  const turnstileResult = await verifyTurnstile(req.body['cf-turnstile-response'], ip);
  if (!turnstileResult.success) {
    return res.render('register', { error: 'Xác minh bảo mật thất bại, vui lòng thử lại.', refCode: refCodeInput });
  }

  if (!username || !password || password.length < 6)
    return res.render('register', { error: 'Tên đăng nhập và mật khẩu tối thiểu 6 ký tự là bắt buộc.', refCode: refCodeInput });
  // VA LOI: truoc day khong gioi han ky tu/do dai username o phia server (chi
  // co goi y o placeholder). Them validate co ban de tranh du lieu ky la.
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username))
    return res.render('register', { error: 'Tên đăng nhập chỉ gồm chữ, số, dấu gạch dưới, từ 4-20 ký tự.', refCode: refCodeInput });
  if (password !== password2)
    return res.render('register', { error: 'Mật khẩu nhập lại không khớp.', refCode: refCodeInput });

  // VA LOI: kiem tra trung ten khong phan biet hoa/thuong (tranh vua co
  // "NguyenVanA" vua co "nguyenvana" gay nham lan khi dang nhap)
  const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (existing) return res.render('register', { error: 'Tên đăng nhập đã tồn tại.', refCode: refCodeInput });

  const hash = bcrypt.hashSync(password, 10);
  const myReferralCode = await generateReferralCode();

  // Tim nguoi gioi thieu tu ma nhap vao (khong bat buoc). Khong bao loi neu
  // ma sai/khong ton tai - chi don gian dang ky binh thuong khong co nguoi
  // gioi thieu, tranh gay kho chiu cho nguoi dung vi 1 ma gioi thieu sai.
  let referrer = null;
  if (refCodeInput) {
    referrer = await db.get('SELECT id FROM users WHERE referral_code=$1', [refCodeInput]);
  }

  // VA LOI RACE CONDITION NHE: kiem tra ton tai roi moi INSERT khong atomic.
  // Neu 2 request dang ky cung username gan nhu dong thoi, ca 2 co the vuot
  // qua check phia tren roi cung INSERT -> rang buoc UNIQUE trong DB se chan
  // 1 trong 2, nem loi "duplicate key". Bat loi nay rieng de tra thong bao
  // than thien thay vi de loi tho bay len (du da co luoi an toan chung o
  // server.js, nhung o day tra thong bao ro rang hon cho nguoi dung).
  let row;
  try {
    row = await db.get(
      `INSERT INTO users (username, password_hash, ncoin, vcoin, exp, level, is_admin, created_at, reg_ip, reg_fingerprint, referral_code, referred_by)
       VALUES ($1,$2,0,0,0,1,0,$3,$4,$5,$6,$7) RETURNING id`,
      [username, hash, Date.now(), ip, fp, myReferralCode, referrer ? referrer.id : null]
    );
  } catch (e) {
    if (e.code === '23505') return res.render('register', { error: 'Tên đăng nhập đã tồn tại.', refCode: refCodeInput });
    throw e;
  }

  // Cap nhat thong ke cho nguoi gioi thieu: dem lai tong so nguoi da gioi
  // thieu duoc (tinh ca nguoi vua dang ky nay), xac dinh bac hoa hong moi
  // (neu cao hon bac cu thi MO KHOA VINH VIEN, khong bao gio ha xuong), va
  // cong so luot gioi thieu trong thang cho bang xep hang thang.
  if (referrer) {
    try {
      const cnt = await db.get('SELECT COUNT(*)::int as c FROM users WHERE referred_by=$1', [referrer.id]);
      const settingsRows = await db.q('SELECT * FROM settings');
      const rs = parseReferralSettings(settingsRows);
      const newTier = getTierFromCount(cnt.c, rs);
      await db.run(
        'UPDATE users SET referral_tier_locked = GREATEST(referral_tier_locked, $1) WHERE id=$2',
        [newTier, referrer.id]
      );
      const monthStart = getMonthStart();
      await db.run(
        `INSERT INTO referral_monthly (user_id, month_start, ref_count, commission_earned) VALUES ($1,$2,1,0)
         ON CONFLICT (user_id, month_start) DO UPDATE SET ref_count = referral_monthly.ref_count + 1`,
        [referrer.id, monthStart]
      );
    } catch (e) {
      // Khong de loi thong ke gioi thieu lam hong ca qua trinh dang ky -
      // tai khoan van duoc tao binh thuong, chi thieu cap nhat thong ke.
      console.error('Loi cap nhat thong ke gioi thieu:', e);
    }
  }

  req.session.userId = row.id;
  res.redirect('/dashboard');
});

router.get('/login', (req, res) => res.render('login', { error: null }));

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = getClientIp(req);

  // HONEYPOT: tra ve DUNG THONG BAO LOI giong sai mat khau (khong phai
  // thanh cong gia nhu o dang ky, vi dang nhap khong tao ra du lieu moi de
  // "gia lap" thanh cong mot cach an toan) - bot khong the phan biet duoc
  // day la vi honeypot hay vi sai mat khau that.
  if (req.body.hp_field) {
    await logSecurityEvent('honeypot', { ip, detail: 'Điền vào honeypot field ở form đăng nhập' });
    return res.render('login', { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }

  const turnstileResult = await verifyTurnstile(req.body['cf-turnstile-response'], ip);
  if (!turnstileResult.success) {
    return res.render('login', { error: 'Xác minh bảo mật thất bại, vui lòng thử lại.' });
  }

  // VA LOI: dang nhap khong phan biet hoa/thuong, khop voi cach dang ky da chan trung o tren
  const user = await db.get('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.render('login', { error: 'Sai tên đăng nhập hoặc mật khẩu.' });

  if (user.is_banned) return res.render('login', { error: 'Tài khoản của bạn đã bị khóa. Liên hệ admin để biết thêm chi tiết.' });

  req.session.userId = user.id;

  // Ghi nhat ky dang nhap
  await db.run(
    'INSERT INTO login_logs (user_id, ip, user_agent, created_at) VALUES ($1,$2,$3,$4)',
    [user.id, ip, req.headers['user-agent'] || '', Date.now()]
  );
  // Xoa log cu hon 7 ngay
  await db.run('DELETE FROM login_logs WHERE user_id=$1 AND created_at < $2', [user.id, Date.now() - 7*24*60*60*1000]);

  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
module.exports = router;
