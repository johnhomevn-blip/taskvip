const express = require('express');
const db = require('../db');
const { renderRule } = require('../lib/richtext');
const router = express.Router();

router.get('/regulations', async (req, res) => {
  const rows = await db.q('SELECT * FROM regulations WHERE active=1 ORDER BY sort_order, id');
  // Doi noi dung text thanh HTML the dep (da escape an toan trong renderRule)
  const regs = rows.map(r => ({ ...r, html: renderRule(r.content) }));
  res.render('regulations', { user: req.user, regs });
});

module.exports = router;
