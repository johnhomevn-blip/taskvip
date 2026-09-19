require('dotenv').config();
// PHAI require truoc khi khai bao routes: tu dong bat loi trong cac async
// route handler va chuyen ve middleware xu ly loi thay vi lam crash ca server.
// (Va lo DoS nghiem trong: truoc day 1 request voi id/tid khong phai so
// (vd GET /verify?tid=abc) se lam crash toan bo tien trinh Node vi khong ai
// bat loi Postgres nem ra tu 1 Promise trong async handler.)
require('express-async-errors');

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgSessionStore = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { getLevelInfo, getLevelTag } = require('./lib/level');
const { getClientIp } = require('./lib/ip');

const app = express();
app.set('trust proxy', 1); // Railway dung reverse proxy, can cai nay de doc dung IP that cua user

// VA LOI DA SUA (2026-09, "IP đăng ký toàn hiện 1 IP"): ban dang chay QUA 2
// LOP trung gian chong len nhau - Cloudflare (proxy DNS/SSL) ROI MOI toi
// Railway (co reverse proxy rieng cua no). "trust proxy: 1" o tren CHI tin 1
// lop duy nhat, nen req.ip tinh ra thuc chat la IP CUA CLOUDFLARE (hoac cua
// Railway) - GIONG HET NHAU cho MOI nguoi dung that di qua, khong con la IP
// that cua tung nguoi nua. Day chinh la ly do ban thay "user khac nhau ma
// toan hien 1 IP".
//
// Cach sua DUNG khong phai la doan so tang "trust proxy" len 2 (so lop that
// su co the thay doi tuy Railway, doan sai van sai) - ma la CHUYEN HAN sang
// doc header "CF-Connecting-IP" ma CHINH CLOUDFLARE gan vao (khong phai
// client tu dat), vi day la nguon dang tin nhat khi da dung Cloudflare. Xem
// lib/ip.js de biet chi tiet + cach BAT tinh nang nay (TRUST_CF_HEADER=1).
//
// NHUNG chi bat TRUST_CF_HEADER=1 thoi la CHUA DU AN TOAN: neu domain goc
// tren Railway (dang *.up.railway.app) van truy cap truc tiep duoc (khong
// qua Cloudflare), ai do co the vao thang domain do va TU DAT header
// "CF-Connecting-IP" thanh bat ky gia tri gia mao nao ho muon, vi luc nay
// khong co Cloudflare o giua de ghi de header that vao. De dong lo hong nay,
// middleware duoi day CHUYEN HUONG moi request khong den tu domain chinh
// thuc (CANONICAL_HOST) sang domain chinh thuc - dam bao MOI request thuc su
// duoc xu ly deu da di qua Cloudflare that su truoc do (Cloudflare se tu ghi
// de header CF-Connecting-IP dung, xoa moi gia tri gia mao truoc do).
//
// CACH BAT: dat 2 bien moi truong tren Railway:
//   CANONICAL_HOST=4ummo.com  (hoac www.4ummo.com, dung dung ten mien that ban dang dung qua Cloudflare)
//   TRUST_CF_HEADER=1
// Neu KHONG dat CANONICAL_HOST, middleware nay se tu bo qua (khong lam gi ca)
// de khong lam hong moi truong dev/test cuc bo (localhost).
if (process.env.CANONICAL_HOST) {
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    if (host !== process.env.CANONICAL_HOST.toLowerCase()) {
      return res.redirect(301, `https://${process.env.CANONICAL_HOST}${req.originalUrl}`);
    }
    next();
  });
}

