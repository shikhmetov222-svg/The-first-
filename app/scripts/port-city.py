"""Переносит город из макета (docs/city-mockup.html) в модуль игры app/src/city/gen/city.js.

Как и port-street.py, код не переписывается руками: скрипт вырезает куски макета (дома, районы, разметка, детали,
участки, транспорт, стройка, день/ночь, прозрачность кварталов, рост города) и оборачивает их в функцию createCity().
Здания бизнесов и общие детали берутся из уже перенесённых модулей улицы (street/gen) — в обоих макетах они одинаковые.

Что меняется по сравнению с макетом (только связь с игрой):
- seed города — у каждого игрока свой (ctx.seed); дома на каждом месте получают свой seed, поэтому появление
  нового конкурента или покупка участка не перетасовывает город;
- участки (свои бизнесы, конкуренты, свободные) приходят из игры (ctx.plots), стадия города — ctx.stage;
- склейка мешей — общая с улицей (ctx.mergeStatic), тосты и карточка — в React.
Запуск: python3 app/scripts/port-city.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'docs', 'city-mockup.html')
OUT = os.path.join(ROOT, 'app', 'src', 'city', 'gen')
KIT = os.path.join(ROOT, 'app', 'src', 'street', 'gen', 'kit.js')

src = open(SRC, encoding='utf-8').read()


def section(start, end):
    i = src.index(start)
    j = src.index(end, i)
    return src[i:j]


def sub(code, old, new, count=1):
    n = code.count(old)
    assert n == count, f'ожидалось {count} вхождений, найдено {n}: {old[:80]!r}'
    return code.replace(old, new)


def cut(code, start, end, new=''):
    """Убрать кусок от start до end (end не включается)."""
    i = code.index(start)
    j = code.index(end, i)
    return code[:i] + new + code[j:]


def dedent(code, n=2):
    return '\n'.join(line[n:] if line.startswith(' ' * n) else line for line in code.split('\n'))


city = section('    /* ===================== YOUR CITY', '    /* ---------- filters') \
    + section('    /* ---------- see-through', '    /* ---------- camera controls')

# Камера, туман и тени города настраивает игра (city/world.ts).
city = cut(city, '    // camera pulled far back', '    let seed = 7291;')
city = sub(city, '    let seed = 7291;', '    let seed = ctx.seed;')
# Склейка мешей — общая с улицей (street/merge.ts).
city = cut(city, '    /* merge the static parts of a group', '    /* ---------- palettes & shared parts',
           '    const mergeStatic = ctx.mergeStatic;\n\n')
# Стадия города и пороги — из игры.
city = sub(city, '    const STAGE_CAP = { 1: 0, 2: 300000, 3: 1000000, 4: 2500000 };\n', '    const STAGE_CAP = ctx.stageCap;\n')
city = sub(city, '    const CAP_NOW = { 1: 184500, 2: 412300, 3: 1240000, 4: 2730000 };\n', '')
city = sub(city, '    let cityStage = 2;', '    let cityStage = ctx.stage;')
# Участки — из игры.
city = cut(city, "    const ME = { name: 'Иванов Групп'", '    const plots = BIZ.map', '    const BIZ = ctx.plots;\n')
city = sub(city, '      p.demand = clamp(D.base + (srand() - .5) * .2, .05, 1);',
           '      p.demand = clamp(D.base + (ctx.hash(bz.i, bz.j, bz.k) - .5) * .2, .05, 1);')
city = sub(city, '      if (p.lot) { p.level = 0; p.price = Math.round((20000 + D.base * 90000) / 1000) * 1000; }',
           '      if (p.lot) { p.level = 0; p.price = bz.price || 0; }')
# Каждое место в квартале — со своим seed: город не перетасовывается, когда меняются участки.
city = sub(city, '        for (let k = 0; k < 4; k++) {\n          if (isBiz(b, k, front)) continue;',
           '        for (let k = 0; k < 4; k++) {\n          seed = ctx.slotSeed(b.i, b.j, k, front ? 1 : 0);\n'
           '          if (isBiz(b, k, front)) continue;')
city = sub(city, '      // courtyard between the two rows\n',
           '      seed = ctx.slotSeed(b.i, b.j, 9, 0);\n      // courtyard between the two rows\n')
city = sub(city, '    // city park with a pond and the season trophy\n',
           '    seed = ctx.slotSeed(9, 9, 9, 9);\n    // city park with a pond and the season trophy\n')
# Монетки показывает игра — по настоящей выручке.
city = cut(city, '    const myPlots = plots.filter', '    /* ---------- construction by stages',
           '    const myPlots = plots.filter(p => p.owner && p.owner.me);\n\n')
# Тосты и карточка — в React.
city = sub(city, "      toast('Стройка началась: ' + T.name + ', ур. ' + level + '. Бригада «' + p.build.brigade + '»');\n", '')
city = sub(city, "      toast((wasLot ? 'Открыт новый бизнес: ' : 'Готово: ') + TYPES[p.type].name + ', ур. ' + p.level + '. Новый облик уже на карте');\n",
           "      ctx.onFinished(p, wasLot);\n")
city = sub(city, '      if (cardPlot === p) showPlot(p);\n', '')
city = sub(city, '      p.heat.visible = heatOn;\n', '      p.heat.visible = ctx.heatOn();\n')
city = sub(city, "        if (cardPlot === p && !card.hidden && Math.round(pct * 100) % 5 === 0) showPlot(p);\n", '')
city = sub(city, '      if (wasLot) { p.owner = ME; p.lot = false; myPlots.push(p); }',
           '      if (wasLot) { p.owner = ctx.me; p.lot = false; myPlots.push(p); }')
city = sub(city, '        if (B.sg && B.sg.userData.anims) B.sg.userData.anims.forEach(fn => fn(clock, dt));',
           '        if (B.sg && B.sg.userData.anims) B.sg.userData.anims.forEach(fn => fn(ctx.clock(), dt));')
# День/ночь: кнопки макета не нужны, время выбирает игра.
city = cut(city, "    const btnDay = document.getElementById('btn-day')", '    function applyTime(day){')
city = sub(city, "      btnDay.setAttribute('aria-pressed', String(day)); btnNight.setAttribute('aria-pressed', String(!day));\n", '')
city = cut(city, "    btnDay.addEventListener('click'", '    /* ---------- see-through')
# Рост города: подпись под заголовком и кнопка макета не нужны.
city = sub(city, "    const subEl = document.querySelector('.sub');\n", '')
city = cut(city, '      const open = Object.keys(DISTRICTS).filter(k2 => STAGE_OF[k2] <= cityStage).length;\n', '    }\n    applyStage(false);')
city = city[:city.index("    const growBtn = document.getElementById('f-grow');")]
# Метки районов прячутся по зуму камеры — зумом управляет игра.
city = sub(city, '      s.position.set(x, 1.5, z); s.visible = camera.zoom < .8; scene.add(s);',
           '      s.position.set(x, 1.5, z); s.visible = ctx.camera.zoom < .8; scene.add(s);')
city = sub(city, '        occV.set(x, y, z).project(camera); occNdc.set(occV.x, occV.y);\n        occRay.setFromCamera(occNdc, camera);',
           '        occV.set(x, y, z).project(ctx.camera); occNdc.set(occV.x, occV.y);\n        occRay.setFromCamera(occNdc, ctx.camera);')
# Материалы земли и дорог меняются днём и ночью — их нельзя запекать в цвет вершин при склейке.
city = sub(city, '    function EM(day, night){ const m = new THREE.MeshStandardMaterial({ color: day, roughness: .9, flatShading: true }); envMats.push([m, day, night]); return m; }',
           '    function EM(day, night){ const m = new THREE.MeshStandardMaterial({ color: day, roughness: .9, flatShading: true }); envMats.push([m, day, night]); ctx.mutable.add(m); return m; }')
# Машины, автобусы, грузовики, велосипеды и прохожие рисуются инстансами (city/world.ts) — внутри модели не склеиваем.
for fn in ('busMesh', 'truckMesh', 'bikeMesh'):
    i = city.index('    function ' + fn + '(')
    j = city.index('      mergeStatic(g); return g;', i)
    city = city[:j] + '      return g;' + city[j + len('      mergeStatic(g); return g;'):]
i = city.index('    function carMesh(')
j = city.index('      mergeStatic(g);\n      return g;', i)
city = city[:j] + '      return g;' + city[j + len('      mergeStatic(g);\n      return g;'):]
city = sub(city, '        const p = person(); mergeStatic(p); const dirn', '        const p = person(); const dirn')
# Окна домов днём и ночью разные — тоже не запекаем.
city = sub(city, "    const WIN_ON = new THREE.MeshBasicMaterial({ color: 0xffc66b }), WIN_OFF = new THREE.MeshBasicMaterial({ color: 0x2b3140 });\n",
           "    const WIN_ON = new THREE.MeshBasicMaterial({ color: 0xffc66b }), WIN_OFF = new THREE.MeshBasicMaterial({ color: 0x2b3140 });\n"
           "    ctx.mutable.add(WIN_ON); ctx.mutable.add(WIN_OFF);\n")
# Флажок конкурента и рамка своего участка — склеиваем вместе со зданием (меньше вызовов отрисовки).
city = sub(city, "      const g = p.level === 0 ? buildLot(fmt(p.price)) : makeFor(p.type, p.level);\n      mergeStatic(g);\n",
           "      const g = p.level === 0 ? buildLot(fmt(p.price)) : makeFor(p.type, p.level);\n")
city = sub(city, "      const heat = new THREE.Mesh(new THREE.PlaneGeometry(PW - .5, 1.9),",
           "      mergeStatic(g); g.traverse(o => { o.userData.plot = p; });\n"
           "      const heat = new THREE.Mesh(new THREE.PlaneGeometry(PW - .5, 1.9),")
# Стройка идёт по времени сервера: доли этапов — из задания (19/19/27/23/12%), прогресс — ctx.progress(p).
city = sub(city, "    const BUILD_STAGES = [['Котлован', 2.6], ['Фундамент', 2.6], ['Каркас', 3.6], ['Фасад и окна', 3.2], ['Благоустройство', 1.6]];",
           "    const BUILD_STAGES = [['Котлован', .19], ['Фундамент', .19], ['Каркас', .27], ['Фасад и окна', .23], ['Благоустройство', .12]];")
city = sub(city, "        B.t += dt;\n", "        B.t = Math.min(1, ctx.progress(p)) * BUILD_TOTAL;\n")
# Смена этапа — облачко пыли.
city = sub(city, "        if (idx !== B.idx) { B.idx = idx; stageVisual(p, idx); }",
           "        if (idx !== B.idx) {\n"
           "          if (B.idx >= 0) for (let i = 0; i < 8; i++) puff(p.x + rand(-2.4, 2.4), .3, p.z - rand(.5, 3.5), 0xb5a68a, .35, 1.0, 1.0);\n"
           "          B.idx = idx; stageVisual(p, idx); ctx.onStage(p, idx);\n"
           "        }")
# Новый бизнес на участке становится своим только у меня; у конкурента — его.
city = sub(city, "      if (wasLot) { p.owner = ctx.me; p.lot = false; myPlots.push(p); }",
           "      if (wasLot) { p.owner = B.owner || ctx.me; p.lot = false; if (p.owner.me) myPlots.push(p); }")
# Дым, пыль и конфетти — общие инстансы (city/particles.ts): никаких новых мешей и материалов в кадре.
i = city.index('    function puff(x, y, z, color, size, rise, life){')
j = city.index('    function coinSprite(amount){', i)
city = city[:i] + '    function puff(x, y, z, color, size, rise, life){ ctx.particles.puff(x, y, z, color, size, rise, life); }\n' + city[j:]
i = city.index('    function confetti(x, y, z){')
j = city.index('    function finishConstruction(p){', i)
city = city[:i] + '    function confetti(x, y, z){ ctx.particles.confetti(x, y, z); }\n' + city[j:]
assert 'document.getElementById' not in city and 'document.querySelector' not in city, 'в модуле города остался DOM макета'

# Имена набора деталей (kit) — берём из готового модуля улицы.
kit_src = open(KIT, encoding='utf-8').read()
kit_names = re.findall(r'^    ([A-Za-z_]\w*),$', kit_src[kit_src.rindex('return {'):], re.M)
used = [n for n in kit_names if re.search(r'\b' + re.escape(n) + r'\b', city)]

RETURN = [
    'blocks', 'plots', 'myPlots', 'homes', 'cars', 'walkers', 'labels', 'placeLabel', 'districtCenter', 'DISTRICTS',
    'STAGE_OF', 'isLocked', 'buildPlotVisual', 'startConstruction', 'finishConstruction', 'updateConstruction',
    'applyTime', 'writeTrees', 'tweens', 'tween', 'puff', 'confetti', 'myPins', 'smokeSpots', 'selRing', 'showRing',
    'pinSprite', 'coinSprite', 'applyStage', 'checkOcclusion', 'setBlockOpacity', 'occl', 'syncClones', 'ground',
    'BUILD_STAGES', 'BUILD_TOTAL', 'cityW', 'cityD', 'BW', 'BD', 'SW', 'PW', 'SX', 'SZ', 'COLS', 'ROWS', 'envMats',
    'WIN_ON', 'WIN_OFF', 'trunkI', 'crownI', 'details', 'outskirts', 'stadiumHome',
]
for n in RETURN:
    assert re.search(r'\b' + n + r'\b', city), f'нет имени {n}'

out = (
    '// Сгенерировано скриптом app/scripts/port-city.py из docs/city-mockup.html — не править руками.\n'
    "import * as THREE from 'three';\n\n"
    '/**\n * Город игрока: дома, районы, разметка, детали, участки, транспорт, стройка, день/ночь, рост города.\n'
    ' * k — набор деталей (street/gen/kit.js, с кэшем материалов), types — здания бизнесов (street/gen/types.js),\n'
    ' * ctx — связь с игрой: scene, camera, hemi, dir, seed, stage, stageCap, plots, me, mergeStatic, hash, slotSeed,\n'
    ' * clock, heatOn, onFinished.\n */\n'
    'export function createCity(k, types, ctx) {\n'
    '  const { scene, hemi, dir } = ctx;\n'
    '  const { ' + ', '.join(used) + ' } = k;\n'
    '  const { TYPES, buildLot, makeFor, disposeGroup } = types;\n'
    + dedent(city, 2)
    + '  function setStage(s){ cityStage = s; }\n'
    + '  function setSelected(v){ selected = v; }\n'
    + '  return {\n' + ''.join(f'    {n},\n' for n in RETURN) + '    setStage,\n    setSelected,\n    getStage: () => cityStage,\n'
    '    getFountainJet: () => fountainJet,\n  };\n}\n'
)
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'city.js'), 'w', encoding='utf-8').write(out)
print('ok:', len(used), 'kit names,', out.count('\n'), 'lines')
