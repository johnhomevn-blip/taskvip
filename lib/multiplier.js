/**
 * He so nhan tinh theo gio GMT+7:
 * - Luc 0:00 GMT+7: 1.07
 * - Tru 0.005 moi gio
 * - Min: 0.80 (de tranh am)
 * - Reset ve 1.07 luc 0:00 GMT+7 moi ngay
 */
function getMultiplier() {
  const now = new Date();
  // Lay gio hien tai theo GMT+7
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  const hour = gmt7.getHours();
  const multiplier = Math.max(0.80, 1.07 - hour * 0.005);
  return Math.round(multiplier * 10000) / 10000; // lam tron 4 chu so thap phan
}

// Tra ve thoi gian reset tiep theo (0:00 GMT+7 ngay hom sau)
function getNextReset() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  const tomorrow = new Date(gmt7);
  tomorrow.setHours(24, 0, 0, 0);
  // Chuyen ve UTC
  const tomorrowUTC = tomorrow.getTime() - 7 * 3600000;
  return new Date(tomorrowUTC);
}

// Tinh so giay con lai den reset
function getSecondsUntilReset() {
  const now = Date.now();
  const reset = getNextReset().getTime();
  return Math.max(0, Math.floor((reset - now) / 1000));
}

// Tra ve moc 0:00 GMT+7 CUA NGAY HOM NAY (dung de reset luot nhiem vu dung ngay lich, khong phai 24h lan)
function getDayStart() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

module.exports = { getMultiplier, getNextReset, getSecondsUntilReset, getDayStart };
