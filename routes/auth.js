const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', (req, res) => {
  const { username, password, password2 } = req.body;

  if (!username || !password || password.length < 6) {
    return res.render('register', { error: 'Tên đăng nhập và mật khẩu (tối thiểu 6 ký tự) là bắt buộc.' });
  }
  if (password !== password2) {
    return res.render('register', { error: 'Mật khẩu nhập lại không khớp.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.render('register', { error: 'Tên đăng nhập đã tồn tại.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, balance, exp, level, is_admin, created_at) VALUES (?, ?, 0, 0, 1, 0, ?)'
  ).run(username, hash, Date.now());

  req.session.userId = info.lastInsertRowid;
  res.redirect('/tasks');
});

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }

  req.session.userId = user.id;
  res.redirect('/tasks');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
