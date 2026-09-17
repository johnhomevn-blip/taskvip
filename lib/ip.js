/**
 * Lay IP that cua nguoi dung.
 *
 * VA LOI BAO MAT (2026-09): truoc day ham nay uu tien header "cf-connecting-ip"
 * do CHINH CLIENT gui len ma khong kiem tra request co thuc su di qua Cloudflare
 * hay khong. Bat ky ai cung co the tu dat header nay thanh gia tri tuy y de:
 *   - Tao vo so tai khoan ma khong bi he thong chong da tai khoan (ip_user_map) phat hien
 *   - Vuot gioi han "X luot/IP/ngay" cho tung nhiem vu -> farm coin khong gioi han
 *
 * Mac dinh BAY GIO ham nay CHI dung req.ip (da duoc Express tinh dung nho
 * app.set('trust proxy', ...) o server.js, phan anh dung IP that cua nguoi
 * dung qua reverse proxy cua Railway/host).
 *
 * VA LOI KHAC DA PHAT HIEN (2026-09, "IP dang ky toan hien 1 IP"): khi dung
 * ca Cloudflare LAN Railway (2 lop trung gian chong len nhau), req.ip chi
 * tin 1 lop nen thuc chat tra ve IP CUA LOP TRUNG GIAN (giong nhau cho moi
 * nguoi), khong phai IP that cua tung nguoi dung nua.
 *
 * Neu ban CHAC CHAN da chan moi truy cap truc tiep vao domain goc (vi du domain
 * Railway *.up.railway.app) va CHI cho phep truy cap qua Cloudflare, ban co the
 * bat lai viec tin tuong header nay bang cach set env TRUST_CF_HEADER=1.
 * KHONG bat neu ban khong chac chan, vi day chinh la lo hong nghiem trong da
 * duoc phat hien.
 *
 * Middleware CANONICAL_HOST trong server.js (chuyen huong moi request khong
 * den tu domain chinh thuc ve dung domain do) chinh la cach "chac chan" nay -
 * dat CA HAI bien moi truong CANONICAL_HOST va TRUST_CF_HEADER=1 cung luc
 * thi header nay moi thuc su dang tin cay (vi luc do KHONG con duong nao de
 * truy cap thang vao app ma bo qua Cloudflare duoc nua).
 */
function getClientIp(req) {
  if (process.env.TRUST_CF_HEADER === '1') {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return cf;
  }
  return req.ip;
}

module.exports = { getClientIp };
