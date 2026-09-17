const fetch = require('node-fetch');

/**
 * Xac minh Cloudflare Turnstile o phia server (bat buoc - token phia client
 * KHONG duoc tin tuong neu khong goi Siteverify API de kiem tra lai).
 *
 * Neu chua cau hinh TURNSTILE_SECRET_KEY trong .env, ham nay se BO QUA kiem
 * tra va tra ve {success:true, skipped:true} kem canh bao ra log - de moi
 * truong dev/test khong co key van chay duoc binh thuong. Tren production
 * BAT BUOC phai set bien nay, khong thi Turnstile hoan toan vo tac dung.
 */
let warned = false;
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warned) {
      console.warn('[CANH BAO BAO MAT] Chua set TURNSTILE_SECRET_KEY trong .env - Turnstile dang BI TAT (bo qua kiem tra). Dang ky/dang nhap/rut tien se KHONG duoc Turnstile bao ve.');
      warned = true;
    }
    return { success: true, skipped: true };
  }
  if (!token) {
    return { success: false, reason: 'missing-token' };
  }
  try {
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
      // 5 giay la du cho Cloudflare tra loi; tranh treo request cua nguoi
      // dung neu Cloudflare co su co tam thoi.
      timeout: 5000,
    });
    const data = await resp.json();
    if (!data.success) {
      console.warn('[TURNSTILE] Xac minh that bai:', data['error-codes'] || data);
    }
    return { success: !!data.success, raw: data };
  } catch (err) {
    // VA LOI THIET KE: neu Cloudflare tam thoi khong phan hoi (loi mang,
    // timeout...), ta CHU DONG TU CHOI (fail-closed) thay vi cho qua, vi
    // day la lop bao ve chong farm coin - tha 1 nguoi dung that bi hoi lai
    // "thu lai sau" con hon de bot loi dung luc dich vu Turnstile gian doan.
    console.error('[TURNSTILE] Loi khi goi Siteverify API:', err.message);
    return { success: false, reason: 'siteverify-error' };
  }
}

module.exports = { verifyTurnstile };