// LOP PHONG THU CHAC CHAN HON cho van de Cloudflare/Railway o tren: kiem tra
// Host header (o tren) CHi dam bao request "tu xung" la den tu dung ten mien
// - KHONG dam bao request do THAT SU di qua Cloudflare (tuy vao cach Railway
// dinh tuyen noi bo theo Host header ma client tu dat, ke gian van co the
// gia mao duoc). Cach dam bao CHAC CHAN hon: 1 header BI MAT ma CHI
// Cloudflare moi chen duoc vao request (qua Transform Rule), khong the bi
// client tu dat vi Cloudflare se GHI DE bat ky gia tri client tu gui truoc
// do bang gia tri that cua no.
//
// CACH BAT (tuy chon, khong bat buoc - neu khong dat CF_ORIGIN_SECRET thi bo
// qua kiem tra nay, khong lam hong gi ca):
//   1) Vao Cloudflare Dashboard > ten mien > Rules > Transform Rules >
//      Modify Request Header > tao rule: "Set static" header ten
//      "X-Origin-Secret" gia tri la 1 chuoi ngau nhien dai (tu tao, giu bi
//      mat), ap dung cho MOI request (hoac it nhat cho /verify, /login,
//      /register, /wallet/withdraw).
//   2) Dat CUNG chuoi do vao bien moi truong CF_ORIGIN_SECRET tren Railway.
// Sau khi bat ca 2, request nao KHONG mang dung header nay se bi tu choi -
// nghia la request phai THAT SU di qua Cloudflare (noi header duoc chen vao
// that su), khong con cach nao goi thang toi Railway ma gia mao duoc nua.
if (process.env.CF_ORIGIN_SECRET) {
  app.use((req, res, next) => {
    if (req.headers['x-origin-secret'] !== process.env.CF_ORIGIN_SECRET) {
      return res.status(403).send('Không có quyền truy cập trực tiếp.');
    }
    next();
  });
}

