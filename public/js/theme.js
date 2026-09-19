/* Chuyen giao dien sang / toi.
   - Lan dau vao web: theo cai dat cua thiet bi (dien thoai/may tinh dang de che do nao).
   - Khi nguoi dung bam nut ☀️/🌙: nho lua chon trong trinh duyet (localStorage, khoa "theme")
     va dung lai o moi trang, cac lan truy cap sau.
   - Doan script nho chay TRUOC khi ve trang (partials/theme-head.ejs) lo viec dat
     data-theme de trang khong bi nhay mau; file nay lo nut bam va dong bo. */
(function () {
  'use strict';
  var KEY = 'theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'light' || v === 'dark') ? v : null;
    } catch (e) { return null; }
  }
  function systemTheme() { return mq && mq.matches ? 'light' : 'dark'; }
  function current() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function refreshButtons() {
    var toLight = current() === 'dark';
    var label = toLight ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối';
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = toLight ? '☀️' : '🌙';
      btns[i].setAttribute('aria-label', label);
      btns[i].setAttribute('title', label);
    }
  }

  function paint(t) {
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#f5f3fb' : '#0d0b1e');
    refreshButtons();
  }

  function toggle() {
    var next = current() === 'light' ? 'dark' : 'light';
    root.classList.add('theme-anim');
    paint(next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    setTimeout(function () { root.classList.remove('theme-anim'); }, 350);
  }

  function init() {
    paint(saved() || systemTheme());

    // Khung Cloudflare Turnstile cung doi mau theo giao dien (chi ap dung luc trang vua tai)
    var ts = document.querySelectorAll('.cf-turnstile');
    for (var i = 0; i < ts.length; i++) {
      if (!ts[i].getAttribute('data-theme')) ts[i].setAttribute('data-theme', current());
    }

    // Trang chua co san nut (data-theme-toggle) thi tu them: vao topbar neu co, khong thi noi goc tren-phai
    if (!document.querySelector('[data-theme-toggle]')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-btn';
      b.setAttribute('data-theme-toggle', '');
      var bar = document.querySelector('.topbar');
      if (bar) { bar.appendChild(b); }
      else { b.className += ' floating'; document.body.appendChild(b); }
    }
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var j = 0; j < btns.length; j++) btns[j].addEventListener('click', toggle);
    refreshButtons();
  }

  // Chua tung chon thi tu doi theo he thong khi nguoi dung doi che do sang/toi tren may
  function onSystemChange() { if (!saved()) paint(systemTheme()); }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }
  // Dong bo giua cac tab dang mo
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) paint(saved() || systemTheme());
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
