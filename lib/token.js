const crypto = require('crypto');

/**
 * VA LOI BAO MAT (2026-09): truoc day neu thieu bien moi truong HMAC_SECRET,
 * server chay voi secret CO DINH duoc ghi thang trong source code
 * ('thay-doi-secret-nay'). Ai doc duoc source (vi du file zip nay) deu co the
 * tu ky (sign) chu ky hop le cho bat ky task_attempt_id nao -> tu tao request
 * /verify gia de cong coin ma khong can vuot link that.
 *
 * Bay gio: neu ban da set HMAC_SECRET trong .env thi dung gia tri do (khuyen
 * nghi, vi giu nguyen giua cac lan restart). Neu chua set, tu sinh 1 chuoi
 * ngau nhien 64 ky tu MOI LAN server khoi dong (khong con la gia tri co dinh
 * cong khai trong code) va ghi canh bao ra log de ban biet ma set env cho on dinh.
 */
let SECRET = process.env.HMAC_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[CANH BAO BAO MAT] Chua set bien moi truong HMAC_SECRET trong .env!');
  console.warn('[CANH BAO BAO MAT] Da tu sinh 1 secret ngau nhien cho phien chay nay.');
  console.warn('[CANH BAO BAO MAT] Cac link xac minh (/verify) dang cho xu ly se mat hieu luc moi khi server restart.');
  console.warn('[CANH BAO BAO MAT] Khuyen nghi: dat HMAC_SECRET (chuoi ngau nhien dai) trong bien moi truong de on dinh.');
}

// Tao chu ky cho 1 task_attempt_id, dung de nhung vao URL xac nhan
function sign(attemptId) {
  return crypto.createHmac('sha256', SECRET).update(String(attemptId)).digest('hex');
}

// Kiem tra chu ky co khop khong (chong gia mao / tu doan URL)
function verify(attemptId, sig) {
  const expected = sign(attemptId);
  // so sanh theo kieu an toan (timing-safe) de tranh do thoi gian
  const a = Buffer.from(expected);
  const b = Buffer.from(sig || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { sign, verify };