// VA LOI DA SUA (2026-09, "IP hien sai, hien 1 IP la khong phai cua toi"):
// truoc day neu CHI bat TRUST_CF_HEADER=1 + CANONICAL_HOST (thieu
// CF_ORIGIN_SECRET), he thong VAN tin header CF-Connecting-IP - nhung
// middleware CANONICAL_HOST o tren CHI kiem tra header "Host" (client tu
// khai bao, gia mao duoc de dang bang curl/Postman goi thang toi domain
// Railway goc) nen KHONG THAT SU dam bao request da di qua Cloudflare. Ke
// gia mao co the tu dat ca Host lan CF-Connecting-IP tuy y. lib/ip.js gio DA
// SUA: chi tin CF-Connecting-IP khi CF_ORIGIN_SECRET cung duoc cau hinh (xem
// giai thich day du trong lib/ip.js). Canh bao nay nhac lai moi lan khoi
// dong de admin khong bo sot buoc cuoi cung.
if (process.env.TRUST_CF_HEADER === '1' && !process.env.CF_ORIGIN_SECRET) {
  console.warn('======================================================');
  console.warn('[CANH BAO IP] TRUST_CF_HEADER=1 nhung CHUA dat CF_ORIGIN_SECRET.');
  console.warn('[CANH BAO IP] He thong dang TAM THOI BO QUA header CF-Connecting-IP');
  console.warn('[CANH BAO IP] (vi khong the xac minh no that su den tu Cloudflare) va');
  console.warn('[CANH BAO IP] dung req.ip thay the - IP hien thi cho nguoi dung CO THE');
  console.warn('[CANH BAO IP] VAN SAI (vd hien IP cua Cloudflare/Railway thay vi IP that).');
  console.warn('[CANH BAO IP] Xem huong dan bat CF_ORIGIN_SECRET trong Admin > tab Bảo mật.');
  console.warn('======================================================');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Site key Turnstile la du lieu CONG KHAI (khac voi secret key - secret key
// KHONG BAO GIO duoc dua ra views, chi dung o phia server trong lib/turnstile.js).
// Dat lam app.locals de MOI view EJS deu tu dong co bien turnstileSiteKey ma
// khong can tung route phai truyen rieng.
app.locals.turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '';

// "Cache busting" cho CSS/JS tinh (public/css/*.css, public/js/*.js): moi
// view gan ?v=<assetVersion> vao sau ten file (vd /css/style.css?v=173...),
// de trinh duyet VA Cloudflare coi day la 1 URL HOAN TOAN MOI moi lan
// server khoi dong lai (deploy moi) - buoc phai tai lai file that, khong
// con dung ban cache cu.
//
// VA LOI DA SUA (2026-09, "bấm ctrl shift+R là nó mất cái ô đó"): truoc day
// KHONG co co che nay - moi lan sua CSS/JS va deploy, Cloudflare/trinh duyet
// van tiep tuc phuc vu ban CACHE CU cho nguoi dung that (ho khong biet de tu
// bam hard refresh nhu luc debug), khien thay doi giao dien khong len duoc
// cho ai ca cho toi khi cache tu het han hoac ai do vo tinh xoa cache.
// RAILWAY_DEPLOYMENT_ID la bien Railway tu dong cung cap moi lan deploy
// (doi moi lien tuc); fallback ve gio khoi dong server neu chay o moi
// truong khac Railway (vd may local).
app.locals.assetVersion = process.env.RAILWAY_DEPLOYMENT_ID || String(Date.now());

// VA LOI BAO MAT: truoc day neu thieu SESSION_SECRET, server dung 1 chuoi
// co dinh ('taskvip-secret-2026') ghi thang trong source. Ai doc duoc source
// deu co the tu tao/gia mao cookie session (vd gia mao userId cua admin).
// Bay gio: uu tien SESSION_SECRET trong .env (khuyen nghi de session on dinh
// qua cac lan restart); neu chua set thi tu sinh ngau nhien cho phien chay nay.
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[CANH BAO BAO MAT] Chua set SESSION_SECRET trong .env, da tu sinh ngau nhien.');
  console.warn('[CANH BAO BAO MAT] Toan bo nguoi dung se bi dang xuat moi khi server restart. Nen set SESSION_SECRET co dinh trong .env.');
}

app.use(session({
  // VA LOI DA SUA (2026-09): truoc day KHONG cau hinh "store" gi ca, nen
  // express-session tu dung MemoryStore mac dinh - ban than thu vien nay tu
  // canh bao "not designed for a production environment". Hau qua thuc te:
  // moi lan Railway deploy/restart server (xay ra kha thuong xuyen moi lan
  // sua code), TOAN BO du lieu session nam trong RAM bien mat -> TAT CA user
  // dang dang nhap deu bi dang xuat dot ngot, du SESSION_SECRET co dinh hay
  // khong (SESSION_SECRET chi chong gia mao chu ky cookie, khong lam session
  // "song lai" neu du lieu that su da mat khoi bo nho). Neu sau nay chay
  // nhieu instance cung luc, cac instance cung KHONG chia se duoc session voi
  // nhau (dang nhap o instance A, sang instance B lai bi coi la chua dang nhap).
  // Gio luu session vao CHINH Postgres dang dung san (bang rieng
  // "user_sessions", tu tao neu chua co) qua connect-pg-simple - session song
  // sot qua restart/deploy VA dung chung duoc cho nhieu instance sau nay.
  store: new PgSessionStore({
    pool: db,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 60, // tu don session het han moi gio (giay)
  }),
  secret: SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: {
    maxAge: 7*24*60*60*1000,
    httpOnly: true,      // JS phia client khong doc duoc cookie session -> giam rui ro XSS danh cap session
    sameSite: 'lax',     // giam rui ro CSRF tu request xuyen trang
    secure: 'auto'        // tu dong bat "Secure" khi ket noi qua HTTPS (ho tro qua reverse proxy nho trust proxy)
  }
}));

app.use(async (req, res, next) => {
  if (req.session.userId) {
    req.user = await db.get('SELECT * FROM users WHERE id=$1', [req.session.userId]);
    if (req.user) {
      const li = getLevelInfo(req.user.exp);
      req.user.levelInfo = li;
      req.user.levelTag = getLevelTag(li.level);
      if (req.user.level !== li.level) {
        await db.run('UPDATE users SET level=$1 WHERE id=$2', [li.level, req.user.id]);
        req.user.level = li.level;
      }
    }
  }
  res.locals.user = req.user || null;
  next();
});


function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Lay popup active cho tat ca trang
app.use(async (req, res, next) => {
  const popup = await db.get("SELECT * FROM popups WHERE active=1 ORDER BY created_at DESC LIMIT 1");
  if (popup) {
    // Escape truoc, roi moi chen <br> that su -> vua tranh XSS neu noi dung
    // popup vo tinh chua ky tu HTML, vua hien thi xuong dong dung (sua loi
    // hien thi cu: <%= %> escape SAU khi da chen <br> nen <br> bi hien thanh chu).
    popup.content = escapeHtml(popup.content).replace(/\n/g, '<br>');
  }
  res.locals.activePopup = popup || null;
  next();
});

// Cho sidebar (va cac trang lien quan) biet BXH tuan/BXH gioi thieu dang
// bat hay tat, de AN HAN muc menu tuong ung thay vi dua nguoi dung vao 1
// trang chi co dong chu "tinh nang dang tat" (yeu cau 2026-09: tat la phai
// "bien mat" that su, khong chi an du lieu ben trong).
app.use(async (req, res, next) => {
  const rows = await db.q("SELECT key,value FROM settings WHERE key IN ('ranking_enabled','referral_ranking_enabled')");
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.locals.rankingEnabled = s.ranking_enabled === '1';
  res.locals.referralRankingEnabled = s.referral_ranking_enabled !== '0';
  next();
});

function auth(req, res, next) { if (!req.user) return res.redirect('/login'); next(); }
// (Kiem tra quyen admin gio nam ben trong routes/admin.js, chi ap dung cho
// duong dan bat dau bang '/admin' - xem giai thich chi tiet o gan cuoi file
// nay, cho dong "app.get('/', ...)")

// Chong brute-force / spam dang nhap, dang ky
// VA LOI DA SUA (2026-09): truoc day dung keyGenerator MAC DINH cua thu vien
// (dua vao req.ip) - nhung req.ip van dinh DUNG lo hong 2 tang proxy
// Cloudflare+Railway ma ban da tu phat hien va va cho getClientIp() (xem
// lib/ip.js), CHI RIENG rate-limiter nay quen chua ap dung cung cach va do.
// Hau qua thuc te: rate-limiter co the dang tinh CHUNG 1 "IP" (IP cua tang
// proxy trung gian, giong het nhau cho MOI nguoi dung that) cho tat ca moi
// nguoi - nghia la CHI CAN gop du 30 luot dang nhap/dang ky/rut tien tu TAT
// CA nguoi dung cong lai trong 15 phut la TOAN BO site tu khoa lan nhau,
// khong ai spam gi ca. Gio dung CHINH getClientIp() de dong bo voi phan con
// lai cua he thong - moi nguoi dung that su co 1 "bucket" gioi han rieng.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau ít phút.'
});

