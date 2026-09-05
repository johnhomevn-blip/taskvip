require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { getLevelInfo, getLevelTag } = require('./lib/level');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'taskvip-secret-2026',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 7*24*60*60*1000 }
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


// Lay popup active cho tat ca trang
app.use(async (req, res, next) => {
  const popup = await db.get("SELECT * FROM popups WHERE active=1 ORDER BY created_at DESC LIMIT 1");
  res.locals.activePopup = popup || null;
  next();
});

function auth(req, res, next) { if (!req.user) return res.redirect('/login'); next(); }
function admin(req, res, next) { if (!req.user?.is_admin) return res.status(403).send('Không có quyền'); next(); }

// Public
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/verify'));

// Setup admin
app.get('/setup-admin-taskvip', async (req, res) => {
  const ex = await db.get("SELECT id FROM users WHERE username='admin'");
  if (ex) return res.send('Admin đã tồn tại, vào /login để đăng nhập.');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Admin@2026', 10);
  await db.run(`INSERT INTO users (username,password_hash,ncoin,vcoin,exp,level,is_admin,created_at,reg_ip) VALUES ($1,$2,0,0,0,1,1,$3,$4)`,
    ['admin', hash, Date.now(), req.ip]);
  res.send('Tạo admin thành công! Đăng nhập: admin / Admin@2026');
});

// Protected
app.use('/', auth, require('./routes/dashboard'));
app.use('/', auth, require('./routes/tasks'));
app.use('/', auth, require('./routes/wallet'));
app.use('/', auth, require('./routes/topup'));
app.use('/', auth, require('./routes/history'));
app.use('/', auth, require('./routes/shop'));
app.use('/', auth, require('./routes/ranking'));
app.use('/', auth, require('./routes/account'));
app.use('/', auth, require('./routes/regulations'));
app.use('/', auth, admin, require('./routes/admin'));

app.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`4ummo chay tai http://localhost:${PORT}`));
