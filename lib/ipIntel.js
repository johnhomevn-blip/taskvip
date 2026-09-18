// CHONG VPN/PROXY/HOSTING/MANG DI DONG (2026-09):
//
// Nhieu nha cung cap link rut gon KHONG CHO PHEP nguoi lam nhiem vu dung
// VPN/Proxy hoac mang di dong (4G/3G) vi lam sai lech du lieu quang cao cua
// ho - dung cac mang nay de "vuot" link co the khien tai khoan nha cung cap
// cua chinh chu web bi khoa. Module nay tra cuu 1 dia chi IP xem no co phai
// la IP cua VPN/proxy/datacenter (hosting) hay mang di dong hay khong, dung
// dich vu MIEN PHI ip-api.com (khong can dang ky API key, gioi han ~45
// request/phut cho 1 dia chi server) - KET QUA duoc CACHE lai trong bang
// ip_intel_cache 24 tieng de khong goi lai lien tuc cho cung 1 IP (vua tranh
// vuot rate limit mien phi, vua nhanh hon cho nguoi dung).
//
// Nguyen tac AN TOAN KHI LOI (fail-open): neu goi API loi (mang lỗi, het
// rate limit, IP la dia chi noi bo/khong hop le...), ham TRA VE "khong phat
// hien gi ca" (isProxy=false, isMobile=false) thay vi chan nguoi dung - GIONG
// HET nguyen tac da thong nhat cho toan bo he thong chong gian lan (khong
// bao gio tu dong khoa cung dua tren du lieu khong chac chan). Neu can doi
// nha cung cap khac chinh xac hon (vd IPQualityScore, proxycheck.io co API
// key rieng), chi can sua lai ham fetchFromProvider() ben duoi, phan con lai
// (cache, settings bat/tat) khong doi.

const http = require('http');
const db = require('../db');

const CACHE_MS = 24 * 60 * 60 * 1000; // 24 tieng

function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  const v = ip.replace('::ffff:', '');
  return v === '127.0.0.1' || v === '::1' || v === 'unknown' ||
    /^10\./.test(v) || /^192\.168\./.test(v) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(v);
}

function fetchFromProvider(ip) {
  return new Promise((resolve) => {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,isp,org,mobile,proxy,hosting,query`;
    const req = http.get(url, { timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.status !== 'success') return resolve({ ok: false });
          resolve({
            ok: true,
            isProxy: !!(j.proxy || j.hosting), // ip-api gop VPN/Tor/proxy cong khai vao co "proxy"
            isHosting: !!j.hosting,
            isMobile: !!j.mobile,
            isp: j.isp || '', org: j.org || '',
          });
        } catch (e) { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
  });
}

// Tra ve { ok, isProxy, isHosting, isMobile, isp, org } cho 1 IP - uu tien
// doc tu cache (bang ip_intel_cache) neu con moi (< 24h), chi goi API that
// su khi cache thieu/het han.
async function checkIp(ip) {
  if (isPrivateOrLocalIp(ip)) return { ok: false, isProxy: false, isHosting: false, isMobile: false, isp: '', org: '' };

  const cached = await db.get('SELECT * FROM ip_intel_cache WHERE ip=$1', [ip]);
  if (cached && (Date.now() - parseInt(cached.checked_at)) < CACHE_MS) {
    return {
      ok: !!cached.ok, isProxy: !!cached.is_proxy, isHosting: !!cached.is_hosting,
      isMobile: !!cached.is_mobile, isp: cached.isp || '', org: cached.org || '',
    };
  }

  const result = await fetchFromProvider(ip);
  const row = {
    ok: result.ok ? 1 : 0,
    isProxy: result.ok ? (result.isProxy ? 1 : 0) : 0,
    isHosting: result.ok ? (result.isHosting ? 1 : 0) : 0,
    isMobile: result.ok ? (result.isMobile ? 1 : 0) : 0,
    isp: result.isp || '', org: result.org || '',
  };
  await db.run(
    `INSERT INTO ip_intel_cache (ip,is_proxy,is_hosting,is_mobile,isp,org,ok,checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (ip) DO UPDATE SET is_proxy=$2,is_hosting=$3,is_mobile=$4,isp=$5,org=$6,ok=$7,checked_at=$8`,
    [ip, row.isProxy, row.isHosting, row.isMobile, row.isp, row.org, row.ok, Date.now()]
  );
  return {
    ok: result.ok, isProxy: !!row.isProxy, isHosting: !!row.isHosting,
    isMobile: !!row.isMobile, isp: row.isp, org: row.org,
  };
}

module.exports = { checkIp, isPrivateOrLocalIp };
