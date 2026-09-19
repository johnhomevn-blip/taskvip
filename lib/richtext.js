// Chuyen noi dung quy dinh (luu dang text trong DB) thanh HTML de hien thi
// dang the dep. Admin chi can go text thuong theo cu phap don gian:
//
//   Dong thuong            -> doan mo dau
//   - Noi dung             -> gach dau dong
//   **chu quan trong**     -> chu do in dam
//   ⚠ **Canh bao:** ...    -> khung canh bao mau do
//
// AN TOAN: moi ky tu HTML deu bi escape TRUOC, roi moi doi **...** thanh
// <strong>. Vi vay admin (hoac ai do chen noi dung) khong the nhung the
// <script> hay HTML tuy y vao trang.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderRule(content) {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  let html = '';
  let inList = false;

  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }

    // Khung canh bao: dong bat dau bang ⚠ (hoac !!)
    const warn = line.match(/^(?:⚠️?|!!)\s*(.*)$/);
    if (warn) {
      closeList();
      const body = warn[1];
      const t = body.match(/^\*\*(.+?):?\*\*:?\s*(.*)$/);
      const title = t ? t[1] : 'Cảnh báo';
      const text = t ? t[2] : body;
      html += '<div class="rule-warn"><div class="rule-warn-title"><span aria-hidden="true">⚠</span> '
        + esc(title) + '</div>'
        + (text ? '<div class="rule-warn-text">' + inline(text) + '</div>' : '')
        + '</div>';
      continue;
    }

    // Gach dau dong: "- ..." hoac "• ..."
    const li = line.match(/^(?:-|•)\s+(.*)$/);
    if (li) {
      if (!inList) { html += '<ul class="rule-list">'; inList = true; }
      html += '<li>' + inline(li[1]) + '</li>';
      continue;
    }

    closeList();
    html += '<p class="rule-intro">' + inline(line) + '</p>';
  }
  closeList();
  return html;
}

module.exports = { renderRule };
