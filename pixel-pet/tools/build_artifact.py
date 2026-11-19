"""Тестовая сборка для просмотра по ссылке (Artifact): одна страница со встроенными стилями и скриптами,
без скрипта Telegram, с открытой тестовой панелью. Картинки — отдельными файлами рядом.
Запуск: python3 tools/build_artifact.py <папка-сборки>"""
import os, shutil, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
P = sys.argv[1].rstrip('/') + '/'
os.makedirs(P, exist_ok=True)
html = open(R + 'index.html').read()
body = html[html.index('<main'):html.index('<script src="assets/game/data.js">')]
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Nunito:wght@700;800;900&display=swap">\n'
css = open(R + 'style.css').read()
js = '<script>window.PET_TEST = true;</script>\n' + ''.join('<script>\n' + open(R + f).read() + '\n</script>\n' for f in
      ['assets/game/data.js', 'js/sprites.js', 'js/shop.js', 'js/room.js', 'js/anim.js', 'js/pet.js', 'js/main.js'])
open(P + 'index.html', 'w').write('<title>Пиксель-питомец</title>\n' + fonts + '<style>\n' + css + '\n</style>\n' + body + js)
if os.path.exists(P + 'assets'): shutil.rmtree(P + 'assets')
shutil.copytree(R + 'assets/game', P + 'assets/game', ignore=shutil.ignore_patterns('data.js'))
files = sorted(os.path.relpath(os.path.join(d, f), P) for d, _, fs in os.walk(P + 'assets') for f in fs)
print('\n'.join(files))