// Trang chu cong khai (khong can dang nhap) - dat O DAY, TRUOC cac router
// yeu cau dang nhap (auth), de nguoi chua dang nhap vao "/" thay trang gioi
// thieu dep thay vi bi ep chuyen huong sang /login ngay lap tuc.
//
// VA LOI NGHIEM TRONG DA SUA: truoc day dong "app.get('/', ...)" nay nam O
// CUOI, SAU dong "app.use('/', auth, admin, require('./routes/admin'))".
// Vi router admin duoc mount o prefix '/' (de cac duong dan noi bo nhu
// '/admin/tasks' hoat dong), MOI request toi 1 duong dan khong khop voi bat
// ky router nao truoc do (bao gom chinh trang chu '/') deu roi xuong toi tan
// day va bi middleware "admin" chan lai bang 403 "Khong co quyen" - ngay ca
// khi nguoi dung DA dang nhap binh thuong (chi khong phai la admin)! Day
// chinh xac la loi "vao 4ummo.com bao khong co quyen" ma chu web gap phai.
// Sua bang 2 cach ket hop: (1) chuyen '/' len day, xu ly truoc khi cham toi
// router admin; (2) gioi han pham vi middleware "admin" chi ap dung cho
// duong dan bat dau bang '/admin' (xem routes/admin.js), thay vi ap dung cho
// TOAN BO request nhu truoc, de moi duong dan khac (bao gom 404 that su) van
// roi qua binh thuong thay vi bi chan oan.
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('landing');
});

// Public
app.use('/login', authLimiter);
app.use('/register', authLimiter);
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/verify'));

// Setup admin
// VA LOI BAO MAT: truoc day route nay hoan toan cong khai, khong xac thuc gi ca.
// Neu ai do truy cap URL nay truoc ban (vd do bot quet URL, hoac domain bi lo
// truoc khi ban kip setup), ho se chiem duoc tai khoan admin voi mat khau
// co dinh 'Admin@2026' viet san trong source.
// Bay gio: can token ngau nhien duoc in ra console log moi lan server khoi
// dong. Chi ai xem duoc log server (tuc chu server that su) moi lay duoc token.
const SETUP_TOKEN = crypto.randomBytes(16).toString('hex');
console.log('======================================================');
console.log('[SETUP ADMIN] Truy cap URL sau (CHI 1 LAN, khi chua co admin) de tao tai khoan admin dau tien:');
console.log(`  /setup-admin-taskvip?token=${SETUP_TOKEN}`);
console.log('[SETUP ADMIN] Token nay chi ton tai trong phien chay nay, sau khi tao admin xong hay dang nhap va DOI MAT KHAU ngay.');
console.log('======================================================');
app.get('/setup-admin-taskvip', async (req, res) => {
  if (!req.query.token || req.query.token !== SETUP_TOKEN) {
    return res.status(403).send('Không có quyền truy cập.');
  }
  const ex = await db.get("SELECT id FROM users WHERE username='admin'");
  if (ex) return res.send('Admin đã tồn tại, vào /login để đăng nhập.');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Admin@2026', 10);
  await db.run(`INSERT INTO users (username,password_hash,ncoin,vcoin,exp,level,is_admin,created_at,reg_ip) VALUES ($1,$2,0,0,0,1,1,$3,$4)`,
    ['admin', hash, Date.now(), getClientIp(req)]);
  res.send('Tạo admin thành công! Đăng nhập: admin / Admin@2026 — Vui lòng đổi mật khẩu ngay sau khi đăng nhập.');
});

