"""Нарезка котов из assets/reference/ в assets/sprites/cats/<окрас>/<поза>.png
Фон прозрачный, тень на полу убрана, кадры одного размера. Ничего не перерисовывается:
каждый пиксель берётся из референса (с уменьшением до размера «пиксель-арт»)."""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from PIL import Image
from cutlib import *

OUT = '/home/user/The-first-/pixel-pet/assets/sprites/cats/'
SIT, SLP, HNG, CRY = 'cats-sitting.jpg', 'cats-sleeping.jpg', 'cats-hungry-sick-angry.jpg', 'cats-crying.jpg'
# source-px на 1 px спрайта: у каждого листа свой масштаб, чтобы коты были одного размера
K = {SIT: 6.0, SLP: 3.45, HNG: 3.45, CRY: 3.05}
FN = {SIT: is_beige, CRY: is_beige, SLP: is_dark_bg, HNG: is_dark_bg}
# окрас -> поза -> (лист, область x0,y0,x1,y1). Области не пересекаются с соседними котами и подписями.
FRAMES = {
 'orange': {'sit':    (SIT, (366, 405, 662, 728)),
            'sleep':  (SLP, (8, 268, 190, 460)),
            'hungry': (HNG, (0, 282, 182, 462)),
            'angry':  (HNG, (362, 282, 505, 464))},
 'calico': {'sit':    (SIT, (358, 45, 664, 386)),
            'sleep':  (SLP, (8, 20, 190, 212)),
            'hungry': (HNG, (0, 34, 182, 214)),
            'angry':  (HNG, (355, 30, 500, 214))},
 'gray':   {'sit':    (SIT, (686, 742, 982, 1042)),
            'sleep':  (CRY, (284, 340, 408, 506)),
            'sad':    (CRY, (154, 348, 284, 506)),
            'sad2':   (CRY, (15, 310, 170, 508), (90, 430))},
 'tuxedo': {'sit':    (SIT, (690, 403, 984, 730)),
            'sleep':  (CRY, (282, 86, 410, 252)),
            'sad':    (CRY, (154, 95, 284, 252)),
            'sad2':   (CRY, (15, 60, 170, 252), (90, 150))},
}
MIN_AREA = {('gray', 'sad'): 900, ('tuxedo', 'sad'): 900, ('tuxedo', 'sleep'): 400, ('gray', 'sit'): 600}      # убрать обрывок хвоста соседнего кота
_cache = {}
def source(name):
    if name not in _cache:
        img = load(name); _cache[name] = (img, flood_bg(img, FN[name]))
    return _cache[name]

def cut_shadow(img, fg, x0, y0, x1, y1):
    """убираем пятно тени под лапами: всё ниже нижней тёмной линии контура"""
    sub = img[y0:y1, x0:x1]; m = fg[y0:y1, x0:x1].copy(); H, W = m.shape
    mx = sub.max(axis=-1)
    ink = (mx < 100) & (mx >= 38) & ((sub[..., 0] - sub[..., 2]) >= 12) & m   # тёмно-коричневый контур (без чёрной каймы тени)
    low = np.full(W, -1)
    for x in range(W):
        ys = np.where(ink[:, x])[0]
        if len(ys): low[x] = ys.max()
    have = low[low >= 0]
    if len(have) == 0: return m
    yb = int(np.percentile(have, 85))                    # линия пола под лапами
    for x in range(W):
        cut = low[x] + 2 if low[x] >= 0 and low[x] >= yb - 25 else yb + 2
        # у столбцов без контура внизу ничего ниже линии пола
        if low[x] < 0 or low[x] < yb - 25: m[cut:, x] = False
        else: m[low[x] + 2:, x] = False
    return m

def cut_shadow_dark(img, m, x0, y0, x1, y1):
    """на тёмных листах тень — серо-бежевое пятно с тёмной каймой под лапами: срезаем от её верха вниз"""
    sub = img[y0:y1, x0:x1].astype(int); out = m.copy(); H, W = m.shape
    L = 0.3 * sub[..., 0] + 0.59 * sub[..., 1] + 0.11 * sub[..., 2]
    rb = sub[..., 0] - sub[..., 2]
    tan = (L > 115) & (L < 182) & (rb > 22) & (rb < 64) & m
    ys_all = np.where(m.any(axis=1))[0]; bottom_zone = ys_all.max() - int(0.16 * (ys_all.max() - ys_all.min()))
    for x in range(W):
        rows = [y for y in np.where(tan[:, x])[0] if y >= bottom_zone]
        if not rows: continue
        run_end = rows[-1]; start = run_end
        for y in reversed(rows[:-1]):
            if start - y <= 2: start = y
            else: break
        if run_end - start >= 4: out[start:, x] = False
    return out

