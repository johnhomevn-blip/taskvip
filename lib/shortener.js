const fetch = require('node-fetch');

/**
 * Goi API cua nha cung cap de tao link rut gon tro toi `destinationUrl`.
 *
 * QUAN TRONG: moi nha cung cap co dinh dang API khac nhau va co the thay doi
 * theo thoi gian. Truoc khi dung that, vao trang quan tri cua Link4m/Uptolink,
 * muc "API" / "Huong dan tich hop" de lay dung endpoint + tham so hien tai,
 * roi sua lai ham tuong ung ben duoi cho khop.
 */
async function createShortLink(provider, destinationUrl) {
  if (provider === 'link4m') {
    const apiKey = process.env.LINK4M_API_KEY;
    if (!apiKey) throw new Error('Chua cau hinh LINK4M_API_KEY trong file .env');
    const endpoint = `https://link4m.co/api?api=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(destinationUrl)}`;
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.status !== 'success') throw new Error('Link4m tra ve loi: ' + JSON.stringify(data));
    return data.shortenedUrl;
  }

  if (provider === 'uptolink') {
    const apiKey = process.env.UPTOLINK_API_KEY;
    if (!apiKey) throw new Error('Chua cau hinh UPTOLINK_API_KEY trong file .env');
    const endpoint = `https://uptolink.net/api?api=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(destinationUrl)}`;
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.status !== 'success') throw new Error('Uptolink tra ve loi: ' + JSON.stringify(data));
    return data.shortenedUrl;
  }

  throw new Error('Nha cung cap khong duoc ho tro: ' + provider);
}

module.exports = { createShortLink };
