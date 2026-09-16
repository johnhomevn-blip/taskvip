const crypto = require('crypto');
const db = require('../db');

// Sinh ma don hang ngan, de doc, dung khi can tra cuu/doi chieu (vd khach
// bao loi don hang, admin tim theo ma). Dinh dang: "DH" + 6 ky tu hex viet
// hoa, vd "DH3F9A1B". Kiem tra khong trung trong CA HAI bang orders va
// custom_orders (dung chung 1 khong gian ma cho de nhan biet, tranh nham lan
// "DH... la loai don nao").
async function generateOrderCode() {
  for (let i = 0; i < 10; i++) {
    const code = 'DH' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const existsInOrders = await db.get('SELECT 1 FROM orders WHERE order_code=$1', [code]);
    if (existsInOrders) continue;
    const existsInCustom = await db.get('SELECT 1 FROM custom_orders WHERE order_code=$1', [code]);
    if (existsInCustom) continue;
    return code;
  }
  return 'DH' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

module.exports = { generateOrderCode };
