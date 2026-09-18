const express = require('express');
const db = require('../db');
const { generateOrderCode } = require('../lib/orderCode');
const router = express.Router();

router.get('/shop', async (req, res) => {
  const user = req.user;
  const categories = await db.q('SELECT * FROM shop_categories WHERE active=1 ORDER BY sort_order, id');
  // Voi san pham "giao tu dong" (delivery_mode='pool'), so luong con hang
  // THUC TE la so dong con 'available' trong kho (product_stock), khong
  // phai con so 'stock' admin go tay (con so do chi dung cho san pham kieu
  // 'manual'/khong gioi han).
  const products = await db.q(`
    SELECT p.*,
      CASE WHEN p.delivery_mode='pool'
        THEN (SELECT COUNT(*)::int FROM product_stock ps WHERE ps.product_id=p.id AND ps.status='available')
        ELSE p.stock END AS effective_stock
    FROM products p WHERE p.active=1 ORDER BY p.id DESC
  `);
  // LEFT JOIN + COALESCE(p.name, o.product_name): don hang van hien dung ten
  // ngay ca khi san pham goc DA BI ADMIN XOA HAN (xem giai thich o migration
  // them cot product_name trong db.js) - INNER JOIN cu se lam don hang bien
  // mat khoi lich su ngay khi xoa san pham, du don da hoan tat tu lau.
  const myOrders = await db.q('SELECT o.*, COALESCE(p.name, o.product_name) as pname FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 20', [user.id]);
  res.render('shop', { user, categories, products, myOrders, error: req.query.error||null, ok: req.query.ok||null });
});

