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
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { getLevelInfo, getLevelTag } = require('./lib/level');
const { getClientIp } = require('./lib/ip');

const app = express();
app.set('trust proxy', 1); // Railway dung reverse proxy, can cai nay de doc dung IP that cua user
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

function auth(req, res, next) { if (!req.user) return res.redirect('/login'); next(); }
// (Kiem tra quyen admin gio nam ben trong routes/admin.js, chi ap dung cho
// duong dan bat dau bang '/admin' - xem giai thich chi tiet o gan cuoi file
// nay, cho dong "app.get('/', ...)")

// Chong brute-force / spam dang nhap, dang ky
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
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
