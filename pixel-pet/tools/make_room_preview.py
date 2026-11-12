"""Страница room-preview.html: пустая комната + предметы, которые «покупаются» и ставятся на места из референса."""
import json
ROOT = '/home/user/The-first-/pixel-pet/'
M = json.load(open(ROOT + 'assets/room/manifest.json'))
W, H = M['width'], M['height']
items = sorted(M['items'].items(), key=lambda kv: kv[1]['z'])
layers = ''.join('<img class="it" id="L-%s" src="assets/room/%s" alt="%s" style="left:%.4f%%;top:%.4f%%;width:%.4f%%" hidden>'
                 % (i, it['file'], it['name'], it['x'] / W * 100, it['y'] / H * 100, it['w'] / W * 100) for i, it in items)
rows = ''.join('<label class="row"><input type="checkbox" data-id="%s"><span class="th"><img src="assets/room/%s" alt=""></span><span class="nm">%s</span><span class="pr">%d 🪙</span></label>'
               % (i, it['file'], it['name'], it['price']) for i, it in M['items'].items())
total = sum(it['price'] for it in M['items'].values())
html = '''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Комната: пустая и предметы</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#1d1a26;color:#f4ecd8;font-family:system-ui,sans-serif;padding:14px}
h1{font-size:20px;margin:0 0 6px}p{margin:4px 0;color:#a79fb8;font-size:14px;max-width:860px}
.layout{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;align-items:flex-start}
.stage{position:relative;flex:1 1 640px;max-width:1100px;aspect-ratio:%d/%d;background:#000;border-radius:8px;overflow:hidden}
.stage img{position:absolute;display:block;image-rendering:pixelated}
.stage .bg{left:0;top:0;width:100%%}.stage .it{height:auto}.stage .it[hidden]{display:none}
.side{flex:0 0 330px;display:flex;flex-direction:column;gap:6px}
.bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
button{min-height:44px;padding:0 14px;border:0;border-radius:10px;background:#2a2536;color:#f4ecd8;font:inherit;font-size:13px;cursor:pointer}button.on{background:#e8b93c;color:#241c05;font-weight:700}
.row{display:flex;align-items:center;gap:10px;background:#2a2536;border-radius:10px;padding:6px 10px;min-height:56px;cursor:pointer}
.row input{width:20px;height:20px}.th{width:64px;height:44px;display:flex;align-items:center;justify-content:center;background:#e6cfa6;border-radius:6px;flex:none}
.th img{max-width:100%%;max-height:100%%;image-rendering:pixelated}.nm{flex:1;font-size:14px}.pr{font-size:13px;color:#e8b93c;font-weight:700}
</style></head><body>
<h1>Комната: пустая и предметы</h1>
<p>Базовая комната пустая: стены с лапками, окно, плинтус, пол. Все предметы вырезаны из <code>assets/reference/room.png</code> и покупаются за монеты (всего на %d 🪙). Отметь предмет, и он встанет на своё место из референса. «Поставить всё» собирает комнату как на референсе. В игру пока не подключено.</p>
<div class="layout">
 <div class="stage" id="stage"><img class="bg" id="bgE" src="assets/room/room-empty.png" alt="Пустая комната"><img class="bg" id="bgR" src="assets/reference/room.png" alt="Референс" hidden>%s</div>
 <div class="side"><div class="bar"><button id="all">Поставить всё</button><button id="none" class="on">Убрать всё</button><button id="ref">Показать референс</button></div>%s</div>
</div>
<script>
var boxes=[].slice.call(document.querySelectorAll('[data-id]'));
function sync(){boxes.forEach(function(b){document.getElementById('L-'+b.dataset.id).hidden=!b.checked})}
boxes.forEach(function(b){b.onchange=sync});
document.getElementById('all').onclick=function(){boxes.forEach(function(b){b.checked=true});sync()};
document.getElementById('none').onclick=function(){boxes.forEach(function(b){b.checked=false});sync()};
var showRef=false;document.getElementById('ref').onclick=function(){showRef=!showRef;this.classList.toggle('on',showRef);document.getElementById('bgR').hidden=!showRef;document.querySelectorAll('.it').forEach(function(i){i.style.visibility=showRef?'hidden':'visible'})};
</script></body></html>
''' % (W, H, total, layers, rows)
open(ROOT + 'room-preview.html', 'w').write(html); print('ok')
