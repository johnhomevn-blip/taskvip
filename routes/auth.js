const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

router.get('/register', (req, res) => res.render('register', { error: null }));

router.post('/register', async (req, res) => {
  const { username, password, password2 } = req.body;
  const fp = req.body.fingerprint || '';
  const ip = req.ip;
  if (!username || !password || password.length < 6)
    return res.render('register', { error: 'Tên đăng nhập và mật khẩu tối thiểu 6 ký tự là bắt buộc.' });
  if (password !== password2)
    return res.render('register', { error: 'Mật khẩu nhập lại không khớp.' });

  const existing = await db.get('SELECT id FROM users WHERE username = $1', [username]);
  if (existing) return res.render('register', { error: 'Tên đăng nhập đã tồn tại.' });

  const hash = bcrypt.hashSync(password, 10);
  const row = await db.get(
    `INSERT INTO users (username, password_hash, ncoin, vcoin, exp, level, is_admin, created_at, reg_ip, reg_fingerprint)
     VALUES ($1,$2,0,0,0,1,0,$3,$4,$5) RETURNING id`,
    [username, hash, Date.now(), ip, fp]
  );
  req.session.userId = row.id;
  res.redirect('/dashboard');
});

router.get('/login', (req, res) => res.render('login', { error: null }));

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE username = $1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.render('login', { error: 'Sai tên đăng nhập hoặc mật khẩu.' });

  if (user.is_banned) return res.render('login', { error: 'Tài khoản của bạn đã bị khóa. Liên hệ admin để biết thêm chi tiết.' });

  req.session.userId = user.id;

  // Ghi nhat ky dang nhap
  await db.run(
    'INSERT INTO login_logs (user_id, ip, user_agent, created_at) VALUES ($1,$2,$3,$4)',
    [user.id, req.ip, req.headers['user-agent'] || '', Date.now()]
  );
  // Xoa log cu hon 7 ngay
  await db.run('DELETE FROM login_logs WHERE user_id=$1 AND created_at < $2', [user.id, Date.now() - 7*24*60*60*1000]);

  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
module.exports = router;
