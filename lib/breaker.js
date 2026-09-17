const db = require('../db');
const { logSecurityEvent } = require('./securityLog');

const HOUR_MS = 60 * 60 * 1000;
// Cooldown truoc khi cau dao TU DONG thu resume lai - trong luc nay admin
// van co the bam resume thu cong bat cu luc nao neu da kiem tra thay an toan.
const AUTO_RESUME_COOLDOWN_MS = 20 * 60 * 1000;

async function getSetting(key, fallback) {
  const row = await db.get('SELECT value FROM settings WHERE key=$1', [key]);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await db.run('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [key, String(value)]);
}

// Tong Ncoin da THUC SU cong cho nguoi dung (type='earn', tuc da qua /verify
// va duoc xac nhan xong - KHONG tinh cac nhiem vu dang 'cho_duyet' vi chung
// chua thuc su duoc cong) trong 1 gio gan nhat (cua so truot, khong phai gio
// tron 00-01h,...).
async function getRollingHourEarnings() {
  const since = Date.now() - HOUR_MS;
  const row = await db.get(
    "SELECT COALESCE(SUM(amount),0)::int as total FROM transactions WHERE type='earn' AND created_at > $1",
    [since]
  );
  return row.total;
}

async function getStatus() {
  const [thresholdRaw, activeRaw, trippedAtRaw, rollingSum] = await Promise.all([
    getSetting('breaker_hourly_threshold', '1000000'),
    getSetting('breaker_active', '0'),
    getSetting('breaker_tripped_at', '0'),
    getRollingHourEarnings(),
  ]);
  const threshold = parseInt(thresholdRaw) || 0;
  const active = activeRaw === '1';
  const trippedAt = parseInt(trippedAtRaw) || 0;
  return {
    threshold, active, trippedAt, rollingSum,
    autoResumeAt: active ? trippedAt + AUTO_RESUME_COOLDOWN_MS : null,
  };
}

/**
 * Goi truoc khi cong thuong cho 1 luot vuot link. Neu cau dao DANG bat, giu
 * nguyen (van tra ve tripped:true) de attempt do bi dua vao "cho_duyet".
 * Neu cau dao dang tat, kiem tra xem CONG THEM phan thuong nay vao co lam
 * vuot nguong khong (kiem tra THOI DIEM THUC, khong doi cron chay) - neu co,
 * TRIGGER cau dao ngay lap tuc va giu ca attempt hien tai lai.
 */
async function evaluateAndTrip(rewardAmount, { ip = '' } = {}) {
  const [thresholdRaw, activeRaw] = await Promise.all([
    getSetting('breaker_hourly_threshold', '1000000'),
    getSetting('breaker_active', '0'),
  ]);
  const threshold = parseInt(thresholdRaw) || 0;
  if (activeRaw === '1') return { tripped: true, alreadyActive: true };

  const rollingSum = await getRollingHourEarnings();
  const projected = rollingSum + (parseInt(rewardAmount) || 0);
  if (threshold > 0 && projected > threshold) {
    const now = Date.now();
    await setSetting('breaker_active', '1');
    await setSetting('breaker_tripped_at', String(now));
    await db.run(
      'INSERT INTO breaker_logs (triggered_at, ncoin_total, threshold, created_at) VALUES ($1,$2,$3,$1)',
      [now, projected, threshold]
    );
    await logSecurityEvent('breaker_trip', { ip, detail: `Tự động trigger: ${projected.toLocaleString('vi-VN')}/${threshold.toLocaleString('vi-VN')} Ncoin trong 1 giờ gần nhất` });
    console.warn(`[CẦU DAO] TRIGGER: ${projected} Ncoin/giờ vượt ngưỡng ${threshold}. Tạm dừng xác nhận nhiệm vụ tự động, chờ admin xem xét.`);
    return { tripped: true, alreadyActive: false };
  }
  return { tripped: false };
}

// Duoc goi dinh ky boi cron (lib/breakerCron.js). Neu cau dao dang bat VA da
// qua het cooldown, kiem tra lai: neu van con vuot nguong thi TRIGGER LAI
// (khong chi 1 lan roi thoi), neu da on dinh thi tu resume.
async function tryAutoResume() {
  const [activeRaw, trippedAtRaw, thresholdRaw] = await Promise.all([
    getSetting('breaker_active', '0'),
    getSetting('breaker_tripped_at', '0'),
    getSetting('breaker_hourly_threshold', '1000000'),
  ]);
  if (activeRaw !== '1') return;
  const trippedAt = parseInt(trippedAtRaw) || 0;
  const threshold = parseInt(thresholdRaw) || 0;
  if (Date.now() - trippedAt < AUTO_RESUME_COOLDOWN_MS) return; // chua het cooldown

  const rollingSum = await getRollingHourEarnings();
  const now = Date.now();
  if (rollingSum > threshold) {
    // Van con bat thuong - dong log cu (danh dau da danh gia lai) va mo 1
    // log moi, tiep tuc giu cau dao o trang thai bat.
    await db.run(
      `UPDATE breaker_logs SET resumed_at=$1, resumed_by='auto-retrigger', note='Hết cooldown nhưng vẫn vượt ngưỡng, tiếp tục tạm dừng'
       WHERE id = (SELECT id FROM breaker_logs WHERE resumed_at IS NULL ORDER BY triggered_at DESC LIMIT 1)`,
      [now]
    );
    await setSetting('breaker_tripped_at', String(now));
    await db.run(
      'INSERT INTO breaker_logs (triggered_at, ncoin_total, threshold, created_at) VALUES ($1,$2,$3,$1)',
      [now, rollingSum, threshold]
    );
    await logSecurityEvent('breaker_retrigger', { detail: `Vẫn vượt ngưỡng sau cooldown: ${rollingSum}/${threshold} Ncoin/giờ` });
    console.warn(`[CẦU DAO] Vẫn vượt ngưỡng sau cooldown (${rollingSum}/${threshold}) - tiếp tục tạm dừng.`);
  } else {
    await setSetting('breaker_active', '0');
    await setSetting('breaker_tripped_at', '0');
    await db.run(
      `UPDATE breaker_logs SET resumed_at=$1, resumed_by='auto', note='Tự động resume sau cooldown, đã ổn định'
       WHERE id = (SELECT id FROM breaker_logs WHERE resumed_at IS NULL ORDER BY triggered_at DESC LIMIT 1)`,
      [now]
    );
    await logSecurityEvent('breaker_resume_auto', { detail: `Đã ổn định (${rollingSum}/${threshold} Ncoin/giờ), tự động resume` });
    console.log('[CẦU DAO] Tự động resume - mức Ncoin/giờ đã trở lại bình thường.');
  }
}

// Admin bam resume thu cong ngay lap tuc (khong can cho het cooldown), sau
// khi da tu kiem tra va thay an toan.
async function manualResume(adminLabel) {
  const activeRaw = await getSetting('breaker_active', '0');
  if (activeRaw !== '1') return { ok: false, reason: 'not-active' };
  const now = Date.now();
  await setSetting('breaker_active', '0');
  await setSetting('breaker_tripped_at', '0');
  await db.run(
    `UPDATE breaker_logs SET resumed_at=$1, resumed_by=$2, note='Admin resume thủ công'
     WHERE id = (SELECT id FROM breaker_logs WHERE resumed_at IS NULL ORDER BY triggered_at DESC LIMIT 1)`,
    [now, `admin:${adminLabel}`]
  );
  await logSecurityEvent('breaker_resume_manual', { detail: `Admin ${adminLabel} resume thủ công` });
  return { ok: true };
}

// Admin tu tay bam tam dung khan cap (khong doi den khi vuot nguong that su)
async function manualTrip(adminLabel, note) {
  const activeRaw = await getSetting('breaker_active', '0');
  if (activeRaw === '1') return { ok: false, reason: 'already-active' };
  const now = Date.now();
  const threshold = parseInt(await getSetting('breaker_hourly_threshold', '1000000')) || 0;
  const rollingSum = await getRollingHourEarnings();
  await setSetting('breaker_active', '1');
  await setSetting('breaker_tripped_at', String(now));
  await db.run(
    'INSERT INTO breaker_logs (triggered_at, ncoin_total, threshold, note, created_at) VALUES ($1,$2,$3,$4,$1)',
    [now, rollingSum, threshold, `Admin ${adminLabel} tạm dừng thủ công${note ? ': ' + note : ''}`]
  );
  await logSecurityEvent('breaker_trip_manual', { detail: `Admin ${adminLabel} tạm dừng thủ công${note ? ': ' + note : ''}` });
  return { ok: true };
}

async function setThreshold(value) {
  const n = parseInt(value);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  await setSetting('breaker_hourly_threshold', String(n));
  return { ok: true };
}

module.exports = {
  getStatus, evaluateAndTrip, tryAutoResume, manualResume, manualTrip, setThreshold,
  getRollingHourEarnings, AUTO_RESUME_COOLDOWN_MS,
};