def keep_big(m, min_area):
    comps = components(m, min_area)
    out = np.zeros_like(m)
    for (xa, ya, xb, yb, a) in comps:
        pass
    # перекрашиваем: оставляем только крупные связные куски
    from collections import deque
    H, W = m.shape; seen = np.zeros_like(m)
    for y in range(H):
        for x in range(W):
            if m[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]:
                                seen[yy, xx] = True; q.append((yy, xx))
                if len(pts) >= min_area:
                    for p in pts: out[p] = True
    return out

def only_with(m, sx, sy):
    """оставить только связную часть, в которой лежит точка (sx, sy)"""
    from collections import deque
    H, W = m.shape; out = np.zeros_like(m)
    if not m[sy, sx]:                                    # ближайший пиксель кота
        ys, xs = np.where(m); i = np.argmin((ys - sy) ** 2 + (xs - sx) ** 2); sy, sx = ys[i], xs[i]
    q = deque([(sy, sx)]); out[sy, sx] = True
    while q:
        y, x = q.popleft()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not out[yy, xx]: out[yy, xx] = True; q.append((yy, xx))
    return out

def downsample(rgb, mask, k):
    """уменьшение в k раз: цвет — среднее по пикселям кота, прозрачность — по покрытию ≥ 50 %"""
    H, W = mask.shape; nw, nh = max(1, round(W / k)), max(1, round(H / k))
    m = mask.astype(np.float32)
    chans = []
    for c in range(3):
        a = Image.fromarray((rgb[..., c] * m).astype(np.float32), mode='F').resize((nw, nh), Image.BOX)
        chans.append(np.array(a))
    cov = np.array(Image.fromarray(m, mode='F').resize((nw, nh), Image.BOX))
    out = np.zeros((nh, nw, 4), np.uint8)
    ok = cov >= 0.5
    for c in range(3):
        out[..., c] = np.where(ok, np.clip(chans[c] / np.maximum(cov, 1e-6), 0, 255), 0).astype(np.uint8)
    out[..., 3] = np.where(ok, 255, 0).astype(np.uint8)
    return out

def tight(a):
    # убираем одиночные «потерянные» пиксели
    al = a[..., 3] > 0; p = np.pad(al, 1); nb = sum(np.roll(np.roll(p, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0))[1:-1, 1:-1]
    a = a.copy(); a[al & (nb < 2)] = 0
    ys, xs = np.where(a[..., 3] > 0)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def main():
    sprites = {}
    for col, poses in FRAMES.items():
        for pose, spec in poses.items():
            src, (x0, y0, x1, y1) = spec[0], spec[1]; seed = spec[2] if len(spec) > 2 else None
            img, bg = source(src)
            fg = ~bg
            m = cut_shadow(img, fg, x0, y0, x1, y1)
            if src in (SLP, HNG): m = cut_shadow_dark(img, m, x0, y0, x1, y1)
            m = keep_big(m, MIN_AREA.get((col, pose), 60))
            if seed: m = only_with(m, seed[0] - x0, seed[1] - y0)
            ys, xs = np.where(m)
            cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            rgb = img[y0:y1, x0:x1][cy0:cy1, cx0:cx1].astype(np.float32)
            sprites[(col, pose)] = tight(downsample(rgb, m[cy0:cy1, cx0:cx1], K[src]))
            print(col, pose, sprites[(col, pose)].shape[1], 'x', sprites[(col, pose)].shape[0])
    FW = max(s.shape[1] for s in sprites.values()) + 4
    FH = max(s.shape[0] for s in sprites.values()) + 4
    FW += FW % 2; FH += FH % 2
    meta = {'frame_w': FW, 'frame_h': FH, 'poses': ['sit', 'sleep', 'hungry', 'sad', 'sad2', 'angry'], 'colorways': {}}
    os.makedirs(OUT, exist_ok=True)
    for col, poses in FRAMES.items():
        d = OUT + col + '/'; os.makedirs(d, exist_ok=True)
        sheet = Image.new('RGBA', (FW * len(meta['poses']), FH), (0, 0, 0, 0))
        meta['colorways'][col] = {}
        for i, pose in enumerate(meta['poses']):
            if pose not in poses:
                meta['colorways'][col][pose] = None; continue
            s = sprites[(col, pose)]; h, w = s.shape[:2]
            ox, oy = (FW - w) // 2, FH - 2 - h               # лапы на одной линии, по центру
            frame = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
            frame.paste(Image.fromarray(s, 'RGBA'), (ox, oy))
            frame.save(d + pose + '.png'); sheet.paste(frame, (i * FW, 0))
            meta['colorways'][col][pose] = {'file': col + '/' + pose + '.png', 'x': i * FW, 'w': w, 'h': h}
        sheet.save(d + 'sheet.png')
    json.dump(meta, open(OUT + 'manifest.json', 'w'), ensure_ascii=False, indent=1)
    print('frame', FW, 'x', FH)
main()
