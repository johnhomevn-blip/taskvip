const db = require('../db');

// Endpoint duoc luu dang MAU (template) co the tuy chinh cho tung nha cung
// cap, vi khac nha cung cap khac nhau ve TEN THAM SO (?api= hay ?token=...)
// va CACH MA HOA URL dich (base64 hay de nguyen). Admin dien template nay o
// trang Admin > Nhà cung cấp, dung 3 placeholder:
//   {API_KEY}  -> API Key cua nha cung cap (da encodeURIComponent)
//   {URL}      -> URL dich, GIU NGUYEN dang plain text (da encodeURIComponent)
//   {URL_B64}  -> URL dich, MA HOA BASE64 truoc (da encodeURIComponent) - link4m dung kieu nay
// Vi du link4m (da xac nhan qua 1 link that su bat gap): "https://link4m.co/full/?api={API_KEY}&url={URL_B64}&type=2"
// Vi du 1 nha cung cap khac dung ten tham so va kieu ma hoa khac,
// vd bbmkts.com: "https://bbmkts.com/ql?token={API_KEY}&longurl={URL}"
const DEFAULT_ENDPOINTS = {
  // Da xac nhan bang 1 link "Quick Link" that su cua link4m.co bat gap tren mang
  link4m: 'https://link4m.co/full/?api={API_KEY}&url={URL_B64}&type=2',
  // CHUA XAC NHAN (chua tim duoc 1 vi du that su tu site2s.com de doi chieu,
  // khac voi link4m) - tam dung chung dinh dang voi link4m vi cung dong
  // "site rut gon kieu Viet Nam". Neu sai, admin vao Dashboard cua site2s.com
  // tim muc "Quick Link"/"Developer API" de lay dung mau roi dien lai o
  // trang Admin > Nhà cung cấp.
  site2s: 'https://site2s.com/full/?api={API_KEY}&url={URL_B64}&type=2',
};

/**
 * Tao link rut gon bang cach dien API Key + URL dich vao MAU (template) cua
 * nha cung cap (xem giai thich placeholder o tren). Khong can goi API rieng
 * vi day la link duoc xu ly truc tiep boi server nha cung cap (nguoi dung
 * bam vao link nay se thay quang cao/dem gio roi tu dong chuyen ve URL dich).
 */
async function createShortLink(providerName, destinationUrl) {
  const provider = await db.get('SELECT * FROM providers WHERE name=$1 AND active=1', [providerName]);

  if (!provider || !provider.api_key) {
    throw new Error(`Nhà cung cấp "${providerName}" chưa được cấu hình API Key`);
  }

  // Neu admin chua dien endpoint, hoac dien kieu CU (chi 1 duong dan goc,
  // khong co placeholder {..}) -> dung mau mac dinh cua he thong cho nha
  // cung cap do (neu co). Dieu nay giup tuong thich nguoc voi cac ban ghi
  // provider cu trong DB tu truoc khi co he thong template nay.
  let template = provider.api_endpoint;
  if (!template || !template.includes('{')) {
    template = DEFAULT_ENDPOINTS[providerName];
  }
  if (!template) {
    throw new Error(`Nhà cung cấp "${providerName}" chưa có endpoint hợp lệ. Vào Admin > Nhà cung cấp, điền link mẫu có chứa {API_KEY} và {URL} (hoặc {URL_B64}).`);
  }

  const base64Url = Buffer.from(destinationUrl, 'utf8').toString('base64');
  return template
    .replace(/\{API_KEY\}/g, encodeURIComponent(provider.api_key))
    .replace(/\{URL_B64\}/g, encodeURIComponent(base64Url))
    .replace(/\{URL\}/g, encodeURIComponent(destinationUrl));
}

module.exports = { createShortLink };
