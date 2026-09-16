// Theo yeu cau bao mat: thong tin giao hang (tai khoan/mat khau...) cua don
// hang chi hien thi cho khach trong lich su 30 ngay ke tu luc hoan tat, sau
// do PHAI XOA THAT (khong chi an di) khoi database de giam rui ro ro ri du
// lieu nhay cam ve lau dai.
const db = require('../db');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function purgeOldDeliveryInfo() {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  try {
    await db.run(
      `UPDATE orders SET delivery_info='' WHERE delivery_info != '' AND processed_at IS NOT NULL AND processed_at < $1`,
      [cutoff]
    );
    await db.run(
      `UPDATE custom_orders SET delivery_info='' WHERE delivery_info != '' AND updated_at < $1 AND status='completed'`,
      [cutoff]
    );
  } catch (e) {
    console.error('Lỗi cron dọn dẹp delivery_info:', e);
  }
}

module.exports = { purgeOldDeliveryInfo };
