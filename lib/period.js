// Cac ham tinh moc thoi gian theo GMT+7, dung cho thong ke ngay/tuan/thang

function getDayStart(offsetDays = 0) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  gmt7.setDate(gmt7.getDate() + offsetDays);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

// atTime cho phep tinh moc tuan cho 1 THOI DIEM BAT KY trong qua khu (mac
// dinh la hien tai neu khong truyen) - can cho truong hop admin duyet tay 1
// nhiem vu bi giu lai (cau dao/nghi ngo farm) o 1 thoi diem SAU do, co the da
// SANG TUAN KHAC - luc do phai tinh theo tuan LUC NGUOI DUNG HOAN THANH nhiem
// vu (attempt.created_at), khong phai tuan luc admin bam duyet, neu khong
// luot vuot link se bi cong nham vao BXH cua tuan sai.
function getWeekStart(atTime = Date.now()) {
  const now = new Date(atTime);
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  const day = gmt7.getDay();
  gmt7.setDate(gmt7.getDate() - day + (day === 0 ? -6 : 1));
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

function getMonthStart(atTime = Date.now()) {
  const now = new Date(atTime);
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmt7 = new Date(utc + 7 * 3600000);
  gmt7.setDate(1);
  gmt7.setHours(0, 0, 0, 0);
  return gmt7.getTime() - 7 * 3600000;
}

module.exports = { getDayStart, getWeekStart, getMonthStart };
