"""Готовит ресурсы для игры из референсов: assets/game/
 - room.png        пустая комната 384×216 (уменьшение референса в 4.354 раза)
 - items/<id>.png  предметы в том же масштабе и с тем же выравниванием
 - cats/<окрас>.png спрайтлист кота (9 кадров 64×56 в ряд) — копия из assets/sprites/cats
 - data.js         размеры, координаты, цены (window.GameData)"""
import base64, io, json, os, shutil
from collections import deque
import numpy as np
from PIL import Image

ROOT = '/home/user/The-first-/pixel-pet/'
GW, GH = 384, 216
OUT = ROOT + 'assets/game/'
M = json.load(open(ROOT + 'assets/room/manifest.json'))
C = json.load(open(ROOT + 'assets/sprites/cats/manifest.json'))
os.makedirs(OUT + 'items', exist_ok=True); os.makedirs(OUT + 'cats', exist_ok=True)

room = Image.open(ROOT + 'assets/room/room-empty.png').convert('RGB').resize((GW, GH), Image.BOX)
room.save(OUT + 'room.png')

items = {}
for iid, it in sorted(M['items'].items(), key=lambda kv: kv[1]['z']):
    src = Image.open(ROOT + 'assets/room/' + it['file']).convert('RGBA')
    layer = Image.new('RGBA', (M['width'], M['height']), (0, 0, 0, 0)); layer.paste(src, (it['x'], it['y']))
    a = np.array(layer).astype(np.float32); al = (a[..., 3] > 0).astype(np.float32)
    cov = np.array(Image.fromarray(al, mode='F').resize((GW, GH), Image.BOX))
    ok = cov >= 0.5
    out = np.zeros((GH, GW, 4), np.uint8)
    for c in range(3):
        v = np.array(Image.fromarray(a[..., c] * al, mode='F').resize((GW, GH), Image.BOX))
        out[..., c] = np.where(ok, np.clip(v / np.maximum(cov, 1e-6), 0, 255), 0)
    out[..., 3] = np.where(ok, 255, 0)
    ys, xs = np.where(ok); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    Image.fromarray(out[y0:y1, x0:x1], 'RGBA').save(OUT + 'items/' + iid + '.png')
    items[iid] = {'name': it['name'], 'price': it['price'], 'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0), 'z': it['z']}

coats = {}
NAMES = {'orange': 'Рыжий', 'calico': 'Трёхцветный', 'gray': 'Серый полосатый', 'tuxedo': 'Чёрно-белый', 'siamese': 'Пятнистый (сиамский)',
         'white': 'Белый', 'black': 'Чёрный', 'beige': 'Бежевый', 'cream': 'Кремовый'}
# дополнительные кадры анимаций: кладёшь PNG 64×56 в assets/sprites/cats/<окрас>/<имя>.png и запускаешь этот скрипт
EXTRA_NAMES = ['idle_2', 'blink_1', 'blink_2', 'tail_1', 'tail_2', 'eat_1', 'eat_2', 'eat_3', 'eat_4',
               'sleep_2', 'play_1', 'play_2', 'play_3', 'sad_2', 'angry_2']
FW, FH = C['frame_w'], C['frame_h']

def comps(al):
    H, W = al.shape; seen = np.zeros_like(al); out = []
    for y in range(H):
        for x in range(W):
            if al[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and al[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
                out.append(pts)
    return sorted(out, key=len, reverse=True)

def is_red(p): return p[0] > 150 and p[1] < 130 and p[2] < 130 and p[0] - p[1] > 55
def is_dark(p): return p[0] < 100 and p[1] < 80 and p[2] < 80

def strip(frame, kind):
    """Вынимает из кадра отдельные значки (сердечко, знак злости, Zzz): возвращает (кадр без значков, список деталей)."""
    a = frame.copy(); parts = []
    if kind is None: return a, parts
    cs = comps(a[..., 3] > 0)[1:]                                   # всё, кроме тела
    pick = [c for c in cs if (is_red if kind in ('heart', 'mark') else is_dark)(a[c[0][0], c[0][1], :3].astype(int))]
    groups = [pick] if kind in ('heart', 'mark') else [[c] for c in pick]
    for g in groups:
        if not g: continue
        pts = [p for c in g for p in c]; ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
        y0, y1, x0, x1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
        part = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
        for (y, x) in pts: part[y - y0, x - x0] = a[y, x]; a[y, x] = 0
        buf = io.BytesIO(); Image.fromarray(part, 'RGBA').save(buf, 'PNG')
        parts.append({'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0), 'src': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()})
    return a, parts

KIND = {'happy': 'heart', 'angry': 'mark', 'sleep': 'zzz'}
parts_all, extra = {}, {}
for col in C['colorways']:
    sh = np.array(Image.open(ROOT + 'assets/sprites/cats/%s/sheet.png' % col).convert('RGBA'))
    out = np.zeros_like(sh); info = {'heart': None, 'mark': None, 'zzz': [], 'tears': [], 'top': 0, 'left': 0, 'right': 0}
    for i, pose in enumerate(C['poses']):
        fr, parts = strip(sh[:, i * FW:(i + 1) * FW], KIND.get(pose)); out[:, i * FW:(i + 1) * FW] = fr
        if pose in ('happy', 'angry'): info['heart' if pose == 'happy' else 'mark'] = parts[0] if parts else None
        if pose == 'sleep': info['zzz'] = parts
        body = comps(fr[..., 3] > 0)[0]
        if pose == 'hungry':
            ys = [p[0] for p in body]; xs = [p[1] for p in body]; info['top'] = int(min(ys)); info['left'] = int(min(xs)); info['right'] = int(max(xs))
        if pose == 'sad':                                              # места, откуда капают слёзы: самый нижний голубой пиксель каждой слезы
            fi = fr.astype(int)
            blue = [(y, x) for y in range(FH) for x in range(FW) if fi[y, x, 3] and fi[y, x, 2] > fi[y, x, 0] + 45 and fi[y, x, 2] > 170]
            blue = sorted(set(blue), key=lambda p: p[1])
            clusters = []
            for (y, x) in blue:
                if clusters and x - clusters[-1][-1][1] <= 3: clusters[-1].append((y, x))
                else: clusters.append([(y, x)])
            info['tears'] = [[int(sum(p[1] for p in c) / len(c)), int(max(p[0] for p in c))] for c in clusters if len(c) >= 3][:2]
    Image.fromarray(out, 'RGBA').save(OUT + 'cats/%s.png' % col)
    parts_all[col] = info; coats[col] = NAMES[col]
    os.makedirs(OUT + 'cats/' + col, exist_ok=True)
    extra[col] = []
    for name in EXTRA_NAMES:
        f = ROOT + 'assets/sprites/cats/%s/%s.png' % (col, name)
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGBA')
        if im.size != (FW, FH): print('ПРОПУЩЕН (нужно %dx%d): %s %s' % (FW, FH, f, im.size)); continue
        kind = KIND.get(name.split('_')[0]); fr, _ = strip(np.array(im), kind)
        Image.fromarray(fr, 'RGBA').save(OUT + 'cats/%s/%s.png' % (col, name)); extra[col].append(name)
data = {'w': GW, 'h': GH, 'frame_w': FW, 'frame_h': FH, 'poses': C['poses'], 'items': items, 'coats': coats, 'extra': extra, 'parts': parts_all, 'extra_names': EXTRA_NAMES}
open(OUT + 'data.js', 'w').write('// СГЕНЕРИРОВАНО tools/build_game_assets.py — руками не править\nwindow.GameData = ' + json.dumps(data, ensure_ascii=False) + ';\n')
print('готово; доп. кадров найдено:', sum(len(v) for v in extra.values()))