router.post('/shop/:id/buy', async (req, res) => {
  const user = req.user;
  const quantity = Math.max(1, parseInt(req.body.quantity) || 1);

  // VA LOI: validate id la so nguyen truoc khi dua vao query (tranh loi kieu
  // du lieu Postgres lam crash server o cac ban cu, xem ghi chu trong server.js)
  if (!/^\d+$/.test(String(req.params.id))) {
    return res.redirect('/shop?error=Sản phẩm không tồn tại');
  }
  if (quantity > 50) return res.redirect('/shop?error=Số lượng mua 1 lần tối đa 50');

  const product = await db.get('SELECT * FROM products WHERE id=$1 AND active=1', [req.params.id]);
  if (!product) return res.redirect('/shop?error=Sản phẩm không tồn tại');

  // YEU CAU KHACH NHAP THONG TIN (vd username Roblox) NEU SAN PHAM BAT
  // require_note - kiem tra & lam sach o day, TRUOC khi mo transaction/tru
  // coin, de khach thieu thong tin khong bi mat coin oan.
  const note = (req.body.note || '').trim().slice(0, 300);
  if (product.require_note && !note) {
    return res.redirect(`/shop?error=${encodeURIComponent('Vui lòng nhập: ' + (product.note_label || 'thông tin cần thiết'))}`);
  }

  const price = (product.price || 0) * quantity;
  const orderCode = await generateOrderCode();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const userLock = await client.query('SELECT ncoin, vcoin FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const freshUser = userLock.rows[0];
    if (!freshUser) { await client.query('ROLLBACK'); return res.redirect('/shop?error=Tài khoản không tồn tại'); }

    const productLock = await client.query('SELECT * FROM products WHERE id=$1 AND active=1 FOR UPDATE', [product.id]);
    const freshProduct = productLock.rows[0];
    if (!freshProduct) { await client.query('ROLLBACK'); return res.redirect('/shop?error=Sản phẩm không tồn tại'); }

    // Kiem tra ton kho TUY THEO KIEU GIAO HANG cua san pham
    let stockItemIds = [];
    if (freshProduct.delivery_mode === 'pool') {
      // Khoa dung "quantity" dong con available de tranh 2 nguoi cung mua
      // trung 1 tai khoan (FOR UPDATE SKIP LOCKED: bo qua nhung dong dang bi
      // 1 giao dich khac khoa, chi lay nhung dong THUC SU con ranh)
      const poolLock = await client.query(
        `SELECT id FROM product_stock WHERE product_id=$1 AND status='available' ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [product.id, quantity]
      );
      if (poolLock.rows.length < quantity) {
        await client.query('ROLLBACK');
        return res.redirect(`/shop?error=Sản phẩm chỉ còn ${poolLock.rows.length} trong kho, không đủ ${quantity} bạn yêu cầu`);
      }
      stockItemIds = poolLock.rows.map(r => r.id);
    } else if (freshProduct.stock !== -1) {
      if (freshProduct.stock < quantity) {
        await client.query('ROLLBACK');
        return res.redirect(`/shop?error=Sản phẩm chỉ còn ${freshProduct.stock}, không đủ ${quantity} bạn yêu cầu`);
      }
    }

    const totalAvailable = freshUser.ncoin + freshUser.vcoin;
    if (price > totalAvailable) {
      await client.query('ROLLBACK');
      return res.redirect('/shop?error=Không đủ coin để đổi sản phẩm này');
    }

    // Uu tien tru Ncoin truoc, thieu moi tru sang Vcoin
    const deductNcoin = Math.min(freshUser.ncoin, price);
    const deductVcoin = price - deductNcoin;

    if (deductNcoin > 0) {
      const r1 = await client.query('UPDATE users SET ncoin=ncoin-$1 WHERE id=$2 AND ncoin>=$1', [deductNcoin, user.id]);
      if (r1.rowCount === 0) throw new Error('Không đủ Ncoin (race condition đã bị chặn)');
    }
    if (deductVcoin > 0) {
      const r2 = await client.query('UPDATE users SET vcoin=vcoin-$1 WHERE id=$2 AND vcoin>=$1', [deductVcoin, user.id]);
      if (r2.rowCount === 0) throw new Error('Không đủ Vcoin (race condition đã bị chặn)');
    }
    if (freshProduct.delivery_mode !== 'pool' && freshProduct.stock > 0) {
      const r3 = await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock>=$1', [quantity, product.id]);
      if (r3.rowCount === 0) throw new Error('Hết hàng (race condition đã bị chặn)');
    }

    const now = Date.now();
    let deliveryInfo = '';
    let status = 'pending';
    let processedAt = null;

    if (freshProduct.delivery_mode === 'pool') {
      // Lay noi dung cac dong da khoa o tren, danh dau 'sold', ghep lai
      // thanh 1 chuoi giao ngay lap tuc cho khach (khong can admin can thiep)
      const contentsRes = await client.query(
        `SELECT id, content FROM product_stock WHERE id = ANY($1::int[]) ORDER BY id`,
        [stockItemIds]
      );
      deliveryInfo = contentsRes.rows.map(r => r.content).join('\n---\n');
      status = 'completed';
      processedAt = now;
    }

    const orderRow = await client.query(
      `INSERT INTO orders (user_id,product_id,order_code,quantity,price_ncoin,price_vcoin,status,delivery_info,created_at,processed_at,product_name,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [user.id, product.id, orderCode, quantity, deductNcoin, deductVcoin, status, deliveryInfo, now, processedAt, product.name, note]
    );

    if (freshProduct.delivery_mode === 'pool') {
      await client.query(
        `UPDATE product_stock SET status='sold', order_id=$1 WHERE id = ANY($2::int[])`,
        [orderRow.rows[0].id, stockItemIds]
      );
    }

    // VA LOI GHI SAI LICH SU GIAO DICH DA SUA (2026-09): truoc day LUON ghi 1
    // dong voi coin_type CO DINH la 'ncoin' va amount = tong gia `price`, bat
    // ke thuc te co the da tru MOT PHAN hoac TOAN BO tu Vcoin (deductVcoin).
    // Tien trong tai khoan van tru DUNG (dong code phia tren khong doi), day
    // CHI la loi ghi log/lich su - nhung se gay sai lech khi doi soat/thong ke
    // theo loai coin (vd bao cao "da tieu bao nhieu Vcoin qua Shop" se luon ra
    // 0). Gio ghi rieng tung dong theo dung loai coin THUC SU bi tru, giong
    // cach withdrawals dang tach ncoin_used/vcoin_used.
    if (deductNcoin > 0) {
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'buy',$2,'ncoin',$3,$4)`,
        [user.id, deductNcoin, `Mua: ${product.name} x${quantity} (mã ${orderCode})`, now]);
    }
    if (deductVcoin > 0) {
      await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'buy',$2,'vcoin',$3,$4)`,
        [user.id, deductVcoin, `Mua: ${product.name} x${quantity} (mã ${orderCode})`, now]);
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); return res.redirect('/shop?error=Lỗi, thử lại'); }
  finally { client.release(); }
  res.redirect('/shop?ok=1');
});

// ===== DON DAT HANG TUY CHINH =====
// ===== DA XOA: "Dat hang tuy chinh" (2026-09) =====
// Theo yeu cau chu web: tinh nang nay cho phep khach mo ta bat ky thu gi ho
// muon mua roi admin bao gia rieng - nhung chu web hien khong co nguon hang
// linh hoat de dap ung kieu don le nay, nen bo hoan toan khoi giao dien +
// route de tranh khach gui yeu cau ma khong ai xu ly. Bang custom_orders
// trong DB VAN GIU NGUYEN (khong xoa) de khong mat du lieu lich su cu va vi
// van con rang buoc khoa ngoai voi bang users (routes/admin.js van xoa dong
// lien quan khi xoa 1 user, xem ham xoa tai khoan).

module.exports = router;