// Protected
app.use('/', auth, require('./routes/dashboard'));
app.use('/', auth, require('./routes/tasks'));
app.use('/wallet', authLimiter);
app.use('/', auth, require('./routes/wallet'));
app.use('/', auth, require('./routes/topup'));
app.use('/', auth, require('./routes/history'));
app.use('/', auth, require('./routes/shop'));
app.use('/', auth, require('./routes/ranking'));
app.use('/', auth, require('./routes/referral'));
app.use('/', auth, require('./routes/account'));
app.use('/', auth, require('./routes/regulations'));
app.use('/', auth, require('./routes/admin'));

// 404 cho route khong ton tai
app.use((req, res) => res.status(404).send('Không tìm thấy trang.'));

// VA LOI BAO MAT / DO TIN CAY: middleware xu ly loi tap trung. Ket hop voi
// 'express-async-errors' o dau file, moi loi nem ra tu route (vd Postgres bao
// loi vi id khong phai so, loi ket noi DB tam thoi, v.v.) se roi vao day va
// tra ve trang loi 500 gon gang thay vi lam sap toan bo server.
app.use((err, req, res, next) => {
  console.error('Loi khong mong muon:', err);
  if (res.headersSent) return next(err);
  res.status(500).send('Đã có lỗi xảy ra, vui lòng thử lại sau.');
});

// Luoi an toan cuoi cung: neu van co Promise loi khong ai bat duoc (vd trong
// code chay ngoai vong doi request), ghi log thay vi de Node.js crash tien trinh.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`4ummo chay tai http://localhost:${PORT}`));

// Tu dong trao thuong BXH tuan (dua top nhiem vu) + BXH thang (gioi thieu ban
// be) ngay khi chu ky vua ket thuc - xem giai thich chi tiet trong
// lib/rewardCron.js (bao gom quy tac CHI trao neu chu ky do THUC SU CO DU
// LIEU). Cho 15 giay truoc lan chay dau de db.js kip tao xong bang (init()
// chay ngam dinh khi require('./db') o tren, chua chac xong ngay lap tuc).
// Sau do kiem tra lai moi 15 phut - du day va an toan de goi nhieu lan.
const { checkAndDistributeAllRewards } = require('./lib/rewardCron');
setTimeout(() => checkAndDistributeAllRewards(), 15 * 1000);
setInterval(() => checkAndDistributeAllRewards(), 15 * 60 * 1000);

// Don dep thong tin giao hang (tai khoan/mat khau) qua han 30 ngay - xem
// lib/cleanupCron.js. Chay moi 6 tieng la du (khong can gap, day chi la don
// dep du lieu cu, khong anh huong trai nghiem nguoi dung).
const { purgeOldDeliveryInfo } = require('./lib/cleanupCron');
setTimeout(() => purgeOldDeliveryInfo(), 30 * 1000);
setInterval(() => purgeOldDeliveryInfo(), 6 * 60 * 60 * 1000);

// Cau dao (circuit breaker) chong dot bien Ncoin/gio - xem lib/breaker.js.
// Viec TRIGGER cau dao xay ra NGAY LAP TUC trong routes/verify.js (khong cho
// cron), cron nay CHI lo phan tu dong resume sau cooldown (va tu trigger lai
// neu bat thuong van tiep dien) - nen chay thuong xuyen (moi 1 phut) de
// khong lam nguoi dung/admin phai cho lau hon can thiet sau khi da on dinh.
const breakerLib = require('./lib/breaker');
setTimeout(() => breakerLib.tryAutoResume().catch(e => console.error('[CẦU DAO] Lỗi cron:', e)), 15 * 1000);
setInterval(() => breakerLib.tryAutoResume().catch(e => console.error('[CẦU DAO] Lỗi cron:', e)), 60 * 1000);
