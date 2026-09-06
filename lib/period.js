// Cac ham tinh moc thoi gian theo GMT+7, dung cho thong ke ngay/tuan/thang

function getDayStart(offsetDays = 0) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  gmt7.setDate(gmt7.getDate() + offsetDays);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

function getWeekStart() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  const day = gmt7.getDay();
  gmt7.setDate(gmt7.getDate() - day + (day === 0 ? -6 : 1));
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

function getMonthStart() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  gmt7.setDate(1);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

module.exports = { getDayStart, getWeekStart, getMonthStart };
