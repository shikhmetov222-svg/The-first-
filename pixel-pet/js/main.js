(function () {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Telegram: готовность, полный экран, цвета темы (если есть)
  try {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready(); tg.expand();
      const p = tg.themeParams || {}, s = document.documentElement.style;
      if (p.bg_color) s.setProperty('--bg', p.bg_color);
      if (p.text_color) s.setProperty('--text', p.text_color);
      if (p.hint_color) s.setProperty('--hint', p.hint_color);
    }
  } catch (e) {}

  // Целочисленный масштаб, чтобы пиксели были чёткими
  function fit() {
    const k = Math.max(1, Math.floor(Math.min((innerWidth - 30) / 160, (innerHeight - 120) / 120)));
    canvas.style.width = 160 * k + 'px'; canvas.style.height = 120 * k + 'px';
  }
  addEventListener('resize', fit); fit();

  function frame(t) {
    Room.draw(ctx, t);
    Pet.draw(ctx, t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
