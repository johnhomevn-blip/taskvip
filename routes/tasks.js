const express = require('express');
const { getClientIp } = require('../lib/ip');
const db = require('../db');
const token = require('../lib/token');
const { createShortLink } = require('../lib/shortener');
const { getMultiplier, getSecondsUntilReset, getDayStart } = require('../lib/multiplier');
const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_TTL_MS = 6 * 60 * 60 * 1000; // link ton tai 6 tieng truoc khi het han
const CLICK_COOLDOWN_MS = 10 * 1000; // delay 10 giay giua cac lan bam "Lay link vuot"

// Luu thoi diem bam gan nhat cua tung user (chong spam tao link lien tuc)
const lastClickMap = new Map();
// VA LOI RO RI BO NHO DA SUA (2026-09): Map nay truoc day KHONG BAO GIO xoa
// entry cu - moi user (moi bam nut it nhat 1 lan) se o lai trong RAM VINH
// VIEN cho toi khi server restart. Voi 1 web chay lau dai nhieu thang/nam va
// ngay cang nhieu user, day la 1 memory leak cham nhung co that. Don dinh ky
// nhung entry da qua lau (khong con y nghia gi vi cooldown chi 10 giay) de
// giu Map luon nho gon.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000; // giu du 10 phut la du du (cooldown chi 10s)
  for (const [uid, ts] of lastClickMap) {
    if (ts < cutoff) lastClickMap.delete(uid);
  }
}, 10 * 60 * 1000);

// Tinh moc thoi gian "tinh tu day" de dem so luot da hoan thanh, tuy theo
// kieu reset cua tung nhiem vu (admin chon o trang quan tri):
// - 'daily'  : reset co dinh vao 00:00 (gio VN) moi ngay cho TAT CA moi
//              nguoi cung luc, bat ke ho vuot link luc may gio hom truoc.
// - 'rolling': reset theo kieu "lan" ca nhan - moi nguoi tu mo khoa lai sau
//              dung task.reset_hours gio KE TU LAN VUOT GAN NHAT cua chinh
//              ho, khong lien quan gio 00:00 hay nguoi khac.
function getTaskResetSince(task) {
  if (task.reset_mode === 'rolling') {
    return Date.now() - (parseInt(task.reset_hours) || 24) * 60 * 60 * 1000;
  }
  return getDayStart();
}

router.get('/tasks', async (req, res) => {
  const user = req.user;

  // Don dep: danh dau cac attempt qua han thanh 'expired' de hien thi dung trang thai
  await db.run(`UPDATE task_attempts SET status='expired' WHERE user_id=$1 AND status='pending' AND expires_at<$2`, [user.id, Date.now()]);

  const categories = await db.q('SELECT * FROM task_categories WHERE active=1 ORDER BY sort_order');
  const tasks = await db.q('SELECT * FROM tasks WHERE active=1 ORDER BY category_id, id DESC');
  const multiplier = getMultiplier();
  const secondsUntilReset = getSecondsUntilReset();
  const announcements = await db.q("SELECT * FROM announcements WHERE active=1 ORDER BY created_at DESC LIMIT 3");

  const tasksWithInfo = await Promise.all(tasks.map(async t => {
    const since = getTaskResetSince(t);
    const done = await db.get(
      // VA LOI CHONG GIAN LAN: tinh ca status='cho_duyet' (dang cho admin duyet
      // vi cau dao/nghi ngo) vao gioi han/ngay, khong chi 'completed'. Neu chi
      // dem 'completed', 1 user co the tao link moi lien tuc trong luc cho
      // duyet de "lach" gioi han/ngay - vi cac lan dang cho duyet khong bi tinh.
      `SELECT COUNT(*) as c FROM task_attempts WHERE user_id=$1 AND task_id=$2 AND status IN ('completed','cho_duyet') AND created_at>$3`,
      [user.id, t.id, since]
    );
    const actualReward = Math.round(t.base_reward * multiplier);
    return { ...t, remaining: Math.max(0, t.daily_limit - parseInt(done.c)), actualReward };
  }));

  const grouped = categories.map(cat => ({
    ...cat,
    tasks: tasksWithInfo.filter(t => t.category_id === cat.id)
  }));
  const uncategorized = tasksWithInfo.filter(t => !t.category_id);

  res.render('tasks', { userIP: getClientIp(req), user, grouped, uncategorized, multiplier, secondsUntilReset, announcements,
    error: req.query.error || null, done: req.query.done || null });
});

