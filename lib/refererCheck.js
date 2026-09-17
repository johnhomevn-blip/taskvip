const db = require('../db');

/**
 * So sanh Referer header cua request /verify voi domain THUC SU cua nha
 * cung cap ma task nay dang dung, de phat hien nguoi dung BYPASS truc tiep
 * toi /verify (giai ma base64 link roi dan thang vao tab moi, hoac dung web
 * bypass/tool tu dong) ma KHONG thuc su di qua trang dem gio/quang cao cua
 * nha cung cap.
 *
 * Domain "dung" duoc suy ra TU CHINH api_endpoint da luu cua nha cung cap
 * (khong can them 1 truong cau hinh moi nao) - vd endpoint la
 * "https://link4m.co/st?api={API_KEY}&url={URL}" thi domain mong doi la
 * "link4m.co".
 *
 * CHI mang tinh chat "co nghi ngo" - GIONG HET cau dao/fraud (lib/breaker.js,
 * lib/fraud.js), KHONG tu dong chan cung, chi dua vao "cho_duyet" cho admin
 * xem. Ly do CHU DONG chon khong chan cung, dung nhu da trao doi:
 *   1) Mot so trinh duyet/tien ich (Firefox che do nghiem ngat, Brave, cac
 *      tien ich chan tracking) TU XOA Referer vi ly do rieng tu cua CHINH
 *      NGUOI DUNG THAT - khong lien quan gi den gian lan.
 *   2) Ke gian du trinh do se GIA MAO duoc header Referer neu biet he thong
 *      co kiem tra cai nay - day KHONG phai lop bao ve bat kha xam pham, chi
 *      loc duoc da so nguoi dung bypass pho thong (dung tool/web bypass co
 *      san, thuong khong nghi den viec gia mao header) chu khong chan duoc
 *      ke chuyen nghiep co chu dich.
 */
/**
 * Lay "ten thuong hieu" cua 1 hostname, BO QUA duoi TLD - vd "link4m.co",
 * "link4m.net", "link4m.org", "ads.link4m.com" deu tra ve "link4m".
 *
 * VA LOI DA SUA (2026-09, "link4m nhieu mien qua, cu khac .co la chan"): ban
 * dau so sanh CA HOSTNAME ("link4m.co" phai khop y het "link4m.co"), nen cac
 * site rut gon kieu nay (thuong xoay vong nhieu TLD gia mien de ne chan quang
 * cao/DNS - link4m.co, .net, .org, .com deu la HO cung mot dich vu) bi bao
 * nham la gia mao lien tuc, admin phai duyet tay qua nhieu. Gio chi so sanh
 * PHAN TEN THUONG HIEU (nhan ke cuoi cung, truoc TLD), khong quan tam TLD la
 * gi - dung cho moi truong hop xoay vong ten mien ma khong can cau hinh them.
 *
 * Gioi han da biet: sai voi domain co TLD 2 phan nhu "abc.co.uk" (se lay
 * nham "co" lam ten thuong hieu) - khong anh huong trong thuc te vi cac site
 * rut gon kieu Viet Nam dang dung (link4m, site2s...) deu dung TLD 1 phan.
 */
function getBrand(hostname) {
  const parts = hostname.split('.');
  if (parts.length < 2) return hostname;
  return parts[parts.length - 2];
}

async function checkReferer(req, task) {
  const referer = req.headers.referer || req.headers.referrer || '';

  const provider = await db.get('SELECT api_endpoint FROM providers WHERE name=$1', [task.provider]);
  if (!provider || !provider.api_endpoint) {
    // Chua cau hinh endpoint -> khong biet domain nao la "dung" de doi
    // chieu, bo qua kiem tra (day la thieu cau hinh cua admin, khong phai
    // dau hieu gian lan cua nguoi dung).
    return { ok: true, reason: 'no-endpoint-configured' };
  }

  let expectedHost;
  try {
    expectedHost = new URL(provider.api_endpoint).hostname.toLowerCase();
  } catch {
    return { ok: true, reason: 'invalid-endpoint-format' };
  }
  const expectedBrand = getBrand(expectedHost);

  if (!referer) {
    return { ok: false, reason: 'missing-referer', expectedHost };
  }

  let refererHost;
  try {
    refererHost = new URL(referer).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: 'invalid-referer-format', expectedHost };
  }

  const matches = getBrand(refererHost) === expectedBrand;
  return matches ? { ok: true } : { ok: false, reason: 'domain-mismatch', expectedHost, refererHost };
}

module.exports = { checkReferer };
