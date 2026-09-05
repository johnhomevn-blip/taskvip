const db = require('../db');

// Endpoint mac dinh cho cac nha cung cap pho bien (kieu "Quick Link" - ghep chuoi truc tiep, khong can goi API)
const DEFAULT_ENDPOINTS = {
  link4m: 'https://link4m.co/st',
  site2s: 'https://site2s.com/st',
};

/**
 * Tao link rut gon theo kieu "Quick Link": chi can ghep dung URL theo mau
 * https://<domain>/st?api=<API_KEY>&url=<DICH>
 * Khong can goi API rieng vi day la link duoc xu ly truc tiep boi server nha cung cap
 * (nguoi dung bam vao link nay se thay quang cao/dem gio roi tu dong chuyen ve URL dich)
 */
async function createShortLink(providerName, destinationUrl) {
  const provider = await db.get('SELECT * FROM providers WHERE name=$1 AND active=1', [providerName]);

  if (!provider || !provider.api_key) {
    throw new Error(`Nhà cung cấp "${providerName}" chưa được cấu hình API Key`);
  }

  const endpoint = provider.api_endpoint || DEFAULT_ENDPOINTS[providerName];
  if (!endpoint) {
    throw new Error(`Nhà cung cấp "${providerName}" chưa có endpoint hợp lệ`);
  }

  return `${endpoint}?api=${encodeURIComponent(provider.api_key)}&url=${encodeURIComponent(destinationUrl)}`;
}

module.exports = { createShortLink };
