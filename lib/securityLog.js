const db = require('../db');

/**
 * Ghi 1 su kien bao mat vao bang security_events, dung chung cho honeypot,
 * cau dao, va co nghi ngo farm - de admin xem lai lich su o 1 cho duy nhat
 * (tab Bao mat trong Admin Panel).
 *
 * Boc trong try/catch va KHONG throw loi ra ngoai: ghi log khong bao gio
 * duoc phep lam hong luong xu ly chinh (vd 1 nguoi dang dang ky/dang nhap
 * that su) neu chinh viec ghi log gap su co.
 */
async function logSecurityEvent(eventType, { ip = '', userId = null, detail = '' } = {}) {
  try {
    await db.run(
      'INSERT INTO security_events (event_type, ip, user_id, detail, created_at) VALUES ($1,$2,$3,$4,$5)',
      [eventType, ip || '', userId, detail || '', Date.now()]
    );
  } catch (e) {
    console.error('[SECURITY LOG] Khong ghi duoc security_events:', e.message);
  }
}

module.exports = { logSecurityEvent };
