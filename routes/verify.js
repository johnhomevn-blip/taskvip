const express = require('express');
const { getClientIp } = require('../lib/ip');
const db = require('../db');
const token = require('../lib/token');
const { getLevelInfo } = require('../lib/level');
const { getRateForTier, parseReferralSettings, getMonthStart } = require('../lib/referral');
const router = express.Router();

router.get('/verify', async (req, res) => {
  const { tid, sig } = req.query;
  if (!tid || !sig) return res.render('verify', { status:'error', message:'Thiếu thông tin xác nhận.', reward:0, multiplier:1, targetUrl:null });

  // VA LOI: validate tid la so nguyen truoc khi dua vao query Postgres (cot
  // id la INTEGER). Truoc day 1 gia tri khong phai so (vd tid=abc) se lam
  // Postgres nem loi kieu du lieu, va vi khong ai bat loi do, toan bo server
  // se crash (unhandled rejection) - route nay khong can dang nhap nen ai
  // cung goi duoc. Gio se tra loi 'khong ton tai' cho gia tri khong hop le,
  // khong con crash server nua (dong thoi da co luoi an toan express-async-errors
  // + middleware loi tap trung o server.js phong khi con truong hop khac).
  if (!/^\d+$/.test(String(tid))) {
    return res.render('verify', { status:'error', message:'Nhiệm vụ không tồn tại.', reward:0, multiplier:1, targetUrl:null });
  }

  const attempt = await db.get('SELECT * FROM task_attempts WHERE id=$1', [tid]);
  if (!attempt) return res.render('verify', { status:'error', message:'Nhiệm vụ không tồn tại.', reward:0, multiplier:1, targetUrl:null });
  if (!token.verify(tid, sig)) return res.render('verify', { status:'error', message:'Chữ ký không hợp lệ.', reward:0, multiplier:1, targetUrl:null });
  if (attempt.status !== 'pending') return res.render('verify', { status:'error', message:'Nhiệm vụ này đã được xử lý rồi.', reward:0, multiplier:1, targetUrl:null });
  if (Date.now() > parseInt(attempt.expires_at)) {
    await db.run("UPDATE task_attempts SET status='expired' WHERE id=$1 AND status='pending'", [tid]);
    return res.render('verify', { status:'error', message:'Link đã hết hạn, vui lòng thực hiện lại.', reward:0, multiplier:1, targetUrl:null });
  }

  const task = await db.get('SELECT * FROM tasks WHERE id=$1', [attempt.task_id]);
  const elapsed = (Date.now() - parseInt(attempt.created_at)) / 1000;
  if (elapsed < task.min_seconds) {
    return res.render('verify', { status:'error', message:'Chưa hoàn thành đủ thời gian yêu cầu.', reward:0, multiplier:1, targetUrl:null });
  }

  const ip = getClientIp(req);
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // VA LOI RACE CONDITION (quan trong nhat): truoc day cau UPDATE nay khong
    // co dieu kien "AND status='pending'", nen neu nhieu request /verify voi
    // cung tid+sig duoc goi DONG THOI (vd 1 script goi lai vai chuc lan lien
    // tuc trong luc transaction dau tien chua kip commit), MOI request deu
    // doc thay status='pending' (kiem tra o tren, truoc transaction) roi deu
    // tu cong thuong rieng -> nhan ban phan thuong nhieu lan chi tu 1 lan
    // vuot link that. Them "AND status='pending'" bien cau UPDATE thanh 1
    // thao tac nguyen tu duoc Postgres khoa dong (row lock): chi 1 transaction
    // duy nhat co the doi status tu 'pending' -> 'completed' thanh cong, cac
    // transaction goi song song sau do se thay rowCount=0 va bi tu choi.
    const upd = await client.query(
      "UPDATE task_attempts SET status='completed', completed_at=$1, ip_verified=$2 WHERE id=$3 AND status='pending'",
      [Date.now(), ip, tid]
    );
    if (upd.rowCount === 0) {
      // Da co request khac xu ly xong attempt nay truoc (hoac da het han) -> dung lai, khong cong thuong 2 lan
      await client.query('ROLLBACK');
      return res.render('verify', { status:'error', message:'Nhiệm vụ này đã được xử lý rồi.', reward:0, multiplier:1, targetUrl:null });
    }

    const updUser = await client.query(
      'UPDATE users SET ncoin=ncoin+$1, exp=exp+$2 WHERE id=$3 RETURNING exp',
      [attempt.reward_actual, task.exp_reward, attempt.user_id]
    );
    const newExp = updUser.rows[0].exp;
    const { level } = getLevelInfo(newExp);
    await client.query('UPDATE users SET level=$1 WHERE id=$2', [level, attempt.user_id]);

    // Ghi transaction
    await client.query(
      'INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [attempt.user_id, 'earn', attempt.reward_actual, 'ncoin', `Vượt link: ${task.name}`, Date.now()]
    );

    // Cap nhat weekly ranking
    const weekStart = getWeekStart();
    await client.query(
      `INSERT INTO weekly_rankings (user_id,week_start,task_count,ncoin_earned) VALUES ($1,$2,1,$3)
       ON CONFLICT (user_id,week_start) DO UPDATE SET task_count=weekly_rankings.task_count+1, ncoin_earned=weekly_rankings.ncoin_earned+$3`,
      [attempt.user_id, weekStart, attempt.reward_actual]
    );

    // Ghi nhan IP
    await client.query(
      `INSERT INTO ip_user_map (ip,user_id,first_seen,last_seen) VALUES ($1,$2,$3,$3)
       ON CONFLICT (ip,user_id) DO UPDATE SET last_seen=$3`,
      [ip, attempt.user_id, Date.now()]
    );

    // HOA HONG GIOI THIEU: neu nguoi vua hoan thanh nhiem vu duoc gioi thieu
    // boi ai do, trich % Ncoin vua kiem duoc cong cho nguoi gioi thieu, theo
    // bac hoa hong da duoc MO KHOA VINH VIEN cua ho (referral_tier_locked -
    // xem lib/referral.js). Hoa hong khong tru vao Ncoin cua nguoi hoan
    // thanh nhiem vu - day la tien thuong rieng cho nguoi gioi thieu.
    if (attempt.reward_actual > 0) {
      const refUserRow = await client.query('SELECT referred_by FROM users WHERE id=$1', [attempt.user_id]);
      const referredBy = refUserRow.rows[0]?.referred_by;
      if (referredBy) {
        const settingsRes = await client.query('SELECT * FROM settings');
        const rs = parseReferralSettings(settingsRes.rows);
        if (rs.enabled) {
          const referrerRow = await client.query('SELECT referral_tier_locked FROM users WHERE id=$1', [referredBy]);
          const tier = referrerRow.rows[0]?.referral_tier_locked || 1;
          const rate = getRateForTier(tier, rs);
          const commission = Math.floor(attempt.reward_actual * rate / 100);
          if (commission > 0) {
            await client.query('UPDATE users SET ncoin=ncoin+$1 WHERE id=$2', [commission, referredBy]);
            await client.query(
              'INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
              [referredBy, 'referral', commission, 'ncoin', `Hoa hồng giới thiệu (${rate}%) từ 1 lượt vượt link`, Date.now()]
            );
            const monthStart = getMonthStart();
            await client.query(
              `INSERT INTO referral_monthly (user_id, month_start, ref_count, commission_earned) VALUES ($1,$2,0,$3)
               ON CONFLICT (user_id, month_start) DO UPDATE SET commission_earned = referral_monthly.commission_earned + $3`,
              [referredBy, monthStart, commission]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
  } catch(err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.render('verify', { status:'error', message:'Có lỗi xảy ra, thử lại sau.', reward:0, multiplier:1, targetUrl:null });
  } finally { client.release(); }

  res.render('verify', { status:'success', message:'Hoàn thành!', reward: attempt.reward_actual, multiplier: attempt.multiplier, targetUrl: task.target_url });
});

function getWeekStart() {
  const now = new Date();
  const gmt7 = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 7*3600000);
  const day = gmt7.getDay();
  gmt7.setDate(gmt7.getDate() - day + (day===0?-6:1));
  gmt7.setHours(0,0,0,0);
  return gmt7.getTime() - 7*3600000;
}

module.exports = router;
