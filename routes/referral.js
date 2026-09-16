const express = require('express');
const db = require('../db');
const { maskUsername } = require('../lib/mask');
const { getRateForTier, parseReferralSettings, getMonthStart, getNextMonthStart } = require('../lib/referral');
const { checkAndDistributeAllRewards } = require('../lib/rewardCron');
const router = express.Router();

router.get('/referral', async (req, res) => {
  await checkAndDistributeAllRewards(); // du phong, xem giai thich o routes/ranking.js
  const user = req.user;
  const settingsRows = await db.q('SELECT * FROM settings');
  const rs = parseReferralSettings(settingsRows);

  const monthStart = getMonthStart();
  const nextMonthStart = getNextMonthStart(monthStart);
  const secondsLeft = Math.max(0, Math.floor((nextMonthStart - Date.now()) / 1000));

  const totalCountRow = await db.get('SELECT COUNT(*)::int as c FROM users WHERE referred_by=$1', [user.id]);
  const totalReferred = totalCountRow.c;

  const myMonthRow = await db.get(
    'SELECT * FROM referral_monthly WHERE user_id=$1 AND month_start=$2',
    [user.id, monthStart]
  );
  const monthReferred = myMonthRow?.ref_count || 0;
  const monthCommission = myMonthRow?.commission_earned || 0;

  const totalCommissionRow = await db.get(
    "SELECT COALESCE(SUM(amount),0)::int as s FROM transactions WHERE user_id=$1 AND type='referral'",
    [user.id]
  );

  const currentRate = getRateForTier(user.referral_tier_locked, rs);
  const nextTier = user.referral_tier_locked >= 3 ? null : user.referral_tier_locked + 1;
  const nextTierNeeded = nextTier === 2 ? rs.threshold2 : nextTier === 3 ? rs.threshold3 : null;
  const nextTierRate = nextTier ? getRateForTier(nextTier, rs) : null;

  const referredUsers = await db.q(
    'SELECT username, created_at FROM users WHERE referred_by=$1 ORDER BY created_at DESC LIMIT 30',
    [user.id]
  );

  const leaderboard = rs.enabled ? await db.q(
    `SELECT rm.*, u.username FROM referral_monthly rm JOIN users u ON u.id=rm.user_id
     WHERE rm.month_start=$1 ORDER BY rm.ref_count DESC, rm.commission_earned DESC LIMIT 10`,
    [monthStart]
  ) : [];

  const myRankRow = rs.enabled ? await db.get(
    `SELECT COUNT(*)+1 as rank FROM referral_monthly WHERE month_start=$1 AND ref_count>(SELECT COALESCE(ref_count,0) FROM referral_monthly WHERE user_id=$2 AND month_start=$1)`,
    [monthStart, user.id]
  ) : null;

  res.render('referral', {
    user,
    referralLink: `${process.env.BASE_URL || ''}/register?ref=${user.referral_code}`,
    referralCode: user.referral_code,
    tier: user.referral_tier_locked,
    currentRate, nextTier, nextTierNeeded, nextTierRate,
    totalReferred, monthReferred, monthCommission,
    totalCommission: totalCommissionRow.s,
    referredUsers: referredUsers.map(u => ({ ...u, maskedName: maskUsername(u.username) })),
    leaderboard: leaderboard.map(r => ({ ...r, maskedName: maskUsername(r.username) })),
    myRank: parseInt(myRankRow?.rank || 0),
    secondsLeft,
    enabled: rs.enabled,
    rewards: { r1: rs.reward1, r2: rs.reward2, r3: rs.reward3 },
    thresholds: { t2: rs.threshold2, t3: rs.threshold3 },
    rates: { r1: rs.rate1, r2: rs.rate2, r3: rs.rate3 },
  });
});

module.exports = router;
