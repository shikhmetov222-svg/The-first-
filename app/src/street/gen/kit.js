// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/** Материалы и детали улицы. scene — куда glow() и pool() добавляют свечение. */
export function createKit(scene) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- materials & helpers ---------- */
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .85, metalness: 0, flatShading: true }, o || {}));
  const winMat = M(0x2a2a30, { emissive: 0xffc66b, emissiveIntensity: 1, roughness: .3, flatShading: false });
  const doorMat = M(0x1a1410);
  const whiteMat = M(0xf0ece4);
  const darkMat = M(0x14161b);
  const woodMat = M(0x8a6a45);
  const leafMat = M(0x3f8f5a);
  const brickMat = M(0x8c4a32);
  const roofMat = M(0xa8492f);
  const steelMat = M(0x9aa0aa);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xa9d4f5, transparent: true, opacity: .3, roughness: .1, metalness: .2 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  // night lighting: soft glows around bulbs and warm light pools on the ground (no real lights, cheap on phones)
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,140,1)'); gr.addColorStop(.35, 'rgba(255,190,100,.42)'); gr.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .5 });
  function glow(x, y, z, s){ const sp = new THREE.Sprite(glowMat); sp.scale.set(s, s, 1); sp.position.set(x, y, z); scene.add(sp); return sp; }
  function pool(x, z, s, y){ const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), poolMat); m.rotation.x = -Math.PI / 2; m.position.set(x, y || .13, z); scene.add(m); return m; }

  function box(w, h, d, m){ const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.castShadow = true; me.receiveShadow = true; return me; }
  function cyl(r1, r2, h, m, s){ const me = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, s || 10), m); me.castShadow = true; me.receiveShadow = true; return me; }
  function cone(r, h, m, s){ const me = new THREE.Mesh(new THREE.ConeGeometry(r, h, s || 10), m); me.castShadow = true; return me; }
  function panel(w, h, m){ return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); }
  function add(parent, mesh, x, y, z){ mesh.position.set(x, y, z); parent.add(mesh); return mesh; }
  function body(g, w, h, d, m, x){ return add(g, box(w, h, d, m), x || 0, h / 2, -d / 2); }
  function front(g, w, h, m, x, y, z){ return add(g, panel(w, h, m), x, y, z === undefined ? .012 : z); }

  // gable roof, triangle facing the street, ridge running back
  function gable(w, d, rh, m){
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, rh); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d);
    const me = new THREE.Mesh(geo, m); me.castShadow = true; me.receiveShadow = true; return me;
  }
  // pitched roof with the ridge running along the street
  function eaveRoof(w, d, rh, m){
    const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, rh); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2);
    const me = new THREE.Mesh(geo, m); me.castShadow = true; me.receiveShadow = true; return me;
  }

  function rr(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  const texCache = {};
  function signTex(lines, color, w, h){
    const key = lines.join('|') + color + w + 'x' + h;
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#0B0C0F'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
    if (lines.length === 1) {
      const size = Math.min(Math.round(h * 0.46), Math.round((w - 40) / Math.max(3, lines[0].length) * 1.25));
      g.font = '700 ' + size + 'px Unbounded, Manrope, sans-serif';
      g.fillText(lines[0], w / 2, h / 2 + 2);
    } else {
      g.font = '700 ' + Math.round(h * 0.28) + 'px Unbounded, Manrope, sans-serif';
      g.fillText(lines[0], w / 2, h * 0.36);
      g.font = '800 ' + Math.round(h * 0.2) + 'px Manrope, sans-serif';
      g.fillStyle = '#F2F2F4';
      g.fillText(lines[1], w / 2, h * 0.7);
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
    texCache[key] = t; return t;
  }
  function sign(lines, color, w, h){
    const t = signTex(lines, color, 512, Math.max(64, Math.round(512 * h / w)));
    return panel(w, h, new THREE.MeshBasicMaterial({ map: t }));
  }
  function frontSign(g, text, color, w, y, x, z){
    x = x || 0; z = z === undefined ? .03 : z;
    add(g, box(w + .06, .48, .06, darkMat), x, y, z);
    add(g, sign([text], color, w, .42), x, y, z + .035);
  }
  function vSignTex(text, color){
    const key = 'v' + text + color;
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#120d1a'; g.fillRect(0, 0, 128, 512);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(5, 5, 118, 502);
    g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 16;
    g.font = '700 50px Unbounded, Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = Array.from(text), step = 490 / chars.length;
    chars.forEach((ch, i) => g.fillText(ch, 64, 11 + step * (i + .5)));
    const t = new THREE.CanvasTexture(c); texCache[key] = t; return t;
  }
  function bladeSign(g, text, color, x, y, z){
    add(g, box(.06, 2.16, .48, darkMat), x, y, z);
    const b = panel(.42, 2.1, new THREE.MeshBasicMaterial({ map: vSignTex(text, color) }));
    b.rotation.y = Math.PI / 2; add(g, b, x + .04, y, z);
  }

  function awning(width, accentHex, depth){
    depth = depth || .75;
    const g = new THREE.Group();
    const accent = M(accentHex);
    const n = Math.max(4, Math.round(width / 0.32)), sw = width / n;
    for (let i = 0; i < n; i++) {
      const s = box(sw, .05, depth, i % 2 ? whiteMat : accent);
      s.position.set(-width / 2 + sw * (i + .5), 0, depth / 2); g.add(s);
    }
    g.rotation.x = .42;
    return g;
  }

  const skins = [0xe9c9a5, 0xc99a6b, 0x8d5a3b, 0xf1d3b3];
  const shirts = [0xb5543c, 0x3fbf8f, 0x6c7bd9, 0xd4a73a, 0xc9ccd3, 0xe07a9a, 0x56a3c9];
  function person(){
    const g = new THREE.Group();
    add(g, box(.22, .14, .14, darkMat), 0, .07, 0);
    add(g, cyl(.13, .17, .55, M(pick(shirts)), 8), 0, .41, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), M(pick(skins), { flatShading: false }));
    head.castShadow = true; add(g, head, 0, .8, 0);
    return g;
  }
  function queue(g, x, n){
    for (let i = 0; i < n; i++) { const p = person(); p.rotation.y = Math.PI; add(g, p, x + rand(-.08, .08), 0, .55 + i * .5); }
  }
  function cafeTable(accentHex){
    const g = new THREE.Group();
    add(g, cyl(.32, .32, .05, whiteMat, 12), 0, .55, 0);
    add(g, cyl(.04, .05, .55, darkMat, 6), 0, .27, 0);
    add(g, box(.24, .32, .24, M(0x5a4636)), -.48, .16, 0);
    add(g, box(.24, .32, .24, M(0x5a4636)), .48, .16, 0);
    add(g, cyl(.02, .02, 1.45, darkMat, 6), 0, .72, 0);
    add(g, cone(.72, .32, M(accentHex)), 0, 1.5, 0);
    return g;
  }
  function cup(scale, m){
    const g = new THREE.Group();
    add(g, cyl(.5, .5, .04, whiteMat, 16), 0, .02, 0);
    add(g, cyl(.36, .28, .5, m, 14), 0, .29, 0);
    add(g, cyl(.31, .31, .02, M(0x3a2316), 14), 0, .53, 0);
    const h = new THREE.Mesh(new THREE.TorusGeometry(.15, .045, 8, 16), m); h.castShadow = true;
    add(g, h, .38, .3, 0);
    g.scale.setScalar(scale);
    return g;
  }
  function loaf(len, col){
    const me = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 8), M(col || 0xc98a45, { flatShading: false }));
    me.scale.set(len, .22, .24); me.castShadow = true; return me;
  }
  function flowerBox(g, len, x, y, z){
    add(g, box(len, .14, .16, M(0x2f5a3a)), x, y, z);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(.07, 6, 5), M(pick([0xe07a9a, 0xf2c46b, 0xffffff])));
      add(g, f, x - len / 2 + len * (i + .5) / 3, y + .1, z);
    }
  }
  function crate(g, x, y, z, fruit){
    add(g, box(.42, .2, .32, woodMat), x, y + .1, z);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(.075, 7, 5), M(fruit));
      add(g, f, x - .12 + i * .12, y + .25, z + rand(-.05, .05));
    }
  }
  function cart(){
    const g = new THREE.Group();
    add(g, box(.42, .26, .3, steelMat), 0, .45, 0);
    add(g, box(.04, .04, .3, darkMat), -.25, .62, 0);
    [[.15, .12], [.15, -.12], [-.15, .12], [-.15, -.12]].forEach(([x, z]) => add(g, box(.06, .06, .04, darkMat), x, .05, z));
    add(g, box(.04, .3, .04, steelMat), .18, .2, 0);
    return g;
  }
  function van(color, accHex){
    const g = new THREE.Group();
    add(g, box(1.6, .8, .78, M(color)), -.1, .55, 0);
    add(g, box(.5, .55, .76, M(color)), .85, .42, 0);
    add(g, box(.04, .28, .6, M(0x1d2230)), 1.1, .56, 0);
    add(g, box(1.62, .14, .8, M(accHex)), -.1, .62, 0);
    [[.55, .36], [.55, -.36], [-.55, .36], [-.55, -.36]].forEach(([x, z]) => {
      const wh = cyl(.15, .15, .1, darkMat, 10); wh.rotation.x = Math.PI / 2; add(g, wh, x, .15, z);
    });
    return g;
  }
  function tree(){
    const g = new THREE.Group();
    add(g, cyl(.08, .11, .9, M(0x5a4030), 6), 0, .45, 0);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(.5, .7), 0), leafMat);
    crown.castShadow = true; add(g, crown, 0, 1.25, 0);
    return g;
  }
  function emit(g, x, y, z, kind){ (g.userData.smoke = g.userData.smoke || []).push({ x, y, z, kind }); }
  function neonEdge(g, w, d, h, neonMat, sideToo){
    add(g, box(w + .14, .06, .06, neonMat), 0, h + .19, .07);
    if (sideToo) add(g, box(.06, .06, d + .14, neonMat), w / 2 + .07, h + .19, -d / 2);
  }

  /* ---------- props for the new businesses ---------- */
  const cardMat = M(0xc8a06a), tapeMat = M(0xe8d7b0), concreteMat = M(0x9a9a96), ribMat = M(0xa3a9b3);
  function addAnim(g, fn){ (g.userData.anims = g.userData.anims || []).push(fn); }
  function parcel(g, x, y, z, s){
    s = s || .3;
    add(g, box(s, s * .7, s * .8, cardMat), x, y + s * .35, z);
    add(g, box(s + .01, .03, s * .2, tapeMat), x, y + s * .7 + .005, z);
  }
  function parcelStack(g, x, z, n, s){ s = s || .3; for (let i = 0; i < n; i++) parcel(g, x + rand(-.03, .03), i * s * .7, z, s); }
  function pallet(g, x, z){ add(g, box(.8, .1, .8, woodMat), x, .05, z); }
  function ribs(g, w, h, z, m, step){ for (let x = -w / 2 + .15; x < w / 2 - .05; x += step || .35) add(g, box(.05, h, .03, m), x, h / 2, z); }
  function rollDoor(g, w, h, x, y0, z){
    add(g, panel(w, h, M(0x4a4e57)), x, y0 + h / 2, z);
    for (let i = 1; i < 6; i++) add(g, box(w, .02, .02, M(0x5f646e)), x, y0 + h * i / 6, z + .01);
  }
  function holding(p){ add(p, box(.28, .2, .22, cardMat), 0, .5, .2); return p; }
  function megaphone(m){
    const g = new THREE.Group(), inner = new THREE.Group();
    const c = cone(.3, .55, m, 14); c.rotation.x = -Math.PI / 2; add(inner, c, 0, 0, .08);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.3, .04, 6, 18), whiteMat); add(inner, rim, 0, 0, .355);
    add(inner, new THREE.Mesh(new THREE.CircleGeometry(.27, 16), darkMat), 0, 0, .35);
    add(inner, cyl(.06, .06, .3, darkMat, 8), 0, -.18, -.1);
    inner.rotation.x = -.4; g.add(inner);
    return g;
  }
  function scooter(g, x, z, accHex){
    const s = new THREE.Group();
    add(s, box(.7, .06, .18, darkMat), 0, .14, 0);
    add(s, cyl(.025, .025, .8, steelMat, 6), .32, .52, 0);
    add(s, box(.04, .04, .4, darkMat), .32, .92, 0);
    [-.3, .32].forEach(wx => { const wh = cyl(.1, .1, .06, darkMat, 10); wh.rotation.x = Math.PI / 2; add(s, wh, wx, .1, 0); });
    const p = person(); p.rotation.y = Math.PI / 2; add(s, p, -.05, .17, 0);
    add(s, box(.3, .32, .3, M(accHex)), -.3, .85, 0);
    s.position.set(x, 0, z); g.add(s); return s;
  }
  function drone(accHex){
    const g = new THREE.Group();
    add(g, box(.34, .08, .34, M(accHex)), 0, 0, 0);
    [[.24, .24], [.24, -.24], [-.24, .24], [-.24, -.24]].forEach(([x, z]) => {
      add(g, box(.04, .03, .04, darkMat), x, .02, z);
      add(g, cyl(.11, .11, .015, M(0xdddddd), 10), x, .05, z);
    });
    add(g, box(.18, .14, .14, cardMat), 0, -.13, 0);
    return g;
  }
  function locker(g, w, h, x, z, accHex){
    add(g, box(w, h, .6, M(accHex)), x, h / 2, z - .3);
    const cols = Math.max(2, Math.round(w / .32)), rows = Math.max(3, Math.round(h / .32));
    const dm = M(0xccfbf1), cr = Math.floor(rows / 2), cc = Math.floor(cols / 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const m = (r === cr && c === cc) ? new THREE.MeshBasicMaterial({ color: 0x1e3a8a }) : dm;
      add(g, panel(w / cols - .04, h / rows - .04, m), x - w / 2 + (c + .5) * w / cols, (r + .5) * h / rows, z + .012);
    }
  }
  function tumba(g, x, z){
    const cols = [0xf472b6, 0xfacc15, 0x60a5fa, 0x34d399];
    add(g, cyl(.32, .32, 1.5, M(0xe8e4dc), 14), x, .75, z);
    for (let i = 0; i < 4; i++) add(g, cyl(.33, .33, .26, M(cols[i]), 14), x, .25 + i * .34, z);
    add(g, new THREE.Mesh(new THREE.SphereGeometry(.34, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0x2b2d3a)), x, 1.5, z);
  }
  function adTex(title, sub, bg, fg){
    const key = 'ad' + title + sub + bg;
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 60px Unbounded, Manrope, sans-serif'; g.fillText(title, 256, 106);
    g.font = '800 34px Manrope, sans-serif'; g.fillText(sub, 256, 178);
    const t = new THREE.CanvasTexture(c); texCache[key] = t; return t;
  }
  const ADS = [adTex('СКИДКИ', '−30% на всё', '#F472B6', '#1a1b24'), adTex('ЛАТТЕ', '2 по цене 1', '#FACC15', '#1a1b24'),
    adTex('ДОСТАВКА', 'за 15 минут', '#60A5FA', '#0b0c0f'), adTex('ХЛЕБ', 'свежий с 7:00', '#34D399', '#0b0c0f')];
  function poster(g, w, h, i, x, y, z){ return add(g, panel(w, h, new THREE.MeshBasicMaterial({ map: ADS[i % ADS.length] })), x, y, z); }
  function adScreen(g, w, h, x, y, z){
    const m = new THREE.MeshBasicMaterial({ map: ADS[0] });
    add(g, box(w + .1, h + .1, .06, darkMat), x, y, z - .02);
    add(g, panel(w, h, m), x, y, z + .015);
    const off = Math.floor(rand(0, 4));
    addAnim(g, t => { m.map = ADS[(Math.floor(t / 2.2) + off) % ADS.length]; });
  }
  function trafficCone(g, x, z){
    add(g, cone(.13, .42, M(0xf97316), 10), x, .21, z);
    add(g, cyl(.085, .1, .07, whiteMat, 10), x, .24, z);
    add(g, box(.3, .03, .3, M(0xf97316)), x, .015, z);
  }
  function sandPile(g, x, z){ add(g, cone(.6, .45, M(0xc9a66b), 10), x, .22, z); }
  function bricks(g, x, z){ pallet(g, x, z); add(g, box(.7, .45, .7, brickMat), x, .32, z); }
  function cont(g, w, h, d, x, y, z, m){
    add(g, box(w, h, d, m), x, y + h / 2, z - d / 2);
    for (let xx = x - w / 2 + .12; xx < x + w / 2 - .05; xx += .25) add(g, box(.03, h - .08, .03, m), xx, y + h / 2, z + .012);
  }
  function wheel(g, x, y, z, r){ const wh = cyl(r, r, .12, darkMat, 10); wh.rotation.x = Math.PI / 2; add(g, wh, x, y, z); }
  function excavator(g, x, z, accHex){
    const e = new THREE.Group(), m = M(accHex);
    add(e, box(.9, .2, .5, darkMat), 0, .1, 0);
    add(e, box(.62, .32, .46, m), -.05, .36, 0);
    add(e, box(.3, .38, .4, m), -.18, .71, 0);
    add(e, panel(.22, .22, winMat), -.18, .76, .205);
    const a1 = box(.08, .7, .08, m); a1.rotation.z = -.7; add(e, a1, .42, .62, 0);
    const a2 = box(.08, .5, .08, m); a2.rotation.z = .5; add(e, a2, .74, .58, 0);
    add(e, box(.22, .16, .3, darkMat), .84, .3, 0);
    e.position.set(x, 0, z); g.add(e);
  }
  function towerCrane(g, x, z, h, accHex){
    const m = M(accHex);
    add(g, box(.5, .2, .5, concreteMat), x, .1, z);
    add(g, box(.2, h, .2, m), x, h / 2, z);
    for (let y = .5; y < h; y += .5) add(g, box(.23, .03, .23, darkMat), x, y, z);
    const jib = new THREE.Group(); jib.position.set(x, h, z);
    add(jib, box(.3, .3, .3, m), 0, .15, 0);
    add(jib, box(3.2, .12, .14, m), -1.3, .3, 0);
    add(jib, box(1.0, .12, .14, m), .8, .3, 0);
    add(jib, box(.4, .35, .3, concreteMat), 1.15, .15, 0);
    add(jib, box(.02, 1.4, .02, darkMat), -2.6, -.4, 0);
    add(jib, box(.3, .1, .3, cardMat), -2.6, -1.15, 0);
    g.add(jib);
    const ph = rand(0, 6);
    addAnim(g, t => { jib.rotation.y = Math.sin(t * .25 + ph) * .9; });
  }
  function dumpTruck(g, x, z, accHex){
    const t = new THREE.Group();
    add(t, box(.6, .7, .8, M(accHex)), .75, .55, 0);
    add(t, box(.04, .3, .62, M(0x1d2230)), 1.06, .68, 0);
    add(t, box(1.4, .15, .8, darkMat), -.15, .3, 0);
    const bed = box(1.2, .45, .78, M(0x6b7280)); bed.rotation.z = .1; add(t, bed, -.25, .62, 0);
    add(t, cone(.45, .3, M(0xc9a66b), 8), -.25, .95, 0);
    [[.75, .36], [.75, -.36], [-.55, .36], [-.55, -.36]].forEach(([wx, wz]) => wheel(t, wx, .17, wz, .17));
    t.position.set(x, 0, z); g.add(t);
  }
  function mixerTruck(g, x, z, accHex){
    const t = new THREE.Group();
    add(t, box(.6, .7, .8, M(accHex)), .8, .55, 0);
    add(t, box(.04, .3, .62, M(0x1d2230)), 1.11, .68, 0);
    add(t, box(1.7, .15, .7, darkMat), 0, .3, 0);
    const holder = new THREE.Group(); holder.position.set(-.2, .85, 0); holder.rotation.z = Math.PI / 2 - .25;
    const drum = new THREE.Group();
    add(drum, cyl(.32, .42, 1.1, M(0xe5e7eb), 12), 0, 0, 0);
    for (let i = 0; i < 3; i++) { const s = box(.08, 1.0, .1, M(accHex)); s.position.set(Math.cos(i * 2.1) * .38, 0, Math.sin(i * 2.1) * .38); drum.add(s); }
    holder.add(drum); t.add(holder);
    [.8, -.2, -.6].forEach(wx => { wheel(t, wx, .17, .36, .17); wheel(t, wx, .17, -.36, .17); });
    t.position.set(x, 0, z); g.add(t);
    addAnim(g, (tt, dt) => { drum.rotation.y += dt * 1.6; });
  }
  function roofSign(g, text, color, w, y, z, x){
    x = x || 0;
    add(g, cyl(.04, .04, .6, darkMat, 6), x - w / 2 + .2, y - .35, z); add(g, cyl(.04, .04, .6, darkMat, 6), x + w / 2 - .2, y - .35, z);
    add(g, box(w + .06, .62, .06, darkMat), x, y, z - .03);
    add(g, sign([text], color, w, .56), x, y, z + .005);
  }


  return {
    ADS,
    M,
    adScreen,
    adTex,
    add,
    addAnim,
    awning,
    bladeSign,
    body,
    box,
    brickMat,
    bricks,
    bulbMat,
    cafeTable,
    cardMat,
    cart,
    clamp,
    concreteMat,
    cone,
    cont,
    crate,
    cup,
    cyl,
    darkMat,
    doorMat,
    drone,
    dumpTruck,
    eaveRoof,
    emit,
    excavator,
    flowerBox,
    front,
    frontSign,
    gable,
    glassMat,
    glow,
    glowMat,
    glowTex,
    holding,
    leafMat,
    loaf,
    locker,
    megaphone,
    mixerTruck,
    neonEdge,
    pallet,
    panel,
    parcel,
    parcelStack,
    person,
    pick,
    pool,
    poolMat,
    poster,
    queue,
    rand,
    ribMat,
    ribs,
    rollDoor,
    roofMat,
    roofSign,
    rr,
    sandPile,
    scooter,
    shirts,
    sign,
    signTex,
    skins,
    steelMat,
    tapeMat,
    texCache,
    towerCrane,
    trafficCone,
    tree,
    tumba,
    vSignTex,
    van,
    wheel,
    whiteMat,
    winMat,
    woodMat,
  };
}
