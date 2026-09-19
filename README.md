# 4ummo — Web nhiệm vụ kiếm tiền (rút gọn link)

Web này cho phép người dùng đăng ký tài khoản, thực hiện các "nhiệm vụ" (đi qua
link rút gọn của Link4m/Uptolink...), và khi hoàn thành thật sự sẽ được cộng
tiền vào ví. Có sẵn trang quản trị để thêm nhiệm vụ và duyệt yêu cầu rút tiền.

Bạn KHÔNG cần biết code để đưa web này lên internet — làm theo từng bước dưới đây.

---

## Phần 1 — Lấy API Key từ nhà cung cấp rút gọn link

1. Vào **link4m.com** → Đăng ký tài khoản → xác thực email.
2. Vào trang quản trị của Link4m → tìm mục **"API"** → copy **API Key**.
3. (Tuỳ chọn) Làm tương tự với **uptolink.net** nếu muốn dùng thêm nhà cung cấp thứ 2.

⚠️ Lưu API Key lại cẩn thận, bước sau sẽ cần điền vào.

⚠️ **Lưu ý quan trọng:** endpoint API trong file `lib/shortener.js` được viết theo
tài liệu phổ biến nhất hiện có. Nhà cung cấp có thể đổi định dạng theo thời
gian — trước khi dùng thật, vào mục "Hướng dẫn tích hợp API" trên trang quản
trị của Link4m/Uptolink để đối chiếu, nếu khác thì báo lại để chỉnh sửa.

---

## Phần 2 — Đưa web lên internet bằng Railway (miễn phí thử, dễ nhất)

1. Vào **railway.app** → Đăng ký bằng GitHub hoặc Google.
2. Bấm **New Project** → **Empty Project**.
3. Trong project, bấm **Add Service** → **Empty Service** (hoặc kéo thả toàn bộ
   thư mục dự án này vào nếu Railway hỗ trợ "Deploy from local").
   Cách đơn giản nhất: đưa toàn bộ code này lên một repo GitHub (kéo thả file
   trên github.com nếu chưa quen git), rồi trong Railway chọn
   **Deploy from GitHub repo** → chọn repo đó.
4. Vào tab **Variables** của service, thêm các biến (copy từ file `.env.example`):
   - `SESSION_SECRET` → gõ một chuỗi bất kỳ thật dài, khó đoán
   - `HMAC_SECRET` → gõ một chuỗi khác, cũng thật dài
   - `LINK4M_API_KEY` → dán API Key lấy ở Phần 1
   - `UPTOLINK_API_KEY` → (nếu có)
   - `BASE_URL` → để tạm trống, quay lại điền sau khi có domain (bước 6)
5. Railway sẽ tự chạy `npm install` và `npm start` (đã khai báo sẵn trong
   `package.json`). Đợi vài phút để build xong.
6. Vào tab **Settings** → **Networking** → bấm **Generate Domain** để có một
   địa chỉ dạng `taskvip.up.railway.app`. Copy địa chỉ này, quay lại
   **Variables** điền vào `BASE_URL` (dạng `https://taskvip.up.railway.app`,
   không có dấu `/` ở cuối).
7. (Tuỳ chọn) Nếu đã mua domain riêng (ví dụ ở Tenten.vn, Namecheap...), vào
   **Settings → Networking → Custom Domain** để trỏ domain riêng vào, rồi
   cập nhật `BASE_URL` theo domain mới.

---

## Phần 3 — Tạo tài khoản quản trị đầu tiên

Trong Railway, mở tab **Shell** (hoặc dùng chức năng "Run command" nếu có) và chạy:

```
node create-admin.js ten_quan_tri mat_khau_cua_ban
```

Sau đó vào `https://domain-cua-ban.com/login` đăng nhập bằng tài khoản này,
bạn sẽ thấy menu **Quản trị** trên thanh trên cùng.

---

## Phần 4 — Thêm nhiệm vụ

Vào `/admin`, điền form "Thêm nhiệm vụ mới":

- **Tên nhiệm vụ**: hiển thị cho user thấy, ví dụ "Xem video giới thiệu".
- **Nhà cung cấp**: chọn link4m hoặc uptolink.
- **URL đích thật**: trang bạn muốn quảng bá/kiếm hoa hồng (đây KHÔNG phải
  link rút gọn — hệ thống sẽ tự tạo link rút gọn dẫn tới URL xác nhận của
  bạn, sau khi xác nhận xong mới có thể cân nhắc chuyển tiếp người dùng tới
  URL này nếu bạn muốn — hiện tại hệ thống dùng URL đích để lưu trữ, có thể
  mở rộng thêm bước redirect cuối nếu bạn cần).
- **Thưởng (đ)**: số tiền user nhận khi hoàn thành.
- **Giây tối thiểu**: thời gian tối thiểu hợp lý để hoàn thành (chống gian lận).
- **Lượt/ngày**: giới hạn số lần mỗi user được làm nhiệm vụ này trong 24h.

---

## Phần 5 — Rút tiền của người dùng (Momo / ngân hàng / thẻ cào)

Hiện tại hệ thống **chưa tự động chuyển tiền thật** — khi user gửi yêu cầu rút
tiền, bạn (admin) sẽ thấy yêu cầu ở `/admin`, tự chuyển khoản/nạp thẻ thủ công
bên ngoài rồi bấm **Duyệt**. Đây là cách phổ biến khi mới bắt đầu, vì tích hợp
tự động với Momo/ngân hàng cần đăng ký tài khoản doanh nghiệp với họ. Khi web
đã ổn định và có nhiều giao dịch, có thể tích hợp thêm cổng thanh toán tự
động sau.

