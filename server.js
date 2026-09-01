require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'thay-doi-secret-nay',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// Nap thong tin user hien tai (neu da dang nhap) cho moi request
app.use((req, res, next) => {
  if (req.session.userId) {
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  }
  res.locals.currentUser = req.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).send('Không có quyền truy cập.');
  next();
}

// Routes cong khai (dang ky, dang nhap) + verify (nha cung cap goi ve, khong dang nhap)
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/verify'));
app.use('/', require('./routes/verify'));

// Route tao admin lan dau - XOA DONG NAY SAU KHI DA TAO XONG ADMIN
app.get('/setup-admin-taskvip', (req, res) => {
  const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (existing) return res.send('Admin đã tồn tại rồi, vào /login để đăng nhập.');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Admin@2026', 10);
  db.prepare('INSERT INTO users (username, password_hash, balance, exp, level, is_admin, created_at) VALUES (?,?,0,0,1,1,?)').run('admin', hash, Date.now());
  res.send('Tạo admin thành công! Vào /login đăng nhập bằng admin / Admin@2026');
});
app.use('/', require('./routes/verify'));
app.use('/', require('./routes/verify'));

// Routes can dang nhap
app.use('/', requireAuth, require('./routes/tasks'));
app.use('/', requireAuth, require('./routes/wallet'));

// Routes chi admin
app.use('/', requireAuth, requireAdmin, require('./routes/admin'));

app.get('/', (req, res) => res.redirect(req.user ? '/tasks' : '/login'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server đang chạy tại http://localhost:${PORT}`));
