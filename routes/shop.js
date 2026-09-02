const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/shop', async (req, res) => {
  const user = req.user;
  const products = await db.q('SELECT * FROM products WHERE active=1 ORDER BY id DESC');
  const myOrders = await db.q('SELECT o.*, p.name as pname FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 10', [user.id]);
  res.render('shop', { user, products, myOrders, error: req.query.error||null, ok: req.query.ok||null });
});

router.post('/shop/:id/buy', async (req, res) => {
  const user = req.user;
  const product = await db.get('SELECT * FROM products WHERE id=$1 AND active=1', [req.params.id]);
  if (!product) return res.redirect('/shop?error=Sản phẩm không tồn tại');
  if (product.stock === 0) return res.redirect('/shop?error=Sản phẩm đã hết hàng');
  if (product.price_ncoin > user.ncoin) return res.redirect('/shop?error=Không đủ Ncoin');
  if (product.price_vcoin > user.vcoin) return res.redirect('/shop?error=Không đủ Vcoin');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (product.price_ncoin > 0) await client.query('UPDATE users SET ncoin=ncoin-$1 WHERE id=$2', [product.price_ncoin, user.id]);
    if (product.price_vcoin > 0) await client.query('UPDATE users SET vcoin=vcoin-$1 WHERE id=$2', [product.price_vcoin, user.id]);
    if (product.stock > 0) await client.query('UPDATE products SET stock=stock-1 WHERE id=$1', [product.id]);
    await client.query(`INSERT INTO orders (user_id,product_id,price_ncoin,price_vcoin,status,created_at) VALUES ($1,$2,$3,$4,'pending',$5)`,
      [user.id, product.id, product.price_ncoin, product.price_vcoin, Date.now()]);
    await client.query(`INSERT INTO transactions (user_id,type,amount,coin_type,description,created_at) VALUES ($1,'buy',$2,'ncoin',$3,$4)`,
      [user.id, product.price_ncoin||product.price_vcoin, `Mua: ${product.name}`, Date.now()]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); return res.redirect('/shop?error=Lỗi, thử lại'); }
  finally { client.release(); }
  res.redirect('/shop?ok=1');
});

module.exports = router;
