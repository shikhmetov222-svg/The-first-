"""Переносит код 3D-улицы из макета (docs/street-mockup.js) в модули игры (app/src/street/gen/).

Код строителей не переписывается руками: скрипт вырезает куски макета между комментариями-разделами
и оборачивает их в модули. Так геометрия зданий и окружения остаётся ровно такой, как в макете.
Запуск: python3 app/scripts/port-street.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'docs', 'street-mockup.js')
OUT = os.path.join(ROOT, 'app', 'src', 'street', 'gen')

src = open(SRC, encoding='utf-8').read()


def section(start, end):
    i = src.index(start)
    j = src.index(end, i)
    return src[i:j]


def dedent(code, n=4):
    return '\n'.join(line[n:] if line.startswith(' ' * n) else line for line in code.split('\n'))


HEADER = '// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.\n'

# ---------- kit: материалы, общие детали, реквизит ----------
helpers = section('    const rand = (a, b)', '    /* ---------- scene, camera, light')
materials = section('    /* ---------- materials & helpers', '    /* ---------- КОФЕЙНЯ')
props = section('    /* ---------- props for the new businesses', '    /* ---------- МАРКЕТПЛЕЙС')

kit_body = helpers + materials + props
names = sorted(set(re.findall(r'^\s{4}(?:const|let|function)\s+([A-Za-z_]\w*)', kit_body, re.M)))
# Деструктуризации «const { a, b } = …» в начале строки kit не содержит; доп. имена из списков const a = …, b = …
for m in re.finditer(r'^\s{4}const\s+(.+?);\s*$', kit_body, re.M):
    for part in re.findall(r'(?:^|,\s*)([A-Za-z_]\w*)\s*=', m.group(1)):
        names.append(part)
names = sorted(set(names))

kit = HEADER + "import * as THREE from 'three';\n\n" \
    "/** Материалы и детали улицы. scene — куда glow() и pool() добавляют свечение. */\n" \
    "export function createKit(scene) {\n" + dedent(kit_body, 2) + \
    "\n  return {\n" + ''.join(f'    {n},\n' for n in names) + "  };\n}\n"

KIT_NAMES = names


def destructure(code):
    used = [n for n in KIT_NAMES if re.search(r'\b' + re.escape(n) + r'\b', code)]
    return '  const { ' + ', '.join(used) + ' } = k;\n'


def builder_module(fn_name, start, end):
    code = section(start, end)
    m = re.search(r'    function ' + fn_name + r'\(T, L\)\{\n', code)
    body_start = m.end()
    head = code[:m.start()]
    fn = code[m.start():]
    fn = fn.replace('    function ' + fn_name + '(T, L){\n',
                    '    export function ' + fn_name + '(k, T, L){\n' + '    ' + destructure(fn), 1)
    return HEADER + "import * as THREE from 'three';\n\n" + dedent(head + fn)


os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'kit.js'), 'w', encoding='utf-8').write(kit)

builders = [
    ('coffee', 'buildCoffee', '    /* ---------- КОФЕЙНЯ', '    /* ---------- МАГАЗИН'),
    ('shop', 'buildShop', '    /* ---------- МАГАЗИН', '    /* ---------- ПЕКАРНЯ'),
    ('bakery', 'buildBakery', '    /* ---------- ПЕКАРНЯ', '    /* ---------- props for the new businesses'),
    ('market', 'buildMarket', '    /* ---------- МАРКЕТПЛЕЙС', '    /* ---------- ПВЗ'),
    ('pvz', 'buildPvz', '    /* ---------- ПВЗ', '    /* ---------- РЕКЛАМА'),
    ('ads', 'buildAds', '    /* ---------- РЕКЛАМА', '    /* ---------- РЕМОНТ'),
    ('repair', 'buildRepair', '    /* ---------- РЕМОНТ', '    /* ---------- business types'),
]
for file, fn, a, b in builders:
    open(os.path.join(OUT, f'{file}.js'), 'w', encoding='utf-8').write(builder_module(fn, a, b))

# ---------- типы бизнесов, участок, makeFor ----------
types = section('    /* ---------- business types', '    /* ---------- environment')
types = types.replace('build: buildCoffee', 'build: (T, L) => buildCoffee(k, T, L)') \
    .replace('build: buildShop', 'build: (T, L) => buildShop(k, T, L)') \
    .replace('build: buildBakery', 'build: (T, L) => buildBakery(k, T, L)') \
    .replace('build: buildMarket', 'build: (T, L) => buildMarket(k, T, L)') \
    .replace('build: buildPvz', 'build: (T, L) => buildPvz(k, T, L)') \
    .replace('build: buildAds', 'build: (T, L) => buildAds(k, T, L)') \
    .replace('build: buildRepair', 'build: (T, L) => buildRepair(k, T, L)')
open(os.path.join(OUT, 'types.js'), 'w', encoding='utf-8').write(
    HEADER + "import * as THREE from 'three';\n"
    + ''.join(f"import {{ {fn} }} from './{file}.js';\n" for file, fn, _, _ in builders)
    + "\n/** Типы бизнесов (облик, размеры и описания уровней), участок и сборка здания нужного уровня. */\n"
    + "export function createTypes(k) {\n" + destructure(types)
    + dedent(types, 2)
    + "  return { TYPES, buildLot, makeFor, dimsFor, disposeGroup };\n}\n")

# ---------- окружение: дорога, тротуары, задние дома, дорожка, кусты, горизонт, фонари ----------
env = section('    /* ---------- environment', '    /* ---------- walkers & cars')
env_names = ['groundMat', 'sideMat', 'roadMat', 'curbMat', 'dashMat', 'skylineMat', 'ground', 'curbMesh', 'dashes',
             'bgMats', 'bgWinOn', 'bgWinOff', 'farWins', 'LAMPS', 'nb']
open(os.path.join(OUT, 'environment.js'), 'w', encoding='utf-8').write(
    HEADER + "import * as THREE from 'three';\n\n"
    "/** Окружение улицы. Всё добавляется в scene; возвращает то, что меняется днём/ночью и по району. */\n"
    "export function createEnvironment(k, scene) {\n" + destructure(env) + dedent(env, 2)
    + "  return { " + ', '.join(env_names) + " };\n}\n")

print('ok:', len(KIT_NAMES), 'kit names')