router.post('/tasks/:id/start', async (req, res) => {
  const user = req.user;
  const ip = getClientIp(req);
  const fp = req.body.fingerprint || '';

  // Chong spam: gioi han 10 giay giua cac lan bam
  const now0 = Date.now();
  const lastClick = lastClickMap.get(user.id) || 0;
  const elapsed = now0 - lastClick;
  if (elapsed < CLICK_COOLDOWN_MS) {
    const remain = Math.ceil((CLICK_COOLDOWN_MS - elapsed) / 1000);
    return res.redirect(`/tasks?error=Vui lòng đợi ${remain} giây và thử lại`);
  }
  lastClickMap.set(user.id, now0);

  // VA LOI: validate id la so nguyen truoc khi query (tranh loi kieu du lieu Postgres)
  if (!/^\d+$/.test(String(req.params.id))) {
    return res.redirect('/tasks?error=Nhiệm vụ không tồn tại');
  }

  const task = await db.get('SELECT * FROM tasks WHERE id=$1 AND active=1', [req.params.id]);
  if (!task) return res.redirect('/tasks?error=Nhiệm vụ không tồn tại');

  // Neu da co attempt dang cho (pending) va chua het han, dua nguoi dung tiep tuc link cu
  // thay vi tao link moi (tranh spam tao nhieu link cho cung 1 nhiem vu)
  const existing = await db.get(
    `SELECT * FROM task_attempts WHERE user_id=$1 AND task_id=$2 AND status='pending' AND expires_at>$3 ORDER BY created_at DESC LIMIT 1`,
    [user.id, task.id, Date.now()]
  );
  if (existing && existing.short_url) {
    return res.redirect('/go/' + existing.id);
  }

  // Kiem tra IP da dung boi tai khoan khac chua
  const ipConflict = await db.get(
    'SELECT user_id FROM ip_user_map WHERE ip=$1 AND user_id != $2 LIMIT 1',
    [ip, user.id]
  );
  if (ipConflict) {
    return res.redirect('/tasks?error=IP này đã được sử dụng bởi tài khoản khác. Không thể tạo link.');
  }

  // Kiem tra fingerprint thiet bi da dung boi tai khoan khac chua (backup cho truong hop doi IP)
  if (fp) {
    const fpConflict = await db.get(
      'SELECT user_id FROM fp_user_map WHERE fingerprint=$1 AND user_id != $2 LIMIT 1',
      [fp, user.id]
    );
    if (fpConflict) {
      return res.redirect('/tasks?error=Thiết bị này đã được dùng bởi tài khoản khác. Không thể tạo link.');
    }
  }

  // Kiem tra gioi han IP theo nhiem vu (cung theo kieu reset rieng cua nhiem vu)
  const resetSince = getTaskResetSince(task);
  const ipToday = await db.get(
    // Xem giai thich o dong tuong tu phia tren (gioi han theo user) - cung
    // tinh ca 'cho_duyet' de khong bi lach gioi han/ngay theo IP.
    `SELECT COUNT(*) as c FROM task_attempts
     WHERE task_id=$1 AND ip_created=$2 AND status IN ('completed','cho_duyet') AND created_at>$3`,
    [task.id, ip, resetSince]
  );
  if (parseInt(ipToday.c) >= task.ip_daily_limit) {
    return res.redirect(`/tasks?error=IP này đã đạt giới hạn ${task.ip_daily_limit} lượt cho nhiệm vụ này, thử lại sau`);
  }

  // Kiem tra gioi han user
  const userDone = await db.get(
    `SELECT COUNT(*) as c FROM task_attempts WHERE user_id=$1 AND task_id=$2 AND status IN ('completed','cho_duyet') AND created_at>$3`,
    [user.id, task.id, resetSince]
  );
  if (parseInt(userDone.c) >= task.daily_limit) {
    return res.redirect('/tasks?error=Bạn đã hết lượt cho nhiệm vụ này, vui lòng thử lại sau');
  }

  // Ghi nhan IP - user mapping
  await pool_upsert_ip(ip, user.id);
  if (fp) await pool_upsert_fp(fp, user.id);

  const multiplier = getMultiplier();
  const rewardActual = Math.round(task.base_reward * multiplier);
  const now = Date.now();

  const attempt = await db.get(
    `INSERT INTO task_attempts (user_id,task_id,status,reward_actual,multiplier,created_at,expires_at,ip_created,fingerprint)
     VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.id, task.id, rewardActual, multiplier, now, now + ATTEMPT_TTL_MS, ip, fp]
  );

  const sig = token.sign(attempt.id);
  const verifyUrl = `${process.env.BASE_URL}/verify?tid=${attempt.id}&sig=${sig}`;
  try {
    const shortUrl = await createShortLink(task.provider, verifyUrl);
    await db.run('UPDATE task_attempts SET short_url=$1 WHERE id=$2', [shortUrl, attempt.id]);
    // Dua nguoi dung qua trang "Xac minh" trung gian truoc khi toi link that su
    res.redirect('/go/' + attempt.id);
  } catch (err) {
    console.error('Loi tao short link:', err.message);
    await db.run('DELETE FROM task_attempts WHERE id=$1', [attempt.id]);
    res.redirect('/tasks?error=Không tạo được link nhiệm vụ (kiểm tra API Key nhà cung cấp trong Admin), thử lại sau');
  }
});

// Trang "Xac minh" trung gian - hien thi truoc khi dua nguoi dung sang link that su
router.get('/go/:id', async (req, res) => {
  // VA LOI: validate id la so nguyen truoc khi query (tranh loi kieu du lieu Postgres)
  if (!/^\d+$/.test(String(req.params.id))) {
    return res.redirect('/tasks?error=Không tìm thấy nhiệm vụ');
  }
  const attempt = await db.get(
    `SELECT ta.*, t.name as task_name FROM task_attempts ta JOIN tasks t ON t.id=ta.task_id WHERE ta.id=$1 AND ta.user_id=$2`,
    [req.params.id, req.user.id]
  );
  if (!attempt) return res.redirect('/tasks?error=Không tìm thấy nhiệm vụ');
  if (attempt.status !== 'pending') return res.redirect('/tasks?error=Nhiệm vụ này đã được xử lý hoặc hết hạn');
  if (Date.now() > parseInt(attempt.expires_at)) return res.redirect('/tasks?error=Link đã hết hạn, vui lòng tạo lại');

  res.render('go', { taskName: attempt.task_name, shortUrl: attempt.short_url, user: req.user });
});

async function pool_upsert_ip(ip, userId) {
  const now = Date.now();
  try {
    await db.run(
      `INSERT INTO ip_user_map (ip, user_id, first_seen, last_seen) VALUES ($1,$2,$3,$3)
       ON CONFLICT (ip, user_id) DO UPDATE SET last_seen=$3`,
      [ip, userId, now]
    );
  } catch(e) {}
}

async function pool_upsert_fp(fp, userId) {
  const now = Date.now();
  try {
    await db.run(
      `INSERT INTO fp_user_map (fingerprint, user_id, first_seen, last_seen) VALUES ($1,$2,$3,$3)
       ON CONFLICT (fingerprint, user_id) DO UPDATE SET last_seen=$3`,
      [fp, userId, now]
    );
  } catch(e) {}
}

module.exports = router;
