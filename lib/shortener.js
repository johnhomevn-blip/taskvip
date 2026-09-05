const fetch = require('node-fetch');
const db = require('../db');

async function createShortLink(providerName, destinationUrl) {
  const provider = await db.get('SELECT * FROM providers WHERE name=$1 AND active=1', [providerName]);

  if (!provider || !provider.api_key) {
    throw new Error(`Nhà cung cấp "${providerName}" chưa được cấu hình API Key`);
  }

  if (providerName === 'link4m') {
    const res = await fetch(`https://link4m.co/api?api=${encodeURIComponent(provider.api_key)}&url=${encodeURIComponent(destinationUrl)}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error('Link4m lỗi: ' + JSON.stringify(data));
    return data.shortenedUrl;
  }

  if (providerName === 'site2s') {
    const res = await fetch(`https://site2s.com/api?api=${encodeURIComponent(provider.api_key)}&url=${encodeURIComponent(destinationUrl)}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error('Site2s lỗi: ' + JSON.stringify(data));
    return data.shortenedUrl;
  }

  // Generic fallback cho cac nha cung cap khac
  const endpoint = provider.api_endpoint;
  const res = await fetch(`${endpoint}?api=${encodeURIComponent(provider.api_key)}&url=${encodeURIComponent(destinationUrl)}`);
  const data = await res.json();
  if (data.status !== 'success') throw new Error(`${providerName} lỗi: ` + JSON.stringify(data));
  return data.shortenedUrl;
}

module.exports = { createShortLink };
