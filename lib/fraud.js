const db = require('../db');

/**
 * Cham diem rui ro "nhieu tai khoan cung 1 nguoi / farm" cho 1 user, dua
 * HOAN TOAN tren du lieu da co san (ip_user_map, fp_user_map, task_attempts,
 * users.reg_ip) - KHONG dung API IP-intelligence tra phi nao (xem giai thich
 * trong Admin > Bao mat vi sao khong the phat hien "VPN that su" theo cach
 * mien phi).
 *
 * QUAN TRONG: day CHI la cham diem de GAN CO cho admin xem + tu dong dua vao
 * hang "cho duyet" - KHONG tu dong khoa/cam tai khoan, tranh bat nham nguoi
 * dung that (vd dung chung mang 4G/CGNAT, dung chung may tinh gia dinh).
 *
 * Cac tin hieu (moi tin hieu +2 diem, nguong gan co mac dinh la 4 - tuc can
 * IT NHAT 2 tin hieu cung luc moi bi gan co, khong phai chi 1 tin hieu don le
 * de tranh qua nhay):
 *   1) IP cua lan vuot link nay dang duoc dung boi tai khoan khac
 *   2) Fingerprint thiet bi dang duoc dung boi tai khoan khac
 *   3) 5 lan vuot link gan nhat hoan thanh voi thoi gian gan nhu GIONG HET
 *      nhau (do lech cuc thap) - dau hieu script tu dong, khong phai nguoi
 *      that (nguoi that luon co dao dong thoi gian phan ung)
 *   4) Co >=3 tai khoan khac cung dang ky tu cung 1 IP trong vong 30 phut
 *      quanh thoi diem tai khoan nay dang ky - dau hieu tao hang loat
 */
const FLAG_THRESHOLD = 4;
const REG_BURST_WINDOW_MS = 30 * 60 * 1000;

async function evaluateUserRisk(userId, { ip = '', fingerprint = '' } = {}) {
  const reasons = [];
  let score = 0;

  if (ip) {
    const r = await db.get('SELECT COUNT(*)::int as c FROM ip_user_map WHERE ip=$1 AND user_id!=$2', [ip, userId]);
    if (r.c > 0) { score += 2; reasons.push(`IP đang dùng chung với ${r.c} tài khoản khác`); }
  }
  if (fingerprint) {
    const r = await db.get('SELECT COUNT(*)::int as c FROM fp_user_map WHERE fingerprint=$1 AND user_id!=$2', [fingerprint, userId]);
    if (r.c > 0) { score += 2; reasons.push(`Thiết bị đang dùng chung với ${r.c} tài khoản khác`); }
  }

  // Do dao dong thoi gian hoan thanh cua 5 lan gan nhat
  const recent = await db.q(
    `SELECT (completed_at - created_at) as elapsed FROM task_attempts
     WHERE user_id=$1 AND status='completed' AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 5`,
    [userId]
  );
  if (recent.length >= 5) {
    const vals = recent.map(r => parseInt(r.elapsed));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const stdevSeconds = Math.sqrt(variance) / 1000;
    if (stdevSeconds < 1) {
      score += 2;
      reasons.push(`5 lượt vượt link gần nhất có thời gian hoàn thành gần như giống hệt nhau (độ lệch ${stdevSeconds.toFixed(2)}s) - dấu hiệu script tự động`);
    }
  }

  // Bung no dang ky tu cung 1 IP quanh thoi diem tai khoan nay tao
  const user = await db.get('SELECT reg_ip, created_at FROM users WHERE id=$1', [userId]);
  if (user && user.reg_ip) {
    const since = parseInt(user.created_at) - REG_BURST_WINDOW_MS;
    const until = parseInt(user.created_at) + REG_BURST_WINDOW_MS;
    const r = await db.get(
      `SELECT COUNT(*)::int as c FROM users WHERE reg_ip=$1 AND id!=$2 AND created_at BETWEEN $3 AND $4`,
      [user.reg_ip, userId, since, until]
    );
    if (r.c >= 3) {
      score += 2;
      reasons.push(`${r.c} tài khoản khác đăng ký cùng IP trong vòng 30 phút quanh lúc tài khoản này được tạo`);
    }
  }

  const flagged = score >= FLAG_THRESHOLD;
  const reasonText = reasons.join('; ');
  await db.run('UPDATE users SET fraud_flag=$1, fraud_score=$2, fraud_reason=$3 WHERE id=$4',
    [flagged ? 1 : 0, score, reasonText, userId]);

  return { flagged, score, reasonText };
}

async function clearFraudFlag(userId) {
  await db.run("UPDATE users SET fraud_flag=0, fraud_score=0, fraud_reason='' WHERE id=$1", [userId]);
}

module.exports = { evaluateUserRisk, clearFraudFlag, FLAG_THRESHOLD };
