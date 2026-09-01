const crypto = require('crypto');

const SECRET = process.env.HMAC_SECRET || 'thay-doi-secret-nay';

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
