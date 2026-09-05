const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/regulations', async (req, res) => {
  const regs = await db.q('SELECT * FROM regulations WHERE active=1 ORDER BY sort_order, id');
  res.render('regulations', { user: req.user, regs });
});

module.exports = router;
