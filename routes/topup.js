const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/topup', async (req, res) => {
  const user = req.user;
  const noticeRow = await db.get("SELECT value FROM settings WHERE key='topup_notice'");
  const history = await db.q('SELECT * FROM topups WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]);
  res.render('topup', { user, notice: noticeRow?.value || '', history, ok: req.query.ok||null });
});

module.exports = router;
