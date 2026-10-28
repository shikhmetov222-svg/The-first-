// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/** Жизнь улицы: прохожие, машины, погода, фургон и монетки. */
export function createLife(k, scene, pixelRatio) {
  const { M, add, box, cone, cyl, darkMat, person, pick, rand, rr, shirts, van } = k;
  /* ---------- walkers & cars ---------- */
  const walkers = [];
  for (let i = 0; i < 12; i++) {
    const p = person(); const dirn = Math.random() < .5 ? 1 : -1;
    const z = i < 7 ? rand(1.65, 1.9) : rand(6.7, 7.0);
    p.position.set(rand(-21, 21), .12, z);
    p.rotation.y = dirn > 0 ? Math.PI / 2 : -Math.PI / 2;
    const um = new THREE.Group();
    add(um, cyl(.015, .015, .5, darkMat, 5), 0, .25, 0);
    add(um, cone(.38, .18, M(pick(shirts)), 8), 0, .55, 0);
    um.position.set(.12, .75, 0); um.visible = false; p.add(um);
    scene.add(p); walkers.push({ g: p, dir: dirn, speed: rand(.6, 1.0), phase: rand(0, 6), um, y0: .12, lim: 22 });
  }
  // people strolling along the promenade behind
  for (let i = 0; i < 9; i++) {
    const p = person(); const dirn = Math.random() < .5 ? 1 : -1;
    p.position.set(rand(-22, 22), .09, rand(-6.9, -6.35));
    p.rotation.y = dirn > 0 ? Math.PI / 2 : -Math.PI / 2;
    const um = new THREE.Group();
    add(um, cyl(.015, .015, .5, darkMat, 5), 0, .25, 0);
    add(um, cone(.38, .18, M(pick(shirts)), 8), 0, .55, 0);
    um.position.set(.12, .75, 0); um.visible = false; p.add(um);
    scene.add(p); walkers.push({ g: p, dir: dirn, speed: rand(.4, .75), phase: rand(0, 6), um, y0: .09, lim: 24 });
  }
  const dogOwner = walkers[walkers.length - 1];
  const dog = new THREE.Group();
  (function(){
    const fur = M(0xb07a45);
    add(dog, box(.42, .18, .16, fur), 0, .24, 0);
    add(dog, box(.16, .15, .15, fur), .27, .35, 0);
    add(dog, box(.06, .06, .08, M(0x2a1a10)), .37, .33, 0);
    [[.15, .06], [.15, -.06], [-.15, .06], [-.15, -.06]].forEach(([x, z]) => add(dog, box(.05, .16, .05, fur), x, .08, z));
    add(dog, box(.14, .04, .04, fur), -.27, .33, 0);
    dog.position.set(dogOwner.g.position.x + dogOwner.dir * .75, .06, dogOwner.g.position.z + .3);
    dog.rotation.y = dogOwner.dir > 0 ? 0 : Math.PI;
    scene.add(dog);
  })();
  const cars = [];
  const carColors = [0xd4a73a, 0xe5e7eb, 0xb5543c, 0x3f6fbf, 0x3fbf8f];
  function car(color){
    const g = new THREE.Group();
    add(g, box(1.3, .35, .66, M(color)), 0, .32, 0);
    add(g, box(.72, .3, .6, M(0x1d2230)), -.08, .62, 0);
    [[.42, .33], [.42, -.33], [-.42, .33], [-.42, -.33]].forEach(([x, z]) => {
      const wh = cyl(.14, .14, .1, darkMat, 10); wh.rotation.x = Math.PI / 2; add(g, wh, x, .14, z);
    });
    const hl = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    add(g, box(.04, .08, .14, hl), .66, .36, .2);
    add(g, box(.04, .08, .14, hl), .66, .36, -.2);
    return g;
  }
  [[3.6, 1], [3.6, 1], [3.6, 1], [5.2, -1], [5.2, -1], [5.2, -1]].forEach(([z, d], i) => {
    const c = car(carColors[i % carColors.length]); c.position.set(-26 + i * 9 + rand(-2, 2), .04, z);
    c.rotation.y = d > 0 ? 0 : Math.PI; scene.add(c); cars.push({ g: c, dir: d, speed: rand(2.6, 3.8) });
  });

  /* ---------- weather: rain, snow, clouds ---------- */
  const RN = 900, rainPos = new Float32Array(RN * 6);
  for (let i = 0; i < RN; i++) {
    const x = rand(-24, 24), y = rand(0, 12), z = rand(-8, 9);
    rainPos.set([x, y, z, x + .05, y - .45, z], i * 6);
  }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaec6e8, transparent: true, opacity: .5 }));
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);

  const SN = 300, snowPos = new Float32Array(SN * 3);
  for (let i = 0; i < SN; i++) snowPos.set([rand(-24, 24), rand(0, 10), rand(-6, 9)], i * 3);
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xf4f8ff, size: 2 * pixelRatio, sizeAttenuation: false, transparent: true, opacity: .45, depthWrite: false }));
  snow.frustumCulled = false; snow.visible = false; scene.add(snow);

  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xffffff, emissiveIntensity: .35 });
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 3; k++) add(c, new THREE.Mesh(new THREE.IcosahedronGeometry(rand(.6, 1.0), 0), cloudMat), k * .9 - .9, rand(-.1, .2), rand(-.3, .3));
    c.position.set(rand(-30, 30), rand(7.8, 9), rand(-9, -3)); scene.add(c); clouds.push(c);
  }

  /* ---------- delivery van ---------- */
  function labelSprite(text){
    const c = document.createElement('canvas'); c.width = 320; c.height = 80;
    const g = c.getContext('2d');
    rr(g, 4, 6, 312, 68, 34); g.fillStyle = 'rgba(11,12,15,.88)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#6CB4EE'; g.stroke();
    g.fillStyle = '#F2F2F4'; g.font = '800 30px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 160, 42);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false });
    const s = new THREE.Sprite(m); s.scale.set(2.2, .55, 1); s.renderOrder = 11;
    s.userData.dispose = () => { t.dispose(); m.dispose(); };
    return s;
  }
  const dv = van(0xf0ece4, 0xd4a73a); dv.position.set(-30, .04, 2.75); scene.add(dv);
  const vanState = { mode: 'idle', t: 4, target: null };
  const VAN_LABEL = { pvz: 'Посылки привезли', market: 'Товар на склад', ads: 'Привезли баннеры', repair: 'Стройматериалы' };

  function coinSprite(amount){
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    rr(g, 4, 8, 248, 80, 40); g.fillStyle = 'rgba(11,12,15,.88)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#D4A73A'; g.stroke();
    g.beginPath(); g.arc(48, 48, 26, 0, Math.PI * 2); g.fillStyle = '#D4A73A'; g.fill();
    g.fillStyle = '#0B0C0F'; g.font = '800 30px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('₽', 48, 50);
    g.fillStyle = '#F7D774'; g.font = '800 40px Manrope, sans-serif'; g.textAlign = 'left'; g.fillText('+' + amount.toLocaleString('ru-RU'), 88, 50);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false });
    const s = new THREE.Sprite(m); s.scale.set(1.7, .64, 1); s.renderOrder = 10;
    s.userData.dispose = () => { t.dispose(); m.dispose(); };
    return s;
  }
  return { walkers, dogOwner, dog, cars, car, RN, rainPos, rainGeo, rain, SN, snowPos, snowGeo, snow, cloudMat, clouds, labelSprite, dv, vanState, VAN_LABEL, coinSprite };
}
