// Комната: пустой фон из референса + купленные предметы, которые игрок поставил.
(function () {
  const D = window.GameData, S = window.Sprites;
  const Room = {
    W: D.w, H: D.h,
    draw(ctx, data) {
      ctx.drawImage(S.room(), 0, 0);
      const ids = data.placed.slice().sort(function (a, b) { return D.items[a].z - D.items[b].z; });
      ids.forEach(function (id) {
        const im = S.item(id), it = D.items[id];
        if (im) ctx.drawImage(im, it.x, it.y);
      });
    }
  };
  window.Room = Room;
})();
