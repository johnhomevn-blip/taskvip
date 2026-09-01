// Chay lenh nay 1 LAN DUY NHAT sau khi da deploy xong, de tao tai khoan quan tri dau tien:
//   node create-admin.js ten_dang_nhap mat_khau
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const [, , username, password] = process.argv;

if (!username || !password || password.length < 6) {
  console.log('Cách dùng: node create-admin.js ten_dang_nhap mat_khau (mật khẩu tối thiểu 6 ký tự)');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(username);
  console.log(`Tài khoản "${username}" đã tồn tại, đã nâng thành quản trị viên.`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, balance, exp, level, is_admin, created_at) VALUES (?, ?, 0, 0, 1, 1, ?)'
  ).run(username, hash, Date.now());
  console.log(`Đã tạo tài khoản quản trị "${username}". Dùng tài khoản này để đăng nhập và vào /admin.`);
}
