"""Вырезание котов из референсов: прозрачный фон, без перерисовки."""
import numpy as np
from collections import deque
from PIL import Image

REF = '/home/user/The-first-/pixel-pet/assets/reference/'

def load(name):
    return np.array(Image.open(REF + name).convert('RGB')).astype(np.int16)

def is_beige(a):            # бежевый фон (и тень на нём) — светлый, тёплый
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 185) & (g > 160) & (b > 115) & ((r - b) > 38) & ((r - b) < 110)

def is_dark_bg(a):          # шахматка: почти чёрный нейтральный
    mx = a.max(axis=-1); mn = a.min(axis=-1)
    return (mx < 40) & ((mx - mn) < 9)

def flood_bg(img, bgfun):
    """фон = пиксели bgfun, достижимые от границ кадра"""
    m = bgfun(img); H, W = m.shape; bg = np.zeros((H, W), bool); q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if m[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if m[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not bg[yy, xx]:
                bg[yy, xx] = True; q.append((yy, xx))
    return bg

def components(mask, min_area=200):
    H, W = mask.shape; seen = np.zeros_like(mask); out = []
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not seen[yy, xx]:
                                seen[yy, xx] = True; q.append((yy, xx))
                if len(pts) >= min_area:
                    ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
                    out.append((min(xs), min(ys), max(xs), max(ys), len(pts)))
    return out
