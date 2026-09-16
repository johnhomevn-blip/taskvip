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
  const myOrders = await db.q('SELECT o.*, p.name as pname FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 20', [user.id]);
  const myCustomOrders = await db.q('SELECT * FROM custom_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]);
  res.render('shop', { user, categories, products, myOrders, myCustomOrders, error: req.query.error||null, ok: req.query.ok||null });
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
      `INSERT INTO orders (user_id,product_id,order_code,quantity,price_ncoin,price_vcoin,status,delivery_info,created_at,processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [user.id, product.id, orderCode, quantity, deductNcoin, deductVcoin, status, deliveryInfo, now, processedAt]
    );

    if (freshProduct.delivery_mode === 'pool') {
      await client.query(
        `UPDATE product_stock SET status='sold', order_id=$1 WHERE id = ANY($2::int[])`,
        [orderRow.rows[0].id, stockItemIds]
      );
    }

    await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'buy',$2,'ncoin',$3,$4)`,
      [user.id, price, `Mua: ${product.name} x${quantity} (mã ${orderCode})`, now]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); return res.redirect('/shop?error=Lỗi, thử lại'); }
  finally { client.release(); }
  res.redirect('/shop?ok=1');
});

// ===== DON DAT HANG TUY CHINH =====
// Khac voi mua san pham co san: user mo ta thu ho muon (khong co gia san),
// admin bao gia (quoted), user dong y & thanh toan (confirmed, tru coin luc
// nay), admin gui tai khoan/mat khau lai (delivery_info) roi danh dau
// completed. User co the huy don khi con chua thanh toan (pending/quoted)
// ma khong mat gi vi chua tru coin.

router.post('/shop/custom', async (req, res) => {
  const { title, details } = req.body;
  if (!title || !title.trim()) return res.redirect('/shop?error=Vui lòng nhập tên/mô tả thứ bạn muốn đặt');
  const orderCode = await generateOrderCode();
  await db.run(
    `INSERT INTO custom_orders (user_id,order_code,title,details,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'pending',$5,$5)`,
    [req.user.id, orderCode, title.trim(), (details||'').trim(), Date.now()]
  );
  res.redirect('/shop?ok=1#custom');
});

router.post('/shop/custom/:id/cancel', async (req, res) => {
  const order = await db.get('SELECT * FROM custom_orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!order) return res.redirect('/shop?error=Đơn không tồn tại');
  if (!['pending','quoted'].includes(order.status)) return res.redirect('/shop?error=Đơn này không thể hủy');
  await db.run("UPDATE custom_orders SET status='cancelled', updated_at=$1 WHERE id=$2", [Date.now(), order.id]);
  res.redirect('/shop?ok=1#custom');
});

router.post('/shop/custom/:id/confirm', async (req, res) => {
  const user = req.user;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const orderLock = await client.query(
      `SELECT * FROM custom_orders WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [req.params.id, user.id]
    );
    const order = orderLock.rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.redirect('/shop?error=Đơn không tồn tại'); }
    if (order.status !== 'quoted') { await client.query('ROLLBACK'); return res.redirect('/shop?error=Đơn này chưa được báo giá hoặc đã xử lý'); }

    const userLock = await client.query('SELECT ncoin, vcoin FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const freshUser = userLock.rows[0];
    const price = order.quoted_price || 0;
    const totalAvailable = freshUser.ncoin + freshUser.vcoin;
    if (price > totalAvailable) {
      await client.query('ROLLBACK');
      return res.redirect('/shop?error=Không đủ coin để xác nhận đơn này');
    }
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
    await client.query(
      `UPDATE custom_orders SET status='confirmed', price_ncoin=$1, price_vcoin=$2, updated_at=$3 WHERE id=$4`,
      [deductNcoin, deductVcoin, Date.now(), order.id]
    );
    await client.query(
      `INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'buy',$2,'ncoin',$3,$4)`,
      [user.id, price, `Đặt hàng tùy chỉnh: ${order.title} (mã ${order.order_code})`, Date.now()]
    );
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); return res.redirect('/shop?error=Lỗi, thử lại'); }
  finally { client.release(); }
  res.redirect('/shop?ok=1#custom');
});

module.exports = router;
