const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { getLevelInfo, getLevelTag, expToNextLevel } = require('../lib/level');
const router = express.Router();

router.get('/account', async (req, res) => {
  const user = req.user;
  const levelInfo = getLevelInfo(user.exp);
  const tag = getLevelTag(levelInfo.level);
  res.render('account', { user, levelInfo, tag, error: req.query.error||null, ok: req.query.ok||null });
});

router.post('/account/password', async (req, res) => {
  const { old_password, new_password, new_password2 } = req.body;
  const user = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!bcrypt.compareSync(old_password, user.password_hash))
    return res.redirect('/account?error=Mật khẩu cũ không đúng');
  if (new_password.length < 6)
    return res.redirect('/account?error=Mật khẩu mới tối thiểu 6 ký tự');
  if (new_password !== new_password2)
    return res.redirect('/account?error=Mật khẩu mới không khớp');
  const hash = bcrypt.hashSync(new_password, 10);
  await db.run('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
  res.redirect('/account?ok=1');
});

module.exports = router;
