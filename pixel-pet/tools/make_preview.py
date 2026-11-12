"""Собирает страницу sprites-preview.html: все вырезанные спрайты рядом с их источником в референсе."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
import cut   # noqa  (перерезает спрайты и заодно даёт FRAMES)
ROOT = '/home/user/The-first-/pixel-pet/'
M = json.load(open(ROOT + 'assets/sprites/cats/manifest.json'))
FW, FH = M['frame_w'], M['frame_h']
NAMES = {'orange': 'Рыжий', 'calico': 'Трёхцветный', 'gray': 'Серый полосатый', 'tuxedo': 'Чёрно-белый'}
POSES = {'sit': 'sit — сидит', 'sleep': 'sleep — спит, Zzz', 'hungry': 'hungry — миска и «!»', 'sad': 'sad — слёзы', 'sad2': 'sad, вариант 2 — слёзы', 'angry': 'angry — знак злости'}
def ref_crop(src, box, h=130):
    x0, y0, x1, y1 = box; f = h / (y1 - y0); W, H = Image.open(ROOT + 'assets/reference/' + src).size
    return ('<div class="ref" style="width:%dpx;height:%dpx"><img src="assets/reference/%s" style="width:%dpx;left:%dpx;top:%dpx" alt=""></div>'
            % ((x1 - x0) * f, h, src, W * f, -x0 * f, -y0 * f))
rows = []
for col, poses in cut.FRAMES.items():
    cells = []
    for p in M['poses']:
        f = M['colorways'][col][p]
        if f:
            src, box = poses[p][0], poses[p][1]
            cells.append('<td><div class="pair">%s<div class="spr"><img src="assets/sprites/cats/%s" width="%d" height="%d" alt="%s %s"></div></div><div class="cap">%s · %d×%d px</div></td>'
                         % (ref_crop(src, box), f['file'], FW, FH, col, p, 'кадр ' + p, FW, FH))
        else:
            cells.append('<td><div class="pair miss"><b>Нет в референсах</b><span>для этого окраса такой позы на картинках нет</span></div></td>')
    rows.append('<tr><th>%s</th>%s</tr>' % (NAMES[col], ''.join(cells)))
head = ''.join('<th>%s</th>' % POSES[p] for p in M['poses'])
html = '''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вырезанные спрайты котов</title>
<style>
:root{--k:3;--bg:#1d1a26;--card:#2a2536;--text:#f4ecd8;--hint:#a79fb8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;padding:14px}
h1{font-size:20px;margin:0 0 6px}p{margin:4px 0;color:var(--hint);font-size:14px;max-width:760px}
.bar{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.bar span{align-self:center;font-size:13px;color:var(--hint);margin-right:4px}
button{min-height:40px;padding:0 14px;border:0;border-radius:10px;background:var(--card);color:var(--text);font:inherit;font-size:13px;cursor:pointer}
button.on{background:#e8b93c;color:#241c05;font-weight:700}
.wrap{overflow-x:auto;padding-bottom:10px}table{border-collapse:separate;border-spacing:8px}
th{font-size:13px;text-align:left;vertical-align:top;padding:4px 2px;color:var(--text)}tbody th{font-size:15px;min-width:90px}
td{vertical-align:top}.pair{display:flex;gap:8px;align-items:flex-end;background:var(--card);border-radius:12px;padding:10px}
.ref{position:relative;overflow:hidden;border-radius:6px;flex:none;background:#000}.ref img{position:absolute;max-width:none}
.spr{flex:none;width:calc(%dpx * var(--k));height:calc(%dpx * var(--k));border-radius:6px;display:flex;align-items:flex-end;justify-content:center}
.spr img{width:100%%;height:100%%;image-rendering:pixelated}
.checker{background:conic-gradient(#d0d0d0 25%%,#ececec 0 50%%,#d0d0d0 0 75%%,#ececec 0) 0 0/16px 16px}
.light{background:#e6cfa6}.dark{background:#15121d}
.cap{font-size:11px;color:var(--hint);margin-top:4px}
.miss{flex-direction:column;justify-content:center;align-items:center;gap:6px;min-height:150px;min-width:150px;border:2px dashed #5a5272;background:transparent;text-align:center}
.miss b{color:#f07167;font-size:14px}.miss span{font-size:12px;color:var(--hint);max-width:140px}
</style></head><body>
<h1>Вырезанные спрайты котов</h1>
<p>Каждый кот вырезан из картинок в <code>assets/reference/</code>: прозрачный фон, без тени на полу, пиксели взяты с референса (с уменьшением до размера «пиксель-арт»). Слева — исходник, справа — вырезанный кадр. Все кадры одного размера (%d×%d px), лапы стоят на одной линии.</p>
<p>В игру пока не подключено — жду твоего одобрения.</p>
<div class="bar"><span>Фон под спрайтом:</span><button data-bg="checker" class="on">шахматка</button><button data-bg="light">светлый</button><button data-bg="dark">тёмный</button>
<span style="margin-left:12px">Масштаб:</span><button data-k="2">×2</button><button data-k="3" class="on">×3</button><button data-k="4">×4</button><button data-k="6">×6</button></div>
<div class="wrap"><table><thead><tr><th></th>%s</tr></thead><tbody>%s</tbody></table></div>
<script>
var sp=function(){return document.querySelectorAll('.spr')};
function setBg(b){sp().forEach(function(e){e.className='spr '+b})}setBg('checker');
document.querySelectorAll('[data-bg]').forEach(function(b){b.onclick=function(){document.querySelectorAll('[data-bg]').forEach(function(x){x.classList.remove('on')});b.classList.add('on');setBg(b.dataset.bg)}});
document.querySelectorAll('[data-k]').forEach(function(b){b.onclick=function(){document.querySelectorAll('[data-k]').forEach(function(x){x.classList.remove('on')});b.classList.add('on');document.documentElement.style.setProperty('--k',b.dataset.k)}});
</script></body></html>
''' % (FW, FH, FW, FH, head, ''.join(rows))
open(ROOT + 'sprites-preview.html', 'w').write(html)
print('ok')
