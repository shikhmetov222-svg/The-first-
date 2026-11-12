// Питомец. Шаг 1: только внешний вид и анимации (потребности — на шаге 2).
(function () {
  const Pet = {
    type: 'cat', name: 'Мурзик',
    x: 59, y: 63, // левый верхний угол спрайта 44×46; лапы на y+41
    // Анимационные параметры по времени (мс)
    anim(t) {
      return {
        breath: Math.floor(t / 1200) % 2 === 1,          // покачивание на 1 пиксель
        blink: (t % 3600) > 3400,                        // моргание раз в ~3.6 с
        tail: Math.round(Math.sin(t / 450) * 2)          // хвост: -2…2 пикселя
      };
    },
    draw(ctx, t) {
      const a = this.anim(t);
      window.Sprites.shadow(ctx, this.x + 22, this.y + 41, 14, 3.5);
      ctx.drawImage(window.Sprites.cat(a), this.x, this.y);
    }
  };
  window.Pet = Pet;
})();
