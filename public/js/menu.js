function toggleMenu() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  const main = document.getElementById('main');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sb.classList.toggle('open');
    ov.classList.toggle('show');
  } else {
    sb.classList.toggle('collapsed');
    if (main) main.classList.toggle('expanded');
  }
}
// Dong menu khi click link tren mobile
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('show');
      }
    });
  });
});
