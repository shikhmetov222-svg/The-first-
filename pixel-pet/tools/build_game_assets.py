"""Готовит ресурсы для игры из референсов: assets/game/
 - room.png        пустая комната 384×216 (уменьшение референса в 4.354 раза)
 - items/<id>.png  предметы в том же масштабе и с тем же выравниванием
 - cats/<окрас>.png спрайтлист кота (9 кадров 64×56 в ряд) — копия из assets/sprites/cats
 - data.js         размеры, координаты, цены (window.GameData)"""
import json, os, shutil
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
for col in C['colorways']:
    shutil.copy(ROOT + 'assets/sprites/cats/%s/sheet.png' % col, OUT + 'cats/%s.png' % col)
    coats[col] = NAMES[col]
data = {'w': GW, 'h': GH, 'frame_w': C['frame_w'], 'frame_h': C['frame_h'], 'poses': C['poses'], 'items': items, 'coats': coats}
open(OUT + 'data.js', 'w').write('// СГЕНЕРИРОВАНО tools/build_game_assets.py — руками не править\nwindow.GameData = ' + json.dumps(data, ensure_ascii=False) + ';\n')
print(json.dumps({k: (v['x'], v['y'], v['w'], v['h']) for k, v in items.items()}))
