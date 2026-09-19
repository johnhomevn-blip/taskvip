// 8 quy dinh mac dinh cua 4ummo (ban da duoc chu web chinh sua).
// Chi duoc nap vao DB MOT LAN (xem doan "regulations_seed_v1" trong db.js).
// Sau khi nap, chu web sua/an/xoa thoai mai trong Admin > Quy dinh -
// deploy lai se KHONG nap de len hay dua quy dinh da xoa quay lai.
//
// Cu phap noi dung: xem lib/richtext.js
//   - gach dau dong, **chu do in dam**, dong bat dau bang ⚠ = khung canh bao

module.exports = [
  {
    title: 'Nghiêm cấm trùng IP / đa tài khoản',
    content: `Hệ thống **nghiêm cấm** 1 người tạo hoặc sử dụng nhiều tài khoản, hoặc nhiều người dùng chung 1 mạng để hưởng thưởng nhiều lần.
- Mỗi người chỉ được sở hữu **1 tài khoản duy nhất**.
- Các tài khoản dùng chung IP hoặc thiết bị sẽ bị **tạm giữ để kiểm tra**.
- Nếu xác nhận vi phạm, tất cả tài khoản liên quan sẽ bị **khoá vĩnh viễn**.
- Mọi lệnh rút tiền của tài khoản vi phạm **sẽ không được thanh toán**.
- Không dùng **VPN, Proxy** hoặc công cụ đổi IP để lách quy định.
⚠ **Cảnh báo:** Quy định này được hệ thống **giám sát tự động**. Hành vi vi phạm sẽ bị phát hiện và xử lý mà không cần thông báo trước.`
  },
  {
    title: 'Nghiêm cấm gian lận nhiệm vụ',
    content: `Nhiệm vụ phải được hoàn thành **thật, bằng thao tác của chính bạn**.
- Cấm dùng **tool, bot, auto-click, script** hoặc phần mềm tự động.
- Cấm **bypass link**, lấy mã bằng cách khác thay vì đi qua đầy đủ các bước.
- Cấm giả mạo nguồn truy cập hoặc dùng công cụ làm sai lệch dữ liệu.
- Nhiệm vụ nghi vấn sẽ bị **giữ duyệt hoặc không được tính thưởng**.
⚠ **Cảnh báo:** Hệ thống kiểm tra tốc độ hoàn thành, nguồn truy cập và thiết bị. Thưởng từ nhiệm vụ gian lận sẽ bị **thu hồi**.`
  },
  {
    title: 'Quy định làm nhiệm vụ & duyệt thưởng',
    content: `- Thưởng chỉ được cộng khi nhiệm vụ **được xác nhận thành công**.
- Một số nhiệm vụ **bắt buộc phải duyệt tay**; các nhiệm vụ khác cũng có thể được chuyển sang duyệt tay nếu hệ thống thấy hành động bất thường.
- Khi hệ thống phát hiện lưu lượng bất thường, việc duyệt có thể **tạm dừng ít phút** để kiểm tra, không phải lỗi.`
  },
  {
    title: 'Quy định rút tiền',
    content: `- Rút qua **Momo, ngân hàng, thẻ cào**; tối thiểu **5.000** mỗi lần.
- **Phí rút được cộng thêm** trên số tiền rút và **tuỳ theo cấp độ** của bạn (ví dụ rút 10.000 phí 2.500 thì cần đủ 12.500 xu trong ví). Bạn xem mức phí ngay trước khi xác nhận.
- Xu **Vcoin** bị **khoá 28 ngày** trước khi rút được.
- Thông tin nhận tiền phải **chính chủ, chính xác**. Nhập sai thông tin, chúng tôi **không chịu trách nhiệm hoàn lại**.
- Yêu cầu bị từ chối sẽ được **hoàn lại đúng loại xu** đã trừ.
- Thời gian xử lý tối đa **48h** (tính theo ngày làm việc).
⚠ **Cảnh báo:** Tài khoản vi phạm quy định sẽ **không được thanh toán** dù đã tạo lệnh rút.`
  },
  {
    title: 'Quy định giới thiệu bạn bè',
    content: `- Hoa hồng **bậc thang** theo tổng số người bạn từng giới thiệu: **1–50 người = 7%**, **51–100 người = 12%**, **từ 101 người = 15%**.
- Bậc hoa hồng đạt được **được giữ vĩnh viễn**.
- Cấm **tự giới thiệu chính mình**, tạo tài khoản ảo hoặc mời người trong cùng mạng/thiết bị để ăn hoa hồng.
- Hoa hồng từ tài khoản gian lận sẽ bị **thu hồi**.`
  },
  {
    title: 'Quy định mua hàng trong Shop',
    content: `- Sản phẩm giao **tự động** (nhận ngay sau khi thanh toán) hoặc **thủ công** (admin gửi, thời gian ghi trên sản phẩm).
- Mỗi đơn có **mã đơn riêng**, bạn hãy giữ lại để đối chiếu và được hỗ trợ.
- Hãy kiểm tra hàng ngay khi nhận và **liên hệ hỗ trợ sớm** nếu có vấn đề.`
  },
  {
    title: 'Bảng xếp hạng & phần thưởng',
    content: `- Có **bảng xếp hạng tuần** và **bảng xếp hạng giới thiệu tháng**; thưởng được trao **tự động** khi kết thúc chu kỳ.
- Thứ hạng đạt được bằng gian lận sẽ **bị loại và thu hồi thưởng**.`
  },
  {
    title: 'Bảo mật tài khoản & điều khoản chung',
    content: `- Bạn tự chịu trách nhiệm **giữ bí mật mật khẩu**; không chia sẻ cho ai.
- Ban quản trị có quyền **tạm khoá, kiểm tra hoặc từ chối** thanh toán với tài khoản có dấu hiệu bất thường.
- Quy định có thể **thay đổi** để phù hợp hoạt động của hệ thống; tiếp tục sử dụng nghĩa là bạn đồng ý với phiên bản mới nhất.`
  }
];
