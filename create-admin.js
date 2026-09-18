// Chay lenh nay 1 LAN DUY NHAT sau khi da deploy xong, de tao tai khoan quan tri dau tien:
//   node create-admin.js ten_dang_nhap mat_khau
//
// VA LOI DA SUA (2026-09): ban truoc dung db.prepare(...).get()/.run() kieu
// better-sqlite3 (dong bo, cot placeholder "?") - nhung du an da chuyen sang
// Postgres (Neon) tu lau, va db.js hien chi export mot pg Pool bat dong bo
// voi cac ham .q()/.get()/.run() rieng, KHONG HE co ham .prepare(). Chay ban
// cu se bao loi ngay "db.prepare is not a function" va crash. Ngoai ra ban cu
// con insert sai cot ("balance") khong ton tai trong bang users (bang dung
// "ncoin"/"vcoin"). Da viet lai dung theo API + schema Postgres hien tai,
// dung chung logic voi routes/auth.js.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const [, , username, password] = process.argv;

if (!username || !password || password.length < 6) {
  console.log('Cách dùng: node create-admin.js ten_dang_nhap mat_khau (mật khẩu tối thiểu 6 ký tự)');
  process.exit(1);
}

async function main() {
  // Doi Postgres tao xong bang/cot (init() trong db.js) truoc khi truy van -
  // quan trong nhat neu day la lan dau ket noi vao 1 database Postgres hoan
  // toan moi (chua co bang users).
  await db.ready;

  const existing = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER($1)', [username]);
  if (existing) {
    await db.run('UPDATE users SET is_admin=1 WHERE id=$1', [existing.id]);
    console.log(`Tài khoản "${username}" đã tồn tại, đã nâng thành quản trị viên.`);
  } else {
    const hash = bcrypt.hashSync(password, 10);
    await db.run(
      `INSERT INTO users (username, password_hash, ncoin, vcoin, exp, level, is_admin, created_at)
       VALUES ($1,$2,0,0,0,1,1,$3)`,
      [username, hash, Date.now()]
    );
    console.log(`Đã tạo tài khoản quản trị "${username}". Dùng tài khoản này để đăng nhập và vào /admin.`);
    console.log('Lưu ý: mã giới thiệu (referral_code) cho tài khoản này sẽ được tự động cấp trong ít giây khi server chính khởi động lần kế tiếp.');
  }
  process.exit(0);
}

main().catch(e => { console.error('Lỗi:', e); process.exit(1); });
