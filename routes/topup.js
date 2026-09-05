const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/topup', async (req, res) => {
  const user = req.user;
  const settings = await db.q("SELECT * FROM settings WHERE key IN ('topup_notice','topup_guide','admin_bank','vcoin_lockdays')");
  const s = {}; settings.forEach(x => s[x.key]=x.value);
  const history = await db.q('SELECT * FROM topups WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]);
  const lockDays = parseInt(s.vcoin_lockdays || 28);
  res.render('topup', { user, settings: s, history, lockDays, ok: req.query.ok||null });
});

module.exports = router;
