/**
 * Lay IP that cua nguoi dung.
 *
 * VA LOI BAO MAT (2026-09): truoc day ham nay uu tien header "cf-connecting-ip"
 * do CHINH CLIENT gui len ma khong kiem tra request co thuc su di qua Cloudflare
 * hay khong. Bat ky ai cung co the tu dat header nay thanh gia tri tuy y.
 *
 * VA LOI NGHIEM TRONG KHAC MOI PHAT HIEN (2026-09, sau khi chu web bao "IP
 * hien sai, hien 1 IP nuoc ngoai la la"): ban dau tuong middleware
 * CANONICAL_HOST (kiem tra header "Host" cua request co dung ten mien chinh
 * thuc khong) la du de dam bao request THAT SU di qua Cloudflare truoc khi
 * tin header CF-Connecting-IP. NHUNG THUC RA KHONG DU - header "Host" la do
 * CHINH CLIENT tu khai bao trong request, HOAN TOAN co the gia mao duoc:
 * ai do dung curl/Postman goi THANG toi domain goc tren Railway
 * (*.up.railway.app, khong qua Cloudflare) nhung TU DAT header
 * "Host: 4ummo.com" (hoac dung domain that ban dat trong CANONICAL_HOST) va
 * "CF-Connecting-IP: <bat ky IP gia nao ho muon>" - middleware CANONICAL_HOST
 * se thay Host khop, cho qua, roi ham nay tin luon IP gia mao do. Day RAT co
 * the la ly do ban van thay 1 IP la (vd 79.127.217.66) khong phai IP that
 * cua ban du da bat TRUST_CF_HEADER + CANONICAL_HOST.
 *
 * FIX THAT SU (khong con "coi nhu du" nua): CHI tin header CF-Connecting-IP
 * khi CF_ORIGIN_SECRET DA duoc cau hinh VA request nay DA duoc middleware
 * rieng trong server.js xac nhan mang dung "X-Origin-Secret" (header BI MAT
 * chi Cloudflare Transform Rule moi chen duoc, KHONG the gia mao vi Cloudflare
 * luon GHI DE bat ky gia tri client tu gui truoc do). Neu CF_ORIGIN_SECRET
 * CHUA duoc cau hinh, ham nay se KHONG tin CF-Connecting-IP nua (du
 * TRUST_CF_HEADER=1) - tu dong quay ve req.ip va IN CANH BAO ra log server
 * moi lan khoi dong, thay vi am tham tra ve du lieu co the bi gia mao.
 *
 * Cach bat BAO VE THAT SU (bat buoc phai lam CA 3 buoc, thieu 1 la khong an
 * toan) - xem huong dan chi tiet + nut tu sinh chuoi bi mat trong trang
 * Admin > tab Bảo mật > khối "🔎 Chẩn đoán IP that cua server":
 *   1) Cloudflare Dashboard > ten mien > Rules > Transform Rules > tao rule
 *      "Modify Request Header" > Set static > ten "X-Origin-Secret", gia tri
 *      la 1 chuoi ngau nhien dai (tu sinh), ap dung cho MOI request.
 *   2) Dat CUNG chuoi do vao bien moi truong CF_ORIGIN_SECRET tren Railway.
 *   3) Dat TRUST_CF_HEADER=1 tren Railway.
 * (CANONICAL_HOST van nen bat kem theo de tu dong chuyen huong truy cap
 * nham domain goc Railway ve dung domain, nhung KHONG con la lop bao ve
 * chinh nua - chi la tien ich UX.)
 */
function getClientIp(req) {
  if (process.env.TRUST_CF_HEADER === '1' && process.env.CF_ORIGIN_SECRET) {
    // Chi toi day duoc la vi middleware trong server.js da tu choi (403) tu
    // truoc moi request KHONG mang dung X-Origin-Secret roi - nen cf-connecting-ip
    // luc nay CHAC CHAN la do Cloudflare gan, khong phai client tu dat.
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return cf;
  }
  return req.ip;
}

module.exports = { getClientIp };
