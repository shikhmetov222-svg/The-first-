"""Нарезка комнаты из assets/reference/room.png:
 - assets/room/items/<id>.png — каждый предмет отдельным PNG с прозрачным фоном (полный размер референса),
 - assets/room/room-empty.png — пустая комната (стены, окно, плинтус, пол) БЕЗ предметов,
 - assets/room/manifest.json — id, название, цена, координаты предмета в референсе.
Предмет выделяется по тёмному контуру (всё, что внутри контура), ковёр — по цвету."""
import json, os
from collections import deque
import numpy as np
from PIL import Image

ROOT = '/home/user/The-first-/pixel-pet/'
REF = ROOT + 'assets/reference/room.png'
OUT = ROOT + 'assets/room/'
# id: (название, цена, область x0,y0,x1,y1, способ, отступ для замазывания, слой)
ITEMS = {
 'shelf-left':  ('Полка с цветком и рамкой', 60, (112, 36, 520, 302), 'outline', 18, 2),
 'shelf-right': ('Полка с книгами и цветком', 60, (1156, 30, 1444, 272), 'outline', 18, 2),
 'frame-cat':   ('Картина «Кот»',             35, (1454, 88, 1620, 258), 'outline', 18, 2),
 'cat-tree':    ('Когтеточка с домиком',     120, (24, 312, 336, 730), 'outline', 20, 3),
 'bowl':        ('Миска с лапкой',            25, (376, 576, 544, 686), 'outline', 20, 3),
 'cat-bed':     ('Лежанка-кошка',             80, (1130, 512, 1440, 704), 'outline', 20, 3),
 'dresser':     ('Комод с растением',         90, (1446, 270, 1672, 704), 'outline', 20, 3),
 'mouse':       ('Игрушка-мышка',             15, (1408, 700, 1552, 780), 'outline', 16, 4),
 'rug':         ('Коврик с лапкой',           50, (352, 726, 1316, 904), 'color', 16, 1),
}
DARK = 130
RUG_POLY = [(450, 735), (1226, 735), (1296, 893), (358, 893)]   # углы коврика в референсе

def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r:
                out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

