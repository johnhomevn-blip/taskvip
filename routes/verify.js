const express = require('express');
const { getClientIp } = require('../lib/ip');
const db = require('../db');
const token = require('../lib/token');
const breaker = require('../lib/breaker');
const fraud = require('../lib/fraud');
const { checkReferer } = require('../lib/refererCheck');
const { logSecurityEvent } = require('../lib/securityLog');
const { creditAttemptReward, insertPendingTransaction } = require('../lib/attemptFlow');
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

  // ============================================================
  // CHONG GIAN LAN (2026-09): truoc khi cong thuong that su, kiem tra 3 lop
  // phong thu doc lap voi nhau - NEU BAT KY LOP NAO kich hoat, attempt nay se
  // bi GIU LAI de admin duyet thu cong thay vi cong coin ngay:
  //   1) Cau dao toan he thong (lib/breaker.js): tong Ncoin/gio dang vuot
  //      nguong admin dat - bao ve khoi 1 loai tan cong (vd exploit /verify,
  //      hoac farm quy mo lon) rut can quy thuong RAT NHANH.
  //   2) Co nghi ngo rieng cho tai khoan nay (lib/fraud.js): nhieu tai khoan
  //      cung IP/thiet bi, thoi gian hoan thanh qua deu dan (kieu bot),
  //      hoac hang loat tai khoan dang ky cung luc - bao ve khoi kieu farm
  //      "nhieu tai khoan nho le" thay vi 1 cu tan cong lon.
  //   3) Referer khong khop domain nha cung cap (lib/refererCheck.js): dau
  //      hieu nguoi dung KHONG thuc su di qua trang dem gio/quang cao cua
  //      nha cung cap ma bypass thang toi /verify (giai ma base64 dan link,
  //      dung web/tool bypass). Khong chan cung vi 1 so trinh duyet/tien ich
  //      tu xoa Referer vi ly do rieng tu (xem giai thich chi tiet trong
  //      lib/refererCheck.js).
  // Ca 3 deu KHONG tu dong khoa/tu choi gi ca - chi tam giu lai cho admin
  // xem, dung nguyen tac "phan tich hanh vi, khong chan cung" da thong nhat.
  // ============================================================
  const breakerResult = await breaker.evaluateAndTrip(attempt.reward_actual, { ip });
  let holdReason = null;
  if (task.require_review) {
    // Nha cung cap nay yeu cau IP chat luong (kiem tra tay 100%, khong co du
    // lieu tin cay de tu dong doan IP tot/xau mien phi) - LUON giu lai du
    // cau dao/co nghi ngo the nao, khong can tinh toan them gi ca.
    holdReason = 'quality_ip';
    // Van goi evaluateAndTrip o tren de cau dao van duoc cap nhat dung so
    // lieu Ncoin/gio thuc te (neu khong goi, cau dao se "khong biet" ve
    // luong Ncoin cua cac nhiem vu loai nay khi tinh nguong).
  } else if (breakerResult.tripped) {
    holdReason = 'breaker';
  } else {
    const risk = await fraud.evaluateUserRisk(attempt.user_id, { ip, fingerprint: attempt.fingerprint });
    if (risk.flagged) {
      holdReason = 'fraud';
    } else {
      const refererResult = await checkReferer(req, task);
      if (!refererResult.ok) {
        holdReason = 'referer';
        await logSecurityEvent('referer_mismatch', {
          ip, userId: attempt.user_id,
          detail: `Lượt vượt link #${tid} (${task.name}): ${refererResult.reason}` +
            (refererResult.expectedHost ? `, mong đợi "${refererResult.expectedHost}"` : '') +
            (refererResult.refererHost ? `, thực tế "${refererResult.refererHost}"` : ' (Referer trống)'),
        });
      }
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const finalStatus = holdReason ? 'cho_duyet' : 'completed';
    // VA LOI RACE CONDITION (quan trong nhat): dieu kien "AND status='pending'"
    // bien cau UPDATE nay thanh 1 thao tac nguyen tu duoc Postgres khoa dong
    // (row lock): chi 1 transaction duy nhat co the doi status tu 'pending'
    // sang trang thai cuoi (dua vao finalStatus da tinh o tren), cac request
    // goi song song sau do se thay rowCount=0 va bi tu choi - khong the nhan
    // ban phan thuong nhieu lan chi tu 1 lan vuot link that.
    const upd = await client.query(
      "UPDATE task_attempts SET status=$1, completed_at=$2, ip_verified=$3, held_reason=$4 WHERE id=$5 AND status='pending'",
      [finalStatus, Date.now(), ip, holdReason || '', tid]
    );
    if (upd.rowCount === 0) {
      // Da co request khac xu ly xong attempt nay truoc (hoac da het han) -> dung lai, khong cong thuong 2 lan
      await client.query('ROLLBACK');
      return res.render('verify', { status:'error', message:'Nhiệm vụ này đã được xử lý rồi.', reward:0, multiplier:1, targetUrl:null });
    }

    if (holdReason) {
      const reasonLabel = holdReason === 'breaker'
        ? 'hệ thống phát hiện biến động Ncoin bất thường toàn hệ thống'
        : holdReason === 'referer'
        ? 'chưa xác nhận được bạn đã đi qua trang rút gọn link'
        : holdReason === 'quality_ip'
        ? 'nhà cung cấp yêu cầu kiểm tra IP chất lượng trước khi ghi nhận'
        : 'tài khoản có dấu hiệu cần xác minh thêm';
      await insertPendingTransaction(client, { attempt, task, reasonLabel });
    } else {
      await creditAttemptReward(client, { attempt, task, ip, hasPendingTransactionRow: false, approvedByAdmin: false });
    }

    await client.query('COMMIT');
  } catch(err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.render('verify', { status:'error', message:'Có lỗi xảy ra, thử lại sau.', reward:0, multiplier:1, targetUrl:null });
  } finally { client.release(); }

  if (holdReason) {
    return res.render('verify', {
      status: 'holding',
      message: 'Đã ghi nhận lượt vượt link của bạn. Do hệ thống phát hiện dấu hiệu bất thường tạm thời, phần thưởng sẽ được cộng sau khi admin kiểm tra (thường trong thời gian ngắn). Bạn có thể xem trạng thái trong mục Lịch sử.',
      reward: attempt.reward_actual, multiplier: attempt.multiplier, targetUrl: task.target_url,
    });
  }

  res.render('verify', { status:'success', message:'Hoàn thành!', reward: attempt.reward_actual, multiplier: attempt.multiplier, targetUrl: task.target_url });
});

module.exports = router;
