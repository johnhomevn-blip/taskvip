// Tu dong trao thuong Top 1/2/3 cua "BXH tuan" (weekly_rankings, dua tren so
// nhiem vu hoan thanh) va "BXH thang gioi thieu" (referral_monthly) MOI KHI
// 1 chu ky (tuan/thang) KET THUC, chay ngam dinh ky tren server.
//
// VA LOI DA SUA (theo yeu cau cua chu web): truoc day trang /ranking va
// /referral CHI HIEN THI so tien thuong nhu 1 cai nhan dan tren giao dien,
// KHONG HE co logic nao thuc su cong tien vao tai khoan nguoi thang khi chu
// ky ket thuc - tuc la thuc ra chua bao gio co ai duoc nhan thuong ca! Them
// vao do, can dam bao: CHI trao thuong neu chu ky vua ket thuc THUC SU CO DU
// LIEU (co it nhat 1 nguoi lam nhiem vu / co it nhat 1 luot gioi thieu trong
// chu ky do) - tranh truong hop tuan/thang khong ai hoat dong ma van co loi
// cong thuong "khong" cho ai do, hoac loi khi truy van bang trong.
//
// Co che chong trao thuong 2 lan: luu lai "chu ky gan nhat da xu ly" vao
// bang settings (key 'last_weekly_reward_week' / 'last_referral_reward_month').
// Moi lan chay, so sanh chu ky VUA KET THUC voi moc da luu - neu >= moc da
// luu tuc la da xu ly roi, bo qua. Ham nay AN TOAN de goi lai nhieu lan (vi
// du: goi dinh ky bang setInterval VA goi ngau nhien luc co nguoi vao trang
// /ranking, /referral, phong khi server restart dung luc lo 1 nhip).

const db = require('../db');
const { getWeekStart, getMonthStart } = require('./period');

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key=$1', [key]);
  return row ? row.value : null;
}
async function setSetting(key, value) {
  await db.run(
    `INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
    [key, String(value)]
  );
}

async function distributeWeeklyTaskRewards() {
  const currentWeekStart = getWeekStart();
  const lastFinishedWeek = currentWeekStart - 7 * 24 * 60 * 60 * 1000;

  const lastProcessed = parseInt(await getSetting('last_weekly_reward_week') || '0');
  if (lastProcessed >= lastFinishedWeek) return; // da xu ly chu ky nay roi

  // CHI trao thuong neu tuan vua ket thuc THUC SU CO DU LIEU (co nguoi hoan
  // thanh it nhat 1 nhiem vu trong tuan do). Neu khong co ai, chi danh dau
  // da "xu ly" (khong co gi de trao) roi bo qua, KHONG bao loi.
  const top = await db.q(
    `SELECT user_id, task_count FROM weekly_rankings WHERE week_start=$1 AND task_count>0 ORDER BY task_count DESC LIMIT 3`,
    [lastFinishedWeek]
  );

  if (top.length > 0) {
    const settingsRows = await db.q("SELECT * FROM settings WHERE key LIKE 'weekly_reward_%'");
    const s = {}; settingsRows.forEach(r => s[r.key] = r.value);
    const rewards = [parseInt(s.weekly_reward_1) || 0, parseInt(s.weekly_reward_2) || 0, parseInt(s.weekly_reward_3) || 0];

    for (let i = 0; i < top.length; i++) {
      const reward = rewards[i];
      if (reward > 0) {
        await db.run('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [reward, top[i].user_id]);
        await db.run(
          `INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'reward',$2,'ncoin',$3,$4)`,
          [top[i].user_id, reward, `Thưởng BXH tuần - Hạng ${i + 1} (${top[i].task_count} nhiệm vụ)`, Date.now()]
        );
      }
    }
  }

  await setSetting('last_weekly_reward_week', lastFinishedWeek);
}

async function distributeMonthlyReferralRewards() {
  const monthKeyToCheck = await findLastFinishedMonthStart();
  const lastProcessed = parseInt(await getSetting('last_referral_reward_month') || '0');
  if (lastProcessed >= monthKeyToCheck) return; // da xu ly thang nay roi

  const top = await db.q(
    `SELECT user_id, ref_count FROM referral_monthly WHERE month_start=$1 AND ref_count>0 ORDER BY ref_count DESC LIMIT 3`,
    [monthKeyToCheck]
  );

  if (top.length > 0) {
    const settingsRows = await db.q("SELECT * FROM settings WHERE key LIKE 'referral_reward_%'");
    const s = {}; settingsRows.forEach(r => s[r.key] = r.value);
    const rewards = [parseInt(s.referral_reward_1) || 0, parseInt(s.referral_reward_2) || 0, parseInt(s.referral_reward_3) || 0];

    for (let i = 0; i < top.length; i++) {
      const reward = rewards[i];
      if (reward > 0) {
        await db.run('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [reward, top[i].user_id]);
        await db.run(
          `INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'reward',$2,'ncoin',$3,$4)`,
          [top[i].user_id, reward, `Thưởng BXH giới thiệu tháng - Hạng ${i + 1} (${top[i].ref_count} người)`, Date.now()]
        );
      }
    }
  }

  await setSetting('last_referral_reward_month', monthKeyToCheck);
}

// Tim moc dau thang cua "thang vua ket thuc" mot cach chinh xac (lui 1 ngay
// tu dau thang hien tai se roi vao thang truoc, roi tinh dau thang cua ngay do)
async function findLastFinishedMonthStart() {
  const currentMonthStart = getMonthStart();
  const oneDayBefore = currentMonthStart - 24 * 60 * 60 * 1000;
  const dt = new Date(oneDayBefore);
  const utc = dt.getTime() + dt.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  gmt7.setDate(1);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

let running = false;
async function checkAndDistributeAllRewards() {
  if (running) return; // tranh chay chong cheo neu bi goi gan nhau
  running = true;
  try {
    await distributeWeeklyTaskRewards();
    await distributeMonthlyReferralRewards();
  } catch (e) {
    console.error('Lỗi cron trao thưởng BXH:', e);
  } finally {
    running = false;
  }
}

module.exports = { checkAndDistributeAllRewards };
