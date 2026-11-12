"""Страница sprites-preview.html: все вырезанные спрайты (9 окрасов × 9 состояний) и их источник в референсе."""
import json
ROOT = '/home/user/The-first-/pixel-pet/'
M = json.load(open(ROOT + 'assets/sprites/cats/manifest.json'))
FW, FH, K = M['frame_w'], M['frame_h'], M['k']
NAMES = {'orange': 'Рыжий', 'calico': 'Трёхцветный', 'gray': 'Серый полосатый', 'tuxedo': 'Чёрно-белый', 'siamese': 'Пятнистый (сиамский)',
         'white': 'Белый', 'black': 'Чёрный', 'beige': 'Бежевый', 'cream': 'Кремовый'}
POSES = {'sit': 'sit<br><small>Idle · сидит</small>', 'happy': 'happy<br><small>Happy · рад</small>', 'sad': 'sad<br><small>Crying · слёзы</small>',
         'sleep': 'sleep<br><small>Sleeping · спит, Zzz</small>', 'hungry': 'hungry<br><small>Hungry · миска</small>', 'sick': 'sick<br><small>Sick · болеет</small>',
         'angry': 'angry<br><small>Angry · злой</small>', 'play': 'play<br><small>Playing · играет</small>', 'groom': 'groom<br><small>Grooming · умывается</small>'}
rows = []
for col, poses in M['colorways'].items():
    cells = []
    for p in M['poses']:
        x0, y0, x1, y1 = M['cells'][col + '/' + p]
        cells.append('<td><div class="pair"><div class="ref"><img src="assets/reference/cats-matrix.png" style="--x:%d;--y:%d" alt=""></div>'
                     '<div class="spr"><img src="assets/sprites/cats/%s" width="%d" height="%d" alt="%s %s"></div></div></td>' % (x0, y0, poses[p], FW, FH, col, p))
    rows.append('<tr><th>%s</th>%s</tr>' % (NAMES[col], ''.join(cells)))
head = ''.join('<th>%s</th>' % POSES[p] for p in M['poses'])
html = '''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вырезанные спрайты котов</title>
<style>
:root{--k:2;--bg:#1d1a26;--card:#2a2536;--text:#f4ecd8;--hint:#a79fb8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;padding:14px}
h1{font-size:20px;margin:0 0 6px}p{margin:4px 0;color:var(--hint);font-size:14px;max-width:820px}
.bar{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;align-items:center}.bar span{font-size:13px;color:var(--hint);margin:0 4px 0 8px}
button{min-height:40px;padding:0 14px;border:0;border-radius:10px;background:var(--card);color:var(--text);font:inherit;font-size:13px;cursor:pointer}
button.on{background:#e8b93c;color:#241c05;font-weight:700}
.wrap{overflow-x:auto;padding-bottom:10px}table{border-collapse:separate;border-spacing:6px}
th{font-size:13px;text-align:left;vertical-align:bottom;padding:2px 2px 4px;font-weight:700}th small{font-weight:400;color:var(--hint);font-size:11px}
tbody th{vertical-align:middle;min-width:86px;font-size:14px}
.pair{display:flex;gap:4px;background:var(--card);border-radius:10px;padding:4px}
.spr,.ref{flex:none;width:calc(%dpx * var(--k));height:calc(%dpx * var(--k));border-radius:6px;overflow:hidden;position:relative}
.spr img{width:100%%;height:100%%;image-rendering:pixelated;display:block}
.ref{background:#c9a27e}.ref img{position:absolute;max-width:none;width:calc(1536px / %s * var(--k));
 left:calc(var(--x) * -1px / %s * var(--k));top:calc(var(--y) * -1px / %s * var(--k))}
.checker{background:conic-gradient(#d0d0d0 25%%,#ececec 0 50%%,#d0d0d0 0 75%%,#ececec 0) 0 0/16px 16px}
.light{background:#e6cfa6}.dark{background:#15121d}
.m-spr .ref,.m-ref .spr{display:none}
</style></head><body>
<h1>Вырезанные спрайты котов</h1>
<p>Все коты вырезаны из <code>assets/reference/cats-matrix.png</code>: 9 окрасов × 9 состояний. Фон прозрачный, тень на полу убрана, пиксели взяты с референса (уменьшение в %s раза). Все кадры одного размера (%d×%d px), кот в каждой клетке стоит на одном месте. В игру не подключено.</p>
<div class="bar"><span>Показать:</span><button data-m="m-spr" class="on">спрайты</button><button data-m="m-ref">исходник</button><button data-m="m-both">рядом</button>
<span>Фон:</span><button data-bg="checker" class="on">шахматка</button><button data-bg="light">светлый</button><button data-bg="dark">тёмный</button>
<span>Масштаб:</span><button data-k="1">×1</button><button data-k="2" class="on">×2</button><button data-k="3">×3</button><button data-k="4">×4</button></div>
<div class="wrap" id="wrap"><table><thead><tr><th></th>%s</tr></thead><tbody>%s</tbody></table></div>
<script>
function group(attr,fn){document.querySelectorAll('['+attr+']').forEach(function(b){b.onclick=function(){document.querySelectorAll('['+attr+']').forEach(function(x){x.classList.remove('on')});b.classList.add('on');fn(b.getAttribute(attr))}})}
function setBg(v){document.querySelectorAll('.spr').forEach(function(e){e.className='spr '+v})}setBg('checker');
group('data-bg',setBg);
group('data-k',function(v){document.documentElement.style.setProperty('--k',v)});
group('data-m',function(v){document.getElementById('wrap').className='wrap '+v});document.getElementById('wrap').className='wrap m-spr';
</script></body></html>
''' % (FW, FH, K, K, K, K, FW, FH, head, ''.join(rows))
open(ROOT + 'sprites-preview.html', 'w').write(html)
print('ok')
