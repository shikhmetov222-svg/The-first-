"""Недостающие кадры анимаций для рыжего кота (assets/sprites/cats/orange/*.png, 64×56).
Нарисованы не с нуля, а собраны из уже вырезанных кадров рыжего: сдвиги головы и хвоста, закрытые глаза,
«сжатие и растяжение» для прыжка. Тот же пиксель-арт, те же цвета, те же размеры и точка опоры."""
import numpy as np
from PIL import Image

D = '/home/user/The-first-/pixel-pet/assets/sprites/cats/orange/'
def load(n): return np.array(Image.open(D + n + '.png').convert('RGBA'))
def save(a, n): Image.fromarray(a.astype(np.uint8), 'RGBA').save(D + n + '.png'); print('записан', n)

def shift_box(a, box, dx, dy):
    """сдвигает часть кадра (box = x0,y0,x1,y1, не включая x1,y1) и накладывает поверх остального"""
    x0, y0, x1, y1 = box; out = a.copy(); part = a[y0:y1, x0:x1].copy()
    out[y0:y1, x0:x1] = 0
    H, W = a.shape[:2]
    for y in range(part.shape[0]):
        for x in range(part.shape[1]):
            if part[y, x, 3]:
                ny, nx = y0 + y + dy, x0 + x + dx
                if 0 <= ny < H and 0 <= nx < W: out[ny, nx] = part[y, x]
    return out

def rows_resample(a, y0, y1, delta):
    """растягивает (delta>0) или сжимает (delta<0) кадр по вертикали на delta строк, низ остаётся на месте"""
    H = a.shape[0]; rows = list(range(y0, y1 + 1)); n = len(rows)
    idx = [rows[i] for i in range(n)]
    if delta > 0:                                   # дублируем строки равномерно по внутренней части
        pos = [int(n * (k + 1) / (delta + 1)) for k in range(delta)]
        new = []
        for i, r in enumerate(rows):
            new.append(r)
            if i in pos: new.append(r)
    else:                                           # удаляем строки равномерно
        pos = [int(n * (k + 1) / (-delta + 1)) for k in range(-delta)]
        new = [r for i, r in enumerate(rows) if i not in pos]
    out = np.zeros_like(a); top = y1 + 1 - len(new)
    for j, r in enumerate(new):
        if 0 <= top + j < H: out[top + j] = a[r]
    return out

sit, hungry, sleep, sad, angry, play = (load(n) for n in ('sit', 'hungry', 'sleep', 'sad', 'angry', 'play'))
HEAD = (10, 10, 46, 34)                              # голова сидящего кота (x0, y0, x1, y1)

# idle_2: чуть выдохнул — голова на пиксель ниже
save(shift_box(sit, HEAD, 0, 1), 'idle_2')

# blink_1 / blink_2: глаза (левый x19..21, правый x32..34; y27..29) прикрыты и закрыты
def eyes(a, rows_off):
    o = a.copy()
    for ex in (19, 32):
        fur = a[31, ex + 1].copy()
        for y in rows_off:
            for x in range(ex, ex + 3): o[y, x] = fur
    return o
save(eyes(sit, [27]), 'blink_1')
save(eyes(sit, [27, 28]), 'blink_2')

# tail_1 / tail_2: хвост (x ≥ 47, y 33..50) изгибается — кончик уходит в сторону
def tail(a, k):
    o = a.copy(); y_top, y_bot = 33, 44
    for y in range(y_top, y_bot):
        dx = int(round(k * (y_bot - y) / (y_bot - y_top)))
        if dx == 0: continue
        row = a[y, 47:].copy(); o[y, 47:] = 0
        for x in range(row.shape[0]):
            if row[x, 3]:
                nx = 47 + x + dx
                if 0 <= nx < 64: o[y, nx] = row[x]
    return o
save(tail(sit, 1), 'tail_1'); save(tail(sit, -1), 'tail_2')

# eat_1…4: кивает головой вниз и влево, к миске (кадр hungry — кот рядом с миской)
HH = (10, 10, 46, 34)
for i, (dx, dy) in enumerate([(-1, 2), (-2, 4), (-1, 3), (0, 1)], 1):
    save(shift_box(hungry, HH, dx, dy), 'eat_%d' % i)

# sleep_2: вдох — верхняя часть «буханки» на пиксель выше
o = sleep.copy()
for y in range(22, 38): o[y] = sleep[y + 1]
o[38] = sleep[38]
save(o, 'sleep_2')

# play_1…3: прыжок — растяжение при подъёме, лёгкое растяжение в верхней точке, сжатие при приземлении
save(rows_resample(play, 11, 53, 3), 'play_1')
save(rows_resample(play, 11, 53, 1), 'play_2')
save(rows_resample(play, 11, 53, -2), 'play_3')

# sad_2: голова ниже на 2 пикселя
save(shift_box(sad, HEAD, 0, 2), 'sad_2')

# angry_2: тряска — голова на пиксель левее и ниже
save(shift_box(angry, (10, 10, 44, 34), -1, 1), 'angry_2')
