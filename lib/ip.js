/**
 * Lay IP that cua nguoi dung, uu tien header CF-Connecting-IP (Cloudflare luon dien dung IP that)
 * Neu truy cap truc tiep khong qua Cloudflare (vi du domain rieng cua Railway) thi fallback ve req.ip
 */
function getClientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip;
}

module.exports = { getClientIp };
