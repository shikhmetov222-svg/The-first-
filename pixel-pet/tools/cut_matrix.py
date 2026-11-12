"""Нарезка котов из assets/reference/cats-matrix.png (9 окрасов × 9 состояний, PNG с прозрачным фоном).
Ничего не перерисовывается: берутся пиксели референса, уменьшенные в K раз; тень на полу не берётся
(она полупрозрачная). Кадры одного размера, кот в каждой клетке стоит на одном месте."""
import json, os
from collections import deque
import numpy as np
from PIL import Image

ROOT = '/home/user/The-first-/pixel-pet/'
SRC = ROOT + 'assets/reference/cats-matrix.png'
OUT = ROOT + 'assets/sprites/cats/'
K = 2.5                                   # пикселей референса на 1 пиксель спрайта
FW, FH = 64, 56                           # размер кадра
COLORS = ['orange', 'calico', 'gray', 'tuxedo', 'siamese', 'white', 'black', 'beige', 'cream']
POSES = ['sit', 'happy', 'sad', 'sleep', 'hungry', 'sick', 'angry', 'play', 'groom']   # Idle…Grooming
# границы клеток: между соседними кошками (по пустым промежуткам в референсе)
XB = [146, 286, 438, 586, 741, 895, 1047, 1201, 1368, 1525]
YB = [60, 180, 303, 421, 545, 667, 776, 865, 944, 1024]

def main():
    a = np.array(Image.open(SRC).convert('RGBA'))
    rgb = a[..., :3].astype(np.float32)
    fg = a[..., 3] >= 200
    H, W = fg.shape
    # убираем мелкую пыль (связные куски < 20 пикселей)
    seen = np.zeros_like(fg)
    for y in range(H):
        for x in range(W):
            if fg[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = [(y, x)]
                while q:
                    cy, cx = q.popleft()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and fg[yy, xx] and not seen[yy, xx]:
                                seen[yy, xx] = True; q.append((yy, xx)); pts.append((yy, xx))
                if len(pts) < 20:
                    for p in pts: fg[p] = False
    # полупрозрачные значки (Zzz, знак злости, искорка): отдельные куски с прозрачностью ≥ 110,
    # не касающиеся кота и висящие высоко над полом (тень внизу сюда не попадает)
    low = (a[..., 3] >= 110) & ~fg; low[:60, :] = False; low[:, :146] = False
    lab = np.zeros((H, W), np.int32); n = 0; extra = np.zeros_like(fg)
    solid_near = np.zeros_like(fg)
    for dy in range(-2, 3):
        for dx in range(-2, 3): solid_near |= np.roll(np.roll(fg, dy, 0), dx, 1)
    floors = {}
    for r in range(len(COLORS)):
        ys_ = np.where(fg[YB[r]:YB[r + 1], XB[0]:XB[-1]].any(axis=1))[0]; floors[r] = YB[r] + ys_.max() + 1
    for y in range(H):
        for x in range(W):
            if low[y, x] and lab[y, x] == 0:
                n += 1; q = deque([(y, x)]); lab[y, x] = n; pts = [(y, x)]
                while q:
                    cy, cx = q.popleft()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and low[yy, xx] and lab[yy, xx] == 0:
                                lab[yy, xx] = n; q.append((yy, xx)); pts.append((yy, xx))
                ys_ = [p[0] for p in pts]; cyc = (min(ys_) + max(ys_)) // 2
                row = next((i for i in range(len(COLORS)) if YB[i] <= cyc < YB[i + 1]), None)
                if row is None or len(pts) < 12 or max(ys_) > floors[row] - 24: continue     # мусор или тень на полу
                if any(solid_near[p] for p in pts): continue                                   # ореол вокруг кота
                for p in pts: extra[p] = True
    fg |= extra
    # тень на полу: под нижней линией контура лап ничего не берём
    ink = (a[..., :3].max(axis=-1) < 105) & fg
    for r in range(len(COLORS)):
        fl = floors[r]
        for x in range(XB[0], XB[-1]):
            ys_ = np.where(ink[max(YB[r], fl - 30):fl + 1, x])[0]
            cut = (max(YB[r], fl - 30) + ys_.max() + 1) if len(ys_) else fl - 10
            fg[cut:min(YB[r + 1], fl + 4), x] = False
    os.makedirs(OUT, exist_ok=True)
    meta = {'frame_w': FW, 'frame_h': FH, 'k': K, 'poses': POSES, 'colorways': {}, 'cells': {}}
    for r, col in enumerate(COLORS):
        ya, yb = YB[r], YB[r + 1]
        ys = np.where(fg[ya:yb, XB[0]:XB[-1]].any(axis=1))[0]
        floor = ya + ys.max() + 1                           # линия пола строки
        sheet = Image.new('RGBA', (FW * len(POSES), FH), (0, 0, 0, 0)); meta['colorways'][col] = {}
        for c, pose in enumerate(POSES):
            xa, xb = XB[c], XB[c + 1]; anchor = (xa + xb) / 2
            x0 = int(round(anchor - FW * K / 2)); x1 = int(round(anchor + FW * K / 2))
            y1 = int(round(floor + 2 * K)); y0 = int(round(y1 - FH * K))
            m = np.zeros((y1 - y0, x1 - x0), bool)          # только кот этой клетки
            ay, by, ax, bx = max(ya, y0), min(yb, y1), max(xa, x0), min(xb, x1)
            m[ay - y0:by - y0, ax - x0:bx - x0] = fg[ay:by, ax:bx]
            win = np.zeros((y1 - y0, x1 - x0, 3), np.float32)
            sy0, sx0 = max(0, y0), max(0, x0); win[sy0 - y0:, sx0 - x0:][:H - sy0, :W - sx0] = rgb[sy0:y1, sx0:x1][:y1 - sy0, :x1 - sx0]
            mf = m.astype(np.float32); out = np.zeros((FH, FW, 4), np.uint8)
            cov = np.array(Image.fromarray(mf, mode='F').resize((FW, FH), Image.BOX))
            ok = cov >= 0.5
            for ch in range(3):
                v = np.array(Image.fromarray(win[..., ch] * mf, mode='F').resize((FW, FH), Image.BOX))
                out[..., ch] = np.where(ok, np.clip(v / np.maximum(cov, 1e-6), 0, 255), 0).astype(np.uint8)
            out[..., 3] = np.where(ok, 255, 0)
            # одиночные пиксели
            al = out[..., 3] > 0; p = np.pad(al, 1)
            nb = sum(np.roll(np.roll(p, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0))[1:-1, 1:-1]
            out[al & (nb < 2)] = 0
            img = Image.fromarray(out, 'RGBA'); os.makedirs(OUT + col, exist_ok=True)
            img.save(OUT + col + '/' + pose + '.png'); sheet.paste(img, (c * FW, 0))
            meta['colorways'][col][pose] = col + '/' + pose + '.png'
            meta['cells'][col + '/' + pose] = [x0, y0, x1, y1]       # откуда взят кадр в референсе
        sheet.save(OUT + col + '/sheet.png'); print(col, 'пол', floor)
    json.dump(meta, open(OUT + 'manifest.json', 'w'), ensure_ascii=False, indent=1)
main()