def flood(passable, seeds):
    H, W = passable.shape; seen = np.zeros_like(passable); q = deque()
    for (y, x) in seeds:
        if passable[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and passable[yy, xx] and not seen[yy, xx]:
                seen[yy, xx] = True; q.append((yy, xx))
    return seen

def border(H, W): return [(y, x) for y in (0, H - 1) for x in range(W)] + [(y, x) for x in (0, W - 1) for y in range(H)]

def mask_outline(sub):
    dark = sub.max(axis=-1) < DARK
    H, W = dark.shape
    reached = flood(~dilate(dark, 2), border(H, W))           # закрываем мелкие щели в контуре
    obj = ~reached
    # срезаем «кольцо» шириной до 3 px снаружи контура
    ring = flood(~dark | ~obj, [(y, x) for y in range(H) for x in range(W) if not obj[y, x]])
    # ограничиваем глубину проникновения
    cur = ~obj; depth = np.zeros_like(obj)
    for _ in range(3):
        grow = dilate(cur, 1) & ~dark & ~cur & obj
        cur = cur | grow
    obj = obj & ~(cur & ~dark)
    return fill_small_holes(obj, 40)

def erode(m, r): return ~dilate(~m, r)

def clean_thin(m, r=5):
    """убираем тонкие «хвосты» (кусочки линии плинтуса, прилипшие к контуру): открытие + возврат формы"""
    opened = dilate(erode(m, r), r)
    return m & dilate(opened, 2)

def mask_poly(shape, pts):
    from PIL import ImageDraw
    im = Image.new('L', (shape[1], shape[0]), 0); ImageDraw.Draw(im).polygon(pts, fill=255)
    return np.array(im) > 0

def mask_color(sub):
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    rug = (b > 150) & (r > 205)
    H, W = rug.shape
    reached = flood(~rug, border(H, W))
    return ~reached & True

def fill_small_holes(m, area):
    H, W = m.shape; reached = flood(m == False, border(H, W))
    return m | ~reached

def keep_comps(m, min_area):
    H, W = m.shape; seen = np.zeros_like(m); out = np.zeros_like(m)
    for y in range(H):
        for x in range(W):
            if m[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
                if len(pts) >= min_area:
                    for p in pts: out[p] = True
    return out

def largest(m):
    H, W = m.shape; seen = np.zeros_like(m); best = []
    for y in range(H):
        for x in range(W):
            if m[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
                if len(pts) > len(best): best = pts
    out = np.zeros_like(m)
    for p in best: out[p] = True
    return out

BASE_TOP, FLOOR_TOP = 616, 655          # плинтус: строки референса

def build_empty(img, mask):
    """Пустая комната: стена — гладкое заполнение, плинтус и пол — по строкам между краями дыры"""
    out = img.astype(np.float32).copy(); H, W = mask.shape
    # пол и плинтус: каждая строка — линейный переход между ближайшими незакрытыми пикселями слева и справа
    for y in range(BASE_TOP, H):
        xs = np.where(mask[y])[0]
        if len(xs) == 0: continue
        runs = np.split(xs, np.where(np.diff(xs) > 1)[0] + 1)
        for run in runs:
            a, b = run[0] - 1, run[-1] + 1
            for x in run:
                if a >= 0 and b < W and a > 70:
                    t = (x - a) / (b - a); out[y, x] = (1 - t) * out[y, a] + t * out[y, b]
                elif b < W: out[y, x] = out[y, b]
                elif a >= 0: out[y, x] = out[y, a]
    # стена: каждую дыру заполняем отдельно — сначала линейно по строкам и столбцам, затем сглаживаем
    wall = mask.copy(); wall[BASE_TOP:] = False
    seen = np.zeros_like(wall)
    for y in range(H):
        for x in range(W):
            if wall[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        yy, xx = cy + dy, cx + dx
                        if 0 <= yy < H and 0 <= xx < W and wall[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
                ys_ = [p[0] for p in pts]; xs_ = [p[1] for p in pts]
                y0, y1, x0, x1 = max(min(ys_) - 4, 0), min(max(ys_) + 5, H), max(min(xs_) - 4, 0), min(max(xs_) + 5, W)
                hole = np.zeros((y1 - y0, x1 - x0), bool)
                for (py, px) in pts: hole[py - y0, px - x0] = True
                sub = out[y0:y1, x0:x1].copy(); h, w = hole.shape
                hor = sub.copy(); ver = sub.copy()
                for r in range(h):                              # по строкам: между ближайшими известными слева и справа
                    xs2 = np.where(hole[r])[0]
                    if len(xs2) == 0: continue
                    for run in np.split(xs2, np.where(np.diff(xs2) > 1)[0] + 1):
                        l, rr = run[0] - 1, run[-1] + 1
                        for xq in run:
                            if l >= 0 and rr < w: t = (xq - l) / (rr - l); hor[r, xq] = (1 - t) * sub[r, l] + t * sub[r, rr]
                            elif l >= 0: hor[r, xq] = sub[r, l]
                            elif rr < w: hor[r, xq] = sub[r, rr]
                for c in range(w):                              # по столбцам
                    ys2 = np.where(hole[:, c])[0]
                    if len(ys2) == 0: continue
                    for run in np.split(ys2, np.where(np.diff(ys2) > 1)[0] + 1):
                        t0, bb = run[0] - 1, run[-1] + 1
                        for yq in run:
                            if t0 >= 0 and bb < h: t = (yq - t0) / (bb - t0); ver[yq, c] = (1 - t) * sub[t0, c] + t * sub[bb, c]
                            elif t0 >= 0: ver[yq, c] = sub[t0, c]
                            elif bb < h: ver[yq, c] = sub[bb, c]
                sub[hole] = (hor[hole] + ver[hole]) / 2
                for it in range(200):
                    p = np.pad(sub, ((1, 1), (1, 1), (0, 0)), mode='edge')
                    avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
                    sub[hole] = avg[hole]
                out[y0:y1, x0:x1] = sub
    return np.clip(out, 0, 255).astype(np.uint8)

def main():
    img = np.array(Image.open(REF).convert('RGB')); H, W = img.shape[:2]
    os.makedirs(OUT + 'items', exist_ok=True)
    full = np.zeros((H, W), bool); meta = {'width': W, 'height': H, 'items': {}}
    masks = {}
    for iid, (name, price, (x0, y0, x1, y1), how, pad, z) in ITEMS.items():
        x1, y1 = min(x1, W), min(y1, H)
        sub = img[y0:y1, x0:x1].astype(int)
        if how == 'color':                                  # коврик: четырёхугольник по краям (цвет почти как у пола)
            m = mask_poly(sub.shape[:2], [(x - x0, y - y0) for x, y in RUG_POLY])
        else:
            m = mask_outline(sub)
            if iid in ('cat-tree', 'bowl', 'cat-bed', 'dresser'): m = clean_thin(m, 5)
        if iid == 'cat-tree': m = keep_comps(m, 120)
        elif iid in ('bowl', 'cat-bed', 'mouse', 'dresser'): m = largest(m)
        m = fill_small_holes(m, 40)
        if iid == 'cat-tree':                               # кусочек плинтуса слева от основания — это фон комнаты
            ys0, xs0 = np.where(m); m[:, :xs0.min() + 34] &= ~(np.arange(m.shape[0])[:, None] < ys0.min() + 352)
        ys, xs = np.where(m); ty0, ty1, tx0, tx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = np.zeros((ty1 - ty0, tx1 - tx0, 4), np.uint8)
        rgba[..., :3] = img[y0:y1, x0:x1][ty0:ty1, tx0:tx1]; rgba[..., 3] = np.where(m[ty0:ty1, tx0:tx1], 255, 0)
        Image.fromarray(rgba, 'RGBA').save(OUT + 'items/' + iid + '.png')
        meta['items'][iid] = {'name': name, 'price': price, 'x': int(x0 + tx0), 'y': int(y0 + ty0), 'w': int(tx1 - tx0), 'h': int(ty1 - ty0), 'z': z, 'file': 'items/' + iid + '.png'}
        full[y0:y1, x0:x1] |= dilate(m, pad)
        masks[iid] = (x0, y0, m)
        print(iid, rgba.shape[1], 'x', rgba.shape[0])
    empty = build_empty(img, full)
    Image.fromarray(empty, 'RGB').save(OUT + 'room-empty.png')
    json.dump(meta, open(OUT + 'manifest.json', 'w'), ensure_ascii=False, indent=1)
main()