---

## Cấu trúc thư mục (để tham khảo, không bắt buộc phải hiểu)

```
server.js         → điểm khởi động chính
db.js             → thiết lập database SQLite
routes/           → xử lý logic từng phần (đăng nhập, nhiệm vụ, ví, admin)
views/            → giao diện các trang (HTML)
lib/shortener.js  → nơi gọi API Link4m/Uptolink — sửa ở đây nếu API đổi
lib/token.js       → cơ chế chống gian lận khi xác nhận nhiệm vụ
create-admin.js   → script tạo tài khoản quản trị
```

## Nếu cần hỗ trợ tiếp

Các phần có thể mở rộng thêm sau: giới hạn theo IP để chống gian lận nâng cao,
kiểm tra Referer từ nhà cung cấp, cấp độ (Level) mở khoá nhiệm vụ, hệ thống
mời bạn bè, tích hợp cổng thanh toán tự động cho rút tiền.

---

## Phần 6 — Chống bot/farm coin (thêm 2026-09)

### 1. Cloudflare Turnstile
Gắn ở Đăng ký, Đăng nhập, Rút tiền. Cần thêm 2 biến vào `.env` (xem
`.env.example`):
```
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```
Nếu để trống, Turnstile **tự động bị tắt** (có cảnh báo trong log server) —
tiện cho dev/test, nhưng **production bắt buộc phải điền** để có tác dụng bảo vệ thật.

### 2. Honeypot
1 ô ẩn (`hp_field`) trong form đăng ký/đăng nhập/rút tiền — người thật không
thấy, bot tự động điền form thì dính. Đăng ký: trả về "thành công giả" (không
tạo tài khoản thật). Đăng nhập/rút tiền: trả về lỗi giống hệt lỗi bình thường.
Mọi lần dính đều được ghi vào **Admin > Bảo mật > Nhật ký sự kiện bảo mật**.

### 3. Cầu dao Ncoin/giờ (`lib/breaker.js`)
Nếu tổng Ncoin cộng thật trong 1 giờ gần nhất vượt ngưỡng bạn đặt (Admin >
Bảo mật), toàn bộ nhiệm vụ vượt link mới sẽ **tạm thời không cộng coin ngay**
mà chuyển vào hàng "Chờ duyệt" cho admin xem lại. Tự động resume sau 20 phút
nếu ổn định, admin cũng có thể bấm Resume ngay hoặc Tạm dừng thủ công bất cứ
lúc nào. Toàn bộ lịch sử trigger/resume được ghi lại để xem sau, kể cả khi đã
tự resume.

### 4. Cờ nghi ngờ đa tài khoản/farm (`lib/fraud.js`)
Chấm điểm dựa trên: IP/thiết bị trùng tài khoản khác, thời gian hoàn thành
nhiệm vụ đều đến bất thường (dấu hiệu script), nhiều tài khoản đăng ký cùng
IP trong thời gian ngắn. **Không tự khóa** — chỉ gắn cờ và đưa nhiệm vụ tiếp
theo của tài khoản đó vào hàng chờ duyệt, admin xem ở Admin > Bảo mật.

Lưu ý quan trọng: phần này **không phát hiện được VPN thật sự** vì không tích
hợp API kiểm tra IP trả phí (IPQualityScore/IP2Location...) — nếu cần độ
chính xác cao hơn cho riêng VPN, có thể tích hợp thêm sau, xem ghi chú trong
`lib/fraud.js`.

### 5. Hàng chờ duyệt & Lịch sử
Nhiệm vụ bị giữ lại hiện trong Admin > Bảo mật với nút Duyệt / Từ chối. Trong
mục Lịch sử của người dùng, các nhiệm vụ này hiện trạng thái "⏳ Chờ duyệt"
ngay lập tức, sau đó tự cập nhật thành "⚡ Vượt link" (nếu admin duyệt) hoặc
"❌ Từ chối" (nếu admin từ chối) — không bao giờ hiện "Hoàn thành" giả trước
khi thật sự được duyệt.

## Phần 7 — Giao diện sáng / tối (thêm 2026-09)

Web có 2 giao diện: nền tối (như cũ) và nền sáng. Người dùng tự đổi bằng nút
☀️/🌙 (trong thanh tiêu đề, hoặc góc trên bên phải ở trang đăng nhập/đăng ký).

- Lần đầu vào web: tự theo cài đặt sáng/tối của thiết bị. Sau khi bấm nút thì
  nhớ lựa chọn trong trình duyệt (khoá `theme` trong localStorage).
- Toàn bộ màu nằm ở đầu `public/css/style.css`: khối `:root` là nền tối,
  khối `:root[data-theme="light"]` là nền sáng. Muốn chỉnh màu chỉ cần sửa ở đó.
- Khi viết trang mới: dùng biến màu (`var(--text)`, `var(--gold)`, `var(--ok)`,
  `var(--bad)`, `var(--fill)`...) thay vì mã màu cứng như `#fbbf24`, để chữ luôn
  đọc được ở cả hai nền. Mỗi trang cần có dòng
  `<%- include('partials/theme-head') %>` trong `<head>`.
- Các file liên quan: `public/js/theme.js`, `views/partials/theme-head.ejs`.
