// He thong hoa hong gioi thieu ban be, bac thang, KHOA VINH VIEN:
// - So nguoi da gioi thieu (tinh toan bo tu truoc den nay, khong tinh theo
//   thang) quyet dinh bac hoa hong hien tai duoc MO KHOA.
// - Khi da mo khoa 1 bac cao hon, "referral_tier_locked" chi tang, KHONG BAO
//   GIO giam - du sau nay tai khoan duoc gioi thieu bi xoa/khoa lam giam so
//   dem thuc te, nguoi gioi thieu van giu nguyen bac hoa hong da dat duoc.
// - Ty le % hoa hong va nguong so luong deu lay tu bang settings de admin co
//   the chinh sua, cac gia tri duoi day chi la mac dinh ban dau.

function getTierFromCount(count, thresholds) {
  const { threshold2, threshold3 } = thresholds;
  if (count >= threshold3) return 3;
  if (count >= threshold2) return 2;
  return 1;
}

function getRateForTier(tier, rates) {
  if (tier >= 3) return rates.rate3;
  if (tier === 2) return rates.rate2;
  return rates.rate1;
}

// Doc cac settings lien quan referral tu bang settings (mang key-value) va
// tra ve dang object so, kem gia tri mac dinh phong khi thieu key.
function parseReferralSettings(settingsRows) {
  const s = {};
  settingsRows.forEach(r => { s[r.key] = r.value; });
  return {
    enabled: s.referral_enabled !== '0',
    threshold2: parseInt(s.referral_threshold_2) || 51,
    threshold3: parseInt(s.referral_threshold_3) || 101,
    rate1: parseFloat(s.referral_rate_1) || 7,
    rate2: parseFloat(s.referral_rate_2) || 12,
    rate3: parseFloat(s.referral_rate_3) || 15,
    reward1: parseInt(s.referral_reward_1) || 0,
    reward2: parseInt(s.referral_reward_2) || 0,
    reward3: parseInt(s.referral_reward_3) || 0,
  };
}

function getMonthStart() {
  const now = new Date();
  const gmt7 = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 7 * 3600000);
  gmt7.setDate(1);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

function getNextMonthStart(monthStart) {
  const d = new Date(monthStart + 7 * 3600000);
  d.setMonth(d.getMonth() + 1);
  return d.getTime() - 7 * 3600000;
}

module.exports = { getTierFromCount, getRateForTier, parseReferralSettings, getMonthStart, getNextMonthStart };
