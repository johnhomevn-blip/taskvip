const { getLevelInfo } = require('./level');
const { getRateForTier, parseReferralSettings } = require('./referral');
const { getWeekStart, getMonthStart } = require('./period');

/**
 * Logic "tra thuong" dung chung cho 2 noi:
 *  1) routes/verify.js - khi nguoi dung vuot link xong VA cau dao/co nghi
 *     ngo KHONG active -> cong thuong ngay lap tuc nhu truoc gio.
 *  2) routes/admin.js  - khi admin bam "Duyet" cho 1 nhiem vu dang o hang
 *     "cho_duyet" (da bi giu lai truoc do vi cau dao hoac co nghi ngo).
 *
 * Tach rieng ra 1 noi DE TRANH 2 noi goi code tra thuong khac nhau roi lech
 * nhau dan (vd quen cong hoa hong gioi thieu o 1 trong 2 cho) - day chinh la
 * loai loi nguy hiem nhat cho 1 website kinh te that.
 *
 * QUAN TRONG: ham nay PHAI duoc goi BEN TRONG 1 transaction (client) da
 * BEGIN san, va CALLER chiu trach nhiem chuyen task_attempts.status sang
 * 'completed' bang 1 cau UPDATE ... WHERE status='<trang_thai_cu>' rieng
 * (vi dieu kien WHERE khac nhau giua 2 luong: 'pending' o luong 1, 'cho_duyet'
 * o luong 2) - ham nay chi lo phan HAU QUA cua viec cong thuong, khong lo
 * viec chuyen trang thai.
 *
 * @param hasPendingTransactionRow - true neu da co san 1 dong transactions
 *   voi ref_attempt_id=attempt.id VA type='earn_pending' (tao luc attempt bi
 *   giu lai) can CAP NHAT LAI thanh 'earn', thay vi INSERT dong moi.
 */
async function creditAttemptReward(client, { attempt, task, ip, hasPendingTransactionRow, approvedByAdmin }) {
  const updUser = await client.query(
    'UPDATE users SET ncoin=ncoin+$1, exp=exp+$2 WHERE id=$3 RETURNING exp',
    [attempt.reward_actual, task.exp_reward, attempt.user_id]
  );
  const newExp = updUser.rows[0].exp;
  const { level } = getLevelInfo(newExp);
  await client.query('UPDATE users SET level=$1 WHERE id=$2', [level, attempt.user_id]);

  const desc = approvedByAdmin
    ? `Vượt link (đã duyệt sau kiểm tra): ${task.name}`
    : `Vượt link: ${task.name}`;

  if (hasPendingTransactionRow) {
    await client.query(
      "UPDATE transactions SET type='earn', description=$1 WHERE ref_attempt_id=$2 AND type='earn_pending'",
      [desc, attempt.id]
    );
  } else {
    await client.query(
      'INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at,ref_attempt_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [attempt.user_id, 'earn', attempt.reward_actual, 'ncoin', desc, Date.now(), attempt.id]
    );
  }

  // Cap nhat weekly ranking - dung tuan LUC HOAN THANH nhiem vu (attempt.created_at),
  // KHONG phai tuan hien tai (Date.now()) - vi neu la nhiem vu duoc admin
  // duyet tay sau khi bi giu lai, thoi diem duyet co the da sang tuan khac
  // roi, se cong nham vao BXH tuan sai neu dung Date.now().
  //
  // LUU Y QUAN TRONG: created_at la cot BIGINT nen node-pg tra ve dang CHUOI
  // ('1789824556972'). Truyen thang chuoi nay vao new Date() cho ra Invalid
  // Date -> week_start = NaN -> Postgres bao loi 'invalid input syntax for
  // type bigint: "NaN"' -> toan bo transaction bi ROLLBACK (day la nguyen
  // nhan admin bam "Duyet" luon bao "Loi khi duyet"). Phai doi sang SO truoc.
  const attemptTime = Number(attempt.created_at) > 0 ? Number(attempt.created_at) : Date.now();
  const weekStart = getWeekStart(attemptTime);
  await client.query(
    `INSERT INTO weekly_rankings (user_id,week_start,task_count,ncoin_earned) VALUES ($1,$2,1,$3)
     ON CONFLICT (user_id,week_start) DO UPDATE SET task_count=weekly_rankings.task_count+1, ncoin_earned=weekly_rankings.ncoin_earned+$3`,
    [attempt.user_id, weekStart, attempt.reward_actual]
  );

  // Ghi nhan IP
  await client.query(
    `INSERT INTO ip_user_map (ip,user_id,first_seen,last_seen) VALUES ($1,$2,$3,$3)
     ON CONFLICT (ip,user_id) DO UPDATE SET last_seen=$3`,
    [ip || '', attempt.user_id, Date.now()]
  );

  // Hoa hong gioi thieu (giu nguyen logic nhu routes/verify.js ban goc)
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
          const monthStart = getMonthStart(attemptTime);
          await client.query(
            `INSERT INTO referral_monthly (user_id, month_start, ref_count, commission_earned) VALUES ($1,$2,0,$3)
             ON CONFLICT (user_id, month_start) DO UPDATE SET commission_earned = referral_monthly.commission_earned + $3`,
            [referredBy, monthStart, commission]
          );
        }
      }
    }
  }
}

/**
 * Dua 1 attempt vao hang "cho_duyet" (khong cong thuong) va ghi lai dong
 * transactions kieu 'earn_pending' de nguoi dung THAY DUOC trong lich su cua
 * ho ngay lap tuc rang nhiem vu da ghi nhan xong nhung dang cho duyet - chu
 * khong phai bien mat/im lang kho hieu.
 */
async function insertPendingTransaction(client, { attempt, task, reasonLabel }) {
  await client.query(
    'INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at,ref_attempt_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [attempt.user_id, 'earn_pending', attempt.reward_actual, 'ncoin',
     `Vượt link (đang chờ duyệt - ${reasonLabel}): ${task.name}`, Date.now(), attempt.id]
  );
}

module.exports = { creditAttemptReward, insertPendingTransaction };
