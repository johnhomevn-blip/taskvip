// Che ten hien thi tren cac bang xep hang cong khai, tranh lo username that.
// QUY TAC (theo yeu cau chu web): luon giu DUNG 1 ky tu dau tien, phan con
// lai CHE HET bang DUNG 4 dau * co dinh - bat ke ten dai hay ngan (khac voi
// ban truoc do che nhieu/it dau * tuy theo do dai ten).
// Vi du: "nguyenvana" (10 ky tu) -> "n****"
//        "p" + 19 ky tu bat ky   -> "p****"
//        "vana" (4 ky tu)        -> "v****"
//        "ab" (2 ky tu)          -> "a****"
//        "a" (1 ky tu)           -> "a" (chi co 1 ky tu, khong con gi de che)
function maskUsername(name) {
  const s = String(name || '');
  if (s.length <= 1) return s; // qua ngan, khong con ky tu nao de che
  return s[0] + '****';
}

module.exports = { maskUsername };
