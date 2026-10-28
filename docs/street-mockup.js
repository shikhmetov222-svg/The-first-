(function(){
  const stage = document.getElementById('stage');
  const msg = document.getElementById('msg');
  if (!window.THREE) { msg.textContent = '3D-библиотека не загрузилась. Обнови страницу.'; return; }

  const ready = document.fonts && document.fonts.ready
    ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))])
    : Promise.resolve();
  ready.then(init);

  function init(){
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch (e) { msg.textContent = 'Это устройство не поддерживает 3D. В игре здесь включится простой 2D-режим.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', '3D-улица с твоими бизнесами');
    stage.prepend(canvas);
    msg.remove();

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    /* ---------- scene, camera, light ---------- */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10131d);
    scene.fog = new THREE.Fog(0x10131d, 25, 48);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const OFFSET = new THREE.Vector3(7, 11, 17);
    const HOME = new THREE.Vector3(0, 2.4, 1);
    const target = HOME.clone();
    const LIGHT_OFF = new THREE.Vector3(8, 14, 10);
    function placeCamera(){
      camera.position.copy(target).add(OFFSET); camera.lookAt(target);
      dir.position.copy(target).add(LIGHT_OFF); dir.target.position.copy(target); dir.target.updateMatrixWorld();
    }

    function resize(){
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      const a = w / h; let hw, hh;
      if (a < 1.3) { hw = 9; hh = hw / a; } else { hh = 7; hw = hh * a; }
      camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(stage);
    resize();

    const hemi = new THREE.HemisphereLight(0x6f7fb0, 0x1a1a22, 0.32);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0x9fb0ff, 0.22);
    dir.position.set(8, 14, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    Object.assign(dir.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 60 });
    dir.shadow.bias = -0.0006;
    scene.add(dir); scene.add(dir.target);

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

    /* ---------- КОФЕЙНЯ: киоск → кафе → кафе с террасой → угловая → обжарка ---------- */
    function buildCoffee(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });

      if (L === 1) {
        body(g, w, h, d, wall);
        add(g, box(w + .3, .12, d + .3, acc), 0, h + .06, -d / 2);
        front(g, w * .72, .55, winMat, 0, .95);
        add(g, box(w * .82, .08, .35, whiteMat), 0, .64, .17);
        add(g, cup(.9, acc), 0, h + .12, -d / 2);
        emit(g, 0, h + .62, -d / 2, 'steam');
        const board = box(.42, .6, .06, darkMat); board.rotation.x = -.18; add(g, board, -w / 2 - .35, .3, .45);
        const t = cafeTable(T.accentHex); t.position.set(w / 2 + .8, 0, .8); g.add(t);
        g.userData.top = h + 1.0; return g;
      }
      if (L === 2) {
        body(g, w, h, d, wall);
        add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
        front(g, w * .5, 1.0, winMat, -w * .18, .75);
        front(g, .6, 1.15, doorMat, w * .32, .58);
        const aw = awning(w * .62, T.accentHex); aw.position.set(-w * .18, 1.42, 0); g.add(aw);
        frontSign(g, T.sign, T.accent, w * .68, 1.76);
        flowerBox(g, w * .5, -w * .18, .18, .12);
        add(g, cup(1.1, acc), 0, h + .14, -d / 2);
        emit(g, 0, h + .74, -d / 2, 'steam');
        const t = cafeTable(T.accentHex); t.position.set(-w * .18, 0, 1.15); g.add(t);
        g.userData.top = h + 1.1; return g;
      }
      if (L === 3) {
        body(g, w, h, d, wall);
        add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
        front(g, w * .5, 1.0, winMat, -w * .18, .75);
        front(g, .6, 1.15, doorMat, w * .32, .58);
        const aw = awning(w * .62, T.accentHex); aw.position.set(-w * .18, 1.42, 0); g.add(aw);
        frontSign(g, T.sign, T.accent, w * .7, 1.95);
        for (let i = 0; i < 3; i++) {
          const x = -w / 2 + (i + .5) * w / 3;
          front(g, .55, .6, winMat, x, 2.62);
          flowerBox(g, .62, x, 2.24, .1);
        }
        add(g, box(w, .05, .05, trim), 0, h + .45, -.08);
        for (let x = -w / 2; x <= w / 2 + .01; x += w / 4) add(g, box(.05, .45, .05, trim), x, h + .22, -.08);
        add(g, cup(.8, acc), -w / 2 + .6, h + .14, -d / 2 - .2);
        emit(g, -w / 2 + .6, h + .6, -d / 2 - .2, 'steam');
        const t1 = cafeTable(T.accentHex); t1.position.set(-1.05, 0, .95); g.add(t1);
        const t2 = cafeTable(T.accentHex); t2.position.set(.25, 0, 1.05); g.add(t2);
        g.userData.top = h + 1.0; return g;
      }
      if (L === 4) {
        body(g, w, h, d, wall);
        add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
        front(g, w * .86, 1.2, winMat, 0, .75);
        const sp = panel(d * .7, 1.2, winMat); sp.rotation.y = Math.PI / 2; add(g, sp, w / 2 + .012, .75, -d * .4);
        front(g, .6, 1.2, doorMat, -w / 2 + .55, .6, .02);
        const aw = awning(w * .9, T.accentHex); aw.position.set(0, 1.5, 0); g.add(aw);
        frontSign(g, T.sign, T.accent, w * .6, 2.08, -w * .12);
        for (let i = 0; i < 4; i++) {
          const x = -w / 2 + (i + .5) * w / 4;
          front(g, .5, .6, winMat, x, 2.95);
          flowerBox(g, .58, x, 2.58, .1);
        }
        neonEdge(g, w, d, h, neon, true);
        add(g, box(.5, .06, .06, darkMat), w / 2 + .25, 2.35, .1);
        add(g, cup(.75, neon), w / 2 + .5, 1.98, .1);
        emit(g, w / 2 + .5, 2.45, .1, 'steam');
        queue(g, -w / 2 + .55, 3);
        const t = cafeTable(T.accentHex); t.position.set(w * .2, 0, 1.0); g.add(t);
        g.userData.top = h + .6; return g;
      }
      // L5 — обжарка
      body(g, w, h, d, wall);
      add(g, box(w + .14, .18, d + .14, acc), 0, h + .09, -d / 2);
      front(g, w * .78, 1.3, winMat, -.2, .8);
      front(g, .7, 1.25, doorMat, w * .36, .63, .02);
      frontSign(g, T.sign, T.accent, w * .72, 1.95);
      [2.75, 3.65, 4.55].forEach(y => { for (let i = 0; i < 4; i++) front(g, .5, .6, winMat, -w / 2 + (i + .5) * w / 4, y); });
      [-w / 2, -w / 6, w / 6, w / 2].forEach(x => add(g, box(.12, h - 2.3, .12, acc), x, 2.3 + (h - 2.3) / 2, .04));
      const copper = M(0xb87333, { metalness: .45, roughness: .4, flatShading: false });
      [0, 1].forEach(k => {
        const x = -w / 2 - .45, z = -.55 - k * .95;
        add(g, cyl(.36, .36, 2.6, copper, 14), x, 1.3, z);
        add(g, cone(.38, .45, copper, 14), x, 2.83, z);
        add(g, box(.08, .08, .5, copper), x + .3, 2.2, z);
      });
      add(g, cup(2.0, acc), w * .14, h + .18, -d / 2);
      emit(g, w * .14, h + 1.3, -d / 2, 'steam');
      const r1 = cafeTable(T.accentHex); r1.scale.setScalar(.8); r1.position.set(-w / 2 + .6, h + .18, -.5); g.add(r1);
      const r2 = cafeTable(T.accentHex); r2.scale.setScalar(.8); r2.position.set(-w / 2 + .6, h + .18, -2.2); g.add(r2);
      queue(g, w * .36, 4);
      g.userData.top = h + 2.6; return g;
    }

    /* ---------- МАГАЗИН: ларёк → у дома → супермаркет → сетевой → ТЦ ---------- */
    function buildShop(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });

      if (L === 1) {
        add(g, box(w, .85, .8, wall), 0, .425, -.4);
        add(g, box(w, 1.7, .12, wall), 0, .85, -d + .06);
        [[-w / 2, -.05], [w / 2, -.05], [-w / 2, -d + .1], [w / 2, -d + .1]].forEach(([x, z]) => add(g, cyl(.04, .04, 1.75, darkMat, 6), x, .87, z));
        const aw = awning(w + .3, T.accentHex, d + .5); aw.rotation.x = .18; aw.position.set(0, 1.85, -d - .1); g.add(aw);
        add(g, box(w * .95 + .06, .44, .05, darkMat), 0, 2.27, -d + .08);
        add(g, sign(['ПРОДУКТЫ'], T.accent, w * .95, .38), 0, 2.27, -d + .11);
        add(g, cyl(.03, .03, .3, darkMat, 6), -w * .38, 1.95, -d + .08); add(g, cyl(.03, .03, .3, darkMat, 6), w * .38, 1.95, -d + .08);
        crate(g, -.55, .85, -.38, 0xf28c28); crate(g, 0, .85, -.38, 0x6bbf4a); crate(g, .55, .85, -.38, 0xd63c3c);
        crate(g, -.5, 0, .38, 0xf2c94c); crate(g, .35, 0, .42, 0x6bbf4a);
        g.userData.top = 2.8; return g;
      }
      if (L === 2) {
        body(g, w, h, d, wall);
        add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
        const sx = -w * .15, sw = w * .55;
        front(g, sw, 1.1, winMat, sx, .8);
        [.55, .95].forEach(y => {
          add(g, box(sw, .04, .06, whiteMat), sx, y, .04);
          for (let i = 0; i < 6; i++) add(g, box(.1, .14, .05, M(pick([0xd63c3c, 0xf2c94c, 0x6bbf4a, 0x56a3c9, 0xf0ece4]))), sx - sw / 2 + .15 + i * (sw - .3) / 5, y + .09, .05);
        });
        front(g, .7, 1.25, M(0x1c2a3a), w * .33, .63);
        add(g, box(w + .04, .5, .1, acc), 0, 1.72, .05);
        add(g, sign([T.sign], T.accent, w * .7, .4), 0, 1.72, .105);
        const c1 = cart(); c1.rotation.y = .3; add(g, c1, -w * .35, 0, .9);
        const c2 = cart(); c2.rotation.y = .1; add(g, c2, -w * .35 + .55, 0, 1.0);
        crate(g, w / 2 - .2, 0, .45, 0xf28c28);
        g.userData.top = h + .6; return g;
      }
      if (L === 3) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .25, d + .1, trim), 0, h + .12, -d / 2);
        front(g, w * .84, 1.5, winMat, 0, .85);
        front(g, .55, 1.4, M(0x1c2a3a), -.3, .72, .02);
        front(g, .55, 1.4, M(0x1c2a3a), .3, .72, .02);
        add(g, box(1.8, .08, .9, acc), 0, 1.75, .45);
        add(g, box(w + .04, .5, .1, acc), 0, 2.05, .05);
        add(g, sign(['СУПЕРМАРКЕТ'], T.accent, w * .7, .4), 0, 2.05, .105);
        [[-1, -1], [.2, -1.9], [1.1, -1.2]].forEach(([x, z]) => { add(g, box(.5, .35, .5, steelMat), x, h + .42, z); add(g, cyl(.16, .16, .03, darkMat, 10), x, h + .61, z); });
        const cx = w / 2 - .45;
        add(g, box(.05, .5, .05, steelMat), cx - .3, .25, .55); add(g, box(.05, .5, .05, steelMat), cx - .3, .25, 1.45);
        add(g, box(.05, .05, .9, steelMat), cx - .3, .5, 1.0);
        for (let i = 0; i < 3; i++) { const c = cart(); c.rotation.y = Math.PI / 2; add(g, c, cx, 0, .7 + i * .25); }
        queue(g, -.9, 2);
        g.userData.top = h + .9; return g;
      }
      if (L === 4) {
        body(g, w, h, d, wall);
        add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
        front(g, w * .86, 1.4, winMat, 0, .8);
        front(g, .8, 1.35, M(0x1c2a3a), .4, .7, .02);
        add(g, box(w + .04, 1.3, .08, acc), 0, 2.4, .04);
        add(g, sign([T.sign], T.accent, w * .6, .5), -w * .1, 2.4, .085);
        neonEdge(g, w, d, h, neon, true);
        add(g, box(.95, .95, .95, acc), w / 2 - .65, h + .55, -.75);
        add(g, box(.97, .08, .97, neon), w / 2 - .65, h + .14, -.75);
        add(g, sign(['М'], T.neon, .82, .82), w / 2 - .65, h + .55, -.75 + .48);
        bladeSign(g, T.sign, T.neon, w / 2 + .03, 2.3, -.4);
        const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .22, 0, 1.3);
        const c1 = cart(); add(g, c1, w * .32, 0, .7);
        queue(g, .4, 2);
        g.userData.top = h + 1.6; return g;
      }
      // L5 — торговый центр
      add(g, box(w, 2.4, d, wall), 0, 1.2, -d / 2);
      front(g, w * .9, 1.8, winMat, 0, 1.05);
      const d2 = d - .4, w2 = w - .6;
      add(g, box(w2, 1.8, d2, wall), 0, 2.4 + .9, -d2 / 2 - .2);
      for (let i = 0; i < 5; i++) front(g, .45, .7, winMat, -w2 / 2 + (i + .5) * w2 / 5, 3.3, -.2 + .012);
      const d3 = d - .9, w3 = w - 1.4;
      add(g, box(w3, 1.4, d3, trim), 0, 4.2 + .7, -d3 / 2 - .45);
      add(g, box(w + .1, .07, .07, neon), 0, 2.43, .05);
      add(g, box(w2 + .1, .07, .07, neon), 0, 4.23, -.15);
      const atrium = cyl(.85, .85, 3.4, glassMat, 20); atrium.castShadow = false; add(g, atrium, 0, 1.7, .25);
      add(g, cyl(.7, .7, 3.3, winMat, 20), 0, 1.65, .25);
      add(g, cyl(.92, .92, .12, acc, 20), 0, 3.46, .25);
      const sy = 5.6 + .65, sz = -d3 / 2 - .45;
      add(g, cyl(.04, .04, .6, darkMat, 6), -1.1, 5.9, sz); add(g, cyl(.04, .04, .6, darkMat, 6), 1.1, 5.9, sz);
      add(g, box(3.06, .76, .06, darkMat), 0, sy, sz - .03);
      add(g, sign(['ТЦ МАГАЗИН'], T.neon, 3.0, .7), 0, sy, sz + .005);
      [[-w / 2 + .25, 0xd63c3c], [-w / 2 + .75, 0xf2c94c], [w / 2 - .25, 0x6cb4ee]].forEach(([x, col]) => {
        add(g, cyl(.03, .03, 2.3, steelMat, 6), x, 1.15, .6);
        add(g, box(.02, .32, .5, M(col)), x, 2.1, .85);
      });
      queue(g, 1.3, 4);
      g.userData.top = 7.2; return g;
    }

    /* ---------- ПЕКАРНЯ: прилавок → домик → дом с террасой → кафе с печью → хлебозавод ---------- */
    function buildBakery(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
      const doorWood = M(0x5a3a22);

      if (L === 1) {
        add(g, box(w, .85, .8, woodMat), 0, .425, -.4);
        add(g, box(w, 1.5, .1, wall), 0, .75, -d + .05);
        [[-w / 2, -.05], [w / 2, -.05], [-w / 2, -d + .1], [w / 2, -d + .1]].forEach(([x, z]) => add(g, cyl(.05, .05, 1.6, woodMat, 6), x, .8, z));
        add(g, gable(w + .3, d + .3, .55, roofMat), 0, 1.6, .15);
        add(g, sign(['ХЛЕБ · ВЫПЕЧКА'], T.accent, 1.5, .32), 0, .5, .012);
        [-.55, .05, .6].forEach(x => {
          add(g, cyl(.22, .17, .14, woodMat, 10), x, .92, -.38);
          const l1 = loaf(.36); l1.rotation.y = rand(-.6, .6); add(g, l1, x, 1.02, -.38);
        });
        const big = loaf(.5, 0xb4733a); add(g, big, -.3, .95, -.12);
        g.userData.top = 2.6; return g;
      }
      if (L === 2) {
        body(g, w, h, d, wall);
        add(g, box(.12, h, .12, trim), -w / 2, h / 2, .0); add(g, box(.12, h, .12, trim), w / 2, h / 2, .0);
        add(g, box(w + .04, .1, .1, trim), 0, h, .02);
        add(g, gable(w + .3, d + .3, 1.0, roofMat), 0, h, .15);
        add(g, new THREE.Mesh(new THREE.CircleGeometry(.22, 16), winMat), 0, h + .38, .16);
        add(g, box(.32, .9, .32, brickMat), w * .28, h + .75, -d * .6);
        emit(g, w * .28, h + 1.25, -d * .6, 'smoke');
        front(g, w * .5, .9, winMat, -w * .18, .8);
        add(g, box(w * .55, .06, .25, woodMat), -w * .18, .38, .12);
        for (let i = 0; i < 3; i++) { const l = loaf(.3); l.rotation.y = .3; add(g, l, -w * .18 - .4 + i * .4, .45, .14); }
        front(g, .6, 1.2, doorWood, w * .3, .6);
        frontSign(g, T.sign, T.accent, w * .6, 1.72, -w * .05);
        add(g, box(.5, .05, .05, darkMat), w / 2 + .25, 1.6, .08);
        const hs = sign(['ХЛЕБ'], T.accent, .55, .3); hs.rotation.y = Math.PI / 2; add(g, hs, w / 2 + .38, 1.38, .08);
        g.userData.top = h + 1.7; return g;
      }
      if (L === 3) {
        body(g, w, h, d, wall);
        add(g, box(.12, h, .12, trim), -w / 2, h / 2, .0); add(g, box(.12, h, .12, trim), w / 2, h / 2, .0);
        add(g, box(w + .04, .1, .1, trim), 0, 1.5, .03);
        add(g, eaveRoof(w + .3, d + .3, 1.1, roofMat), 0, h, -d / 2);
        add(g, box(.34, 1.0, .34, brickMat), w * .3, h + .8, -d * .55);
        emit(g, w * .3, h + 1.35, -d * .55, 'smoke');
        front(g, w * .45, .8, winMat, -w * .2, .72);
        front(g, .6, 1.2, doorWood, w * .3, .6);
        frontSign(g, T.sign, T.accent, w * .62, 1.82, 0);
        [-w * .22, w * .22].forEach(x => {
          front(g, .55, .6, winMat, x, 2.6);
          add(g, box(.14, .6, .04, trim), x - .36, 2.6, .03); add(g, box(.14, .6, .04, trim), x + .36, 2.6, .03);
          flowerBox(g, .62, x, 2.23, .1);
        });
        add(g, box(w + .2, .1, 1.5, woodMat), 0, .15, .85);
        add(g, box(w + .2, .05, .05, woodMat), 0, .55, 1.58);
        for (let x = -w / 2 - .1; x <= w / 2 + .11; x += (w + .2) / 4) add(g, box(.05, .4, .05, woodMat), x, .35, 1.58);
        const t1 = cafeTable(T.accentHex); t1.position.set(-.9, .2, .85); g.add(t1);
        const t2 = cafeTable(T.accentHex); t2.position.set(.45, .2, .95); g.add(t2);
        add(g, box(.45, .05, .05, darkMat), w / 2 + .22, 1.95, .08);
        const pz = new THREE.Mesh(new THREE.TorusGeometry(.2, .06, 8, 18), acc); pz.castShadow = true; add(g, pz, w / 2 + .42, 1.72, .08);
        g.userData.top = h + 1.7; return g;
      }
      if (L === 4) {
        const mx = .4, mw = 3.0, mh = 2.8, md = 2.6;
        body(g, mw, mh, md, wall, mx);
        add(g, box(.12, mh, .12, trim), mx - mw / 2, mh / 2, .0); add(g, box(.12, mh, .12, trim), mx + mw / 2, mh / 2, .0);
        add(g, gable(mw + .3, md + .3, 1.2, roofMat), mx, mh, .15);
        const pz = new THREE.Mesh(new THREE.TorusGeometry(.28, .07, 8, 20), neon); add(g, pz, mx, mh + .45, .17);
        front(g, mw * .5, 1.0, winMat, mx - .45, .75);
        add(g, box(mw * .55, .06, .25, woodMat), mx - .45, .23, .12);
        for (let i = 0; i < 3; i++) { const l = loaf(.3); add(g, l, mx - .85 + i * .4, .3, .14); }
        front(g, .6, 1.2, doorWood, mx + 1.0, .6);
        frontSign(g, 'ПЕКАРНЯ·КАФЕ', T.accent, mw * .72, 1.72, mx - .25);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), brickMat);
        dome.castShadow = true; dome.receiveShadow = true; add(g, dome, -1.45, 0, -.9);
        const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, side: THREE.DoubleSide });
        add(g, new THREE.Mesh(new THREE.CircleGeometry(.32, 16, 0, Math.PI), fireMat), -1.45, .01, -.08);
        g.userData.flicker = [fireMat];
        add(g, cyl(.1, .1, 1.0, brickMat, 8), -1.45, 1.1, -1.05);
        emit(g, -1.45, 1.65, -1.05, 'smoke');
        add(g, box(.5, .4, .3, woodMat), -1.9, .2, .2);
        queue(g, mx + 1.0, 3);
        const t = cafeTable(T.accentHex); t.position.set(mx - .45, 0, 1.15); g.add(t);
        g.userData.top = mh + 1.8; return g;
      }
      // L5 — хлебозавод
      add(g, box(w, 1.2, d, brickMat), 0, .6, -d / 2);
      add(g, box(w, h - 1.2, d, wall), 0, 1.2 + (h - 1.2) / 2, -d / 2);
      for (let i = 0; i < 3; i++) add(g, gable(1.4, d + .2, .8, roofMat), -w / 2 + .7 + i * 1.4, h, .1);
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + (i + .5) * w / 4;
        front(g, .75, .7, winMat, x, 2.35);
        add(g, box(.04, .7, .03, darkMat), x, 2.35, .03);
      }
      front(g, 1.3, 1.1, M(0x3a3e48), w * .25, .55);
      for (let i = 0; i < 4; i++) add(g, box(1.3, .03, .02, M(0x5a5f6b)), w * .25, .15 + i * .27, .03);
      front(g, .55, 1.0, doorWood, -w * .12, .5);
      add(g, cyl(.04, .04, .7, darkMat, 6), -1.2, h + 1.0, .2); add(g, cyl(.04, .04, .7, darkMat, 6), 1.2, h + 1.0, .2);
      add(g, box(2.96, .66, .06, darkMat), 0, h + 1.2, .17);
      add(g, sign(['ХЛЕБОЗАВОД'], T.accent, 2.9, .6), 0, h + 1.2, .205);
      const giant = loaf(2.6, 0xc98a45); giant.scale.set(2.6, .45, .5); add(g, giant, 0, h + 1.82, .2);
      for (let i = 0; i < 4; i++) add(g, box(.08, .1, .52, M(0xe8c38a)), -.9 + i * .6, h + 1.95, .2);
      [[-w / 2 + .5, -d + .6], [-w / 2 + 1.15, -d + .5]].forEach(([x, z]) => {
        add(g, cyl(.22, .26, 2.8, brickMat, 12), x, h + 1.4, z);
        add(g, cyl(.235, .235, .12, whiteMat, 12), x, h + 2.2, z);
        emit(g, x, h + 2.9, z, 'smoke');
      });
      const gold = M(0xd9b56a);
      add(g, cyl(.55, .55, 3.6, gold, 16), w / 2 + .4, 1.8, -1.6);
      add(g, cone(.6, .5, gold, 16), w / 2 + .4, 3.85, -1.6);
      add(g, box(.06, 3.4, .14, darkMat), w / 2 + .4, 1.8, -1.0);
      const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .22, 0, 1.3);
      g.userData.top = h + 2.6; return g;
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

    /* ---------- МАРКЕТПЛЕЙС: гараж → мини-склад → склад с конвейером → фулфилмент → хаб ---------- */
    function buildMarket(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
      if (L === 1) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .1, d + .1, trim), 0, h + .05, -d / 2);
        front(g, w * .78, 1.15, M(0x2a2633), 0, .58);
        add(g, box(w * .8, .32, .08, acc), 0, 1.32, .04);
        parcelStack(g, -.7, .45, 3); parcelStack(g, -.25, .55, 2); parcelStack(g, .25, .4, 3, .34);
        add(g, box(.8, .05, .45, woodMat), w / 2 + .6, .62, .6);
        add(g, box(.05, .6, .4, darkMat), w / 2 + .25, .3, .6); add(g, box(.05, .6, .4, darkMat), w / 2 + .95, .3, .6);
        add(g, box(.3, .02, .22, darkMat), w / 2 + .6, .66, .62);
        const scr = panel(.3, .2, neon); scr.rotation.x = -.3; add(g, scr, w / 2 + .6, .77, .52);
        add(g, box(w * .9 + .06, .44, .06, darkMat), 0, h + .33, -.3);
        add(g, sign(['МАРКЕТ'], T.accent, w * .9, .38), 0, h + .33, -.265);
        g.userData.top = h + .9; return g;
      }
      if (L === 2) {
        body(g, w, h, d, wall);
        ribs(g, w, h - .45, .02, ribMat);
        add(g, box(w + .12, .12, d + .12, trim), 0, h + .06, -d / 2);
        add(g, box(w + .04, .42, .08, acc), 0, h - .25, .04);
        add(g, sign(['СКЛАД'], T.neon, w * .45, .34), 0, h - .25, .085);
        rollDoor(g, w * .5, 1.45, -w * .17, 0, .04);
        front(g, .55, 1.1, doorMat, w * .3, .55, .04);
        pallet(g, w / 2 + .6, .6); parcelStack(g, w / 2 + .45, .45, 2, .34); parcelStack(g, w / 2 + .8, .75, 3);
        g.userData.top = h + .6; return g;
      }
      if (L === 3) {
        body(g, w, h, d, wall);
        ribs(g, w, h - .5, .02, ribMat);
        add(g, box(w + .12, .12, d + .12, trim), 0, h + .06, -d / 2);
        frontSign(g, 'МАРКЕТПЛЕЙС', T.accent, w * .62, h - .3, 0, .04);
        add(g, box(w * .45, .6, .9, concreteMat), -w * .2, .3, .45);
        rollDoor(g, w * .38, 1.3, -w * .2, .6, .04);
        rollDoor(g, w * .25, 1.6, w * .3, 0, .04);
        add(g, box(.42, .06, 1.3, darkMat), -w * .2, .63, .6);
        const moving = [];
        for (let i = 0; i < 3; i++) { const p = new THREE.Group(); parcel(p, 0, 0, 0, .26); add(g, p, -w * .2, .66, 0); moving.push(p); }
        addAnim(g, t => { moving.forEach((p, i) => { p.position.z = .05 + ((t * .3 + i / 3) % 1) * 1.15; }); });
        parcelStack(g, -w * .2, 1.6, 2);
        add(g, box(.5, .35, .5, steelMat), -w * .25, h + .3, -1.2); add(g, box(.5, .35, .5, steelMat), w * .2, h + .3, -1.6);
        g.userData.top = h + .7; return g;
      }
      if (L === 4) {
        body(g, w, h, d, wall);
        let i = 0;
        for (let x = -w / 2 + .25; x < w / 2; x += .5, i++) add(g, box(.48, h - .2, .04, i % 4 === 0 ? acc : ribMat), x, (h - .2) / 2, .02);
        add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
        add(g, box(w * .5, .6, .9, concreteMat), -w * .18, .3, .45);
        rollDoor(g, w * .19, 1.3, -w * .3, .6, .05); rollDoor(g, w * .19, 1.3, -w * .06, .6, .05);
        rollDoor(g, w * .22, 1.8, w * .3, 0, .05);
        neonEdge(g, w, d, h, neon, true);
        roofSign(g, 'ФУЛФИЛМЕНТ', T.neon, w * .85, h + .75, -.4);
        const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .2, 0, 1.6);
        parcelStack(g, w * .3, 1.0, 3);
        g.userData.top = h + 1.4; return g;
      }
      const bh = 2.2;
      body(g, w, bh, d, wall);
      const s = new THREE.Shape(); s.absellipse(0, 0, w / 2 + .05, 1.25, 0, Math.PI, false);
      const geo = new THREE.ExtrudeGeometry(s, { depth: d + .1, bevelEnabled: false, curveSegments: 16 }); geo.translate(0, 0, -d - .05);
      const arch = new THREE.Mesh(geo, M(0xc7cbd3)); arch.castShadow = true; arch.receiveShadow = true; add(g, arch, 0, bh, 0);
      const s2 = new THREE.Shape(); s2.absellipse(0, 0, w * .3, .85, 0, Math.PI, false);
      add(g, new THREE.Mesh(new THREE.ShapeGeometry(s2, 12), winMat), 0, bh + .05, .06);
      add(g, box(w + .04, .4, .08, acc), 0, bh - .12, .04);
      add(g, sign(['МАРКЕТПЛЕЙС'], T.neon, w * .62, .32), 0, bh - .12, .085);
      for (let k = 0; k < 3; k++) rollDoor(g, w * .22, 1.4, -w * .3 + k * w * .3, 0, .04);
      add(g, cyl(.5, .5, .05, M(0x3a3e48), 16), 0, bh + 1.28, -d / 2);
      const dr = drone(T.accentHex); dr.scale.setScalar(1.9); add(g, dr, 0, bh + 1.9, -d / 2);
      addAnim(g, t => { dr.position.y = bh + 1.95 + Math.sin(t * 2) * .2; dr.position.x = Math.sin(t * .7) * .5; dr.rotation.y = t * .6; });
      const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .22, 0, 1.6);
      pallet(g, w * .33, 1.1); parcelStack(g, w * .3, 1.0, 3); parcelStack(g, w * .38, 1.25, 2);
      g.userData.top = bh + 2.6; return g;
    }

    /* ---------- ПВЗ: постамат → киоск → пункт выдачи → двухэтажный → сортировочный центр ---------- */
    function buildPvz(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
      if (L === 1) {
        locker(g, 1.4, 1.8, 0, 0, T.accentHex);
        add(g, box(1.9, .08, 1.3, M(0x3a3e48)), 0, 1.98, -.15);
        add(g, cyl(.03, .03, 1.95, darkMat, 6), -.88, .975, .4); add(g, cyl(.03, .03, 1.95, darkMat, 6), .88, .975, .4);
        add(g, box(1.66, .34, .05, darkMat), 0, 2.24, .4);
        add(g, sign(['ПОСТАМАТ'], T.neon, 1.6, .3), 0, 2.24, .43);
        const p = holding(person()); add(g, p, .5, 0, .8);
        g.userData.top = 2.9; return g;
      }
      const shelves = (x0, ww, ys, n) => ys.forEach(y => {
        add(g, box(ww, .03, .08, whiteMat), x0, y, .05);
        for (let i = 0; i < n; i++) parcel(g, x0 - ww / 2 + (i + .5) * ww / n, y + .015, .07, .18);
      });
      if (L === 2) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
        add(g, box(w + .04, .45, .08, acc), 0, h - .25, .04);
        add(g, sign(['ПВЗ'], T.neon, w * .62, .38), 0, h - .25, .085);
        front(g, w * .55, 1.0, winMat, -w * .17, .8);
        shelves(-w * .17, w * .55, [.5, .9], 4);
        front(g, .55, 1.15, M(0x1c2a3a), w * .32, .58);
        const p = holding(person()); add(g, p, w * .32, 0, .95);
        g.userData.top = h + .6; return g;
      }
      if (L === 3 || L === 4) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
        const bandY = L === 3 ? h - .3 : 2.02;
        add(g, box(w + .04, .48, .08, acc), 0, bandY, .04);
        add(g, sign(['ПУНКТ ВЫДАЧИ'], T.neon, w * .72, .38), 0, bandY, .085);
        front(g, w * .62, 1.5, winMat, -w * .16, .9);
        shelves(-w * .16, w * .62, [.4, .8, 1.2], 5);
        front(g, .6, 1.4, M(0x1c2a3a), w * .33, .7);
        locker(g, .8, 1.6, -w / 2 - .55, .6, T.accentHex);
        if (L === 4) {
          for (let i = 0; i < 4; i++) {
            const x = -w / 2 + (i + .5) * w / 4;
            add(g, box(.62, .7, .04, acc), x, 2.9, .02); front(g, .5, .58, winMat, x, 2.9, .045);
          }
          neonEdge(g, w, d, h, neon, true);
          bladeSign(g, 'ПВЗ', T.neon, w / 2 + .03, 2.6, -.4);
          scooter(g, w * .05, 1.6, T.accentHex);
        }
        for (let i = 0; i < (L === 3 ? 2 : 3); i++) { const p = holding(person()); p.rotation.y = Math.PI; add(g, p, w * .33 + rand(-.06, .06), 0, .6 + i * .5); }
        g.userData.top = h + .6; return g;
      }
      body(g, w, h, d, wall);
      add(g, box(w + .1, .14, d + .1, trim), 0, h + .07, -d / 2);
      for (let k = 0; k < 3; k++) rollDoor(g, w * .2, 1.6, -w * .34 + k * w * .23, 0, .03);
      front(g, w * .2, 1.4, winMat, w * .37, .9);
      add(g, box(w + .04, .5, .08, acc), 0, h - .35, .04);
      add(g, sign(['СОРТИРОВКА'], T.neon, w * .62, .4), 0, h - .35, .085);
      add(g, box(w * .78, .08, .38, darkMat), -w * .1, .58, .6);
      [-w * .45, w * .25].forEach(x => add(g, box(.06, .54, .3, steelMat), x, .27, .6));
      const moving = [];
      for (let i = 0; i < 4; i++) { const p = new THREE.Group(); parcel(p, 0, 0, 0, .24); add(g, p, 0, .62, .6); moving.push(p); }
      addAnim(g, t => { moving.forEach((p, i) => { p.position.x = -w * .48 + ((t * .25 + i / 4) % 1) * w * .76; }); });
      for (let i = 0; i < 3; i++) scooter(g, -w * .32 + i * 1.0, 1.65, T.accentHex);
      add(g, cyl(.03, .03, 1.4, darkMat, 6), w / 2 - .4, h + .7, -d + .5);
      add(g, cyl(.04, .04, .4, darkMat, 6), -w / 2 + .6, h + .2, -1.0);
      const dish = cyl(.36, .2, .08, whiteMat, 16); dish.rotation.x = .9; add(g, dish, -w / 2 + .6, h + .45, -.95);
      add(g, cyl(.015, .015, .3, darkMat, 5), -w / 2 + .6, h + .55, -.8);
      neonEdge(g, w, d, h, neon, false);
      g.userData.top = h + 1.2; return g;
    }

    /* ---------- РЕКЛАМА: будка с афишами → студия → агентство → медиаофис → медиахолдинг ---------- */
    function buildAds(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
      if (L === 1) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .1, d + .1, acc), 0, h + .05, -d / 2);
        poster(g, .78, .4, 0, -.42, 1.05, .012); poster(g, .78, .4, 1, .42, 1.05, .012);
        poster(g, .78, .4, 2, -.42, .55, .012); poster(g, .78, .4, 3, .42, .55, .012);
        const side = panel(d * .7, .5, new THREE.MeshBasicMaterial({ map: ADS[2] })); side.rotation.y = Math.PI / 2; add(g, side, w / 2 + .012, .9, -d / 2);
        add(g, cyl(.04, .04, .3, darkMat, 6), 0, h + .2, -d / 2 + .2);
        const mg = megaphone(acc); mg.rotation.y = -1.15; mg.scale.setScalar(1.25); add(g, mg, 0, h + .45, -d / 2 + .2);
        tumba(g, w / 2 + .75, .65);
        g.userData.top = h + 1.1; return g;
      }
      if (L === 2) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
        adScreen(g, w * .8, w * .4, 0, .95, 0);
        neonEdge(g, w, d, h, neon, false);
        add(g, box(.4, .05, .05, darkMat), w / 2 + .2, h - .35, .1);
        const mg2 = megaphone(acc); mg2.rotation.y = 1.2; add(g, mg2, w / 2 + .42, h - .35, .15);
        add(g, box(w * .6 + .06, .4, .06, darkMat), 0, h + .3, -.3);
        add(g, sign(['РЕКЛАМА'], T.neon, w * .6, .34), 0, h + .3, -.265);
        tumba(g, -w / 2 - .55, .65);
        g.userData.top = h + .9; return g;
      }
      if (L === 3) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
        front(g, w * .5, 1.1, winMat, -w * .18, .75);
        front(g, .6, 1.2, M(0x1c1d26), w * .32, .6);
        frontSign(g, 'РЕКЛАМА', T.neon, w * .6, 1.62);
        adScreen(g, w * .8, w * .4, 0, 2.55, 0);
        roofSign(g, 'АГЕНТСТВО', T.accent, w * .75, h + .7, -.5);
        tumba(g, w / 2 + .5, .7);
        g.userData.top = h + 1.3; return g;
      }
      if (L === 4) {
        add(g, box(w - .3, h, d - .3, wall), 0, h / 2, -d / 2);
        [1.4, 2.8].forEach(y => add(g, box(w - .04, .08, d - .04, whiteMat), 0, y, -d / 2));
        front(g, w * .7, 1.1, winMat, -.25, .7, -.138);
        front(g, .6, 1.2, M(0x1c1d26), w * .33, .6, -.138);
        for (let i = 0; i < 4; i++) front(g, .55, .5, winMat, -w / 2 + .15 + (i + .5) * (w - .3) / 4, 3.75, -.138);
        const glass = box(w, h, d, glassMat); glass.castShadow = false; glass.receiveShadow = false; add(g, glass, 0, h / 2, -d / 2);
        adScreen(g, w * .88, w * .44, 0, 2.15, .04);
        neonEdge(g, w, d, h, neon, true);
        [-w * .3, 0, w * .3].forEach(x => { const sp = cyl(.08, .13, .25, darkMat, 8); sp.rotation.x = .9; add(g, sp, x, h + .12, .12); });
        frontSign(g, 'АГЕНТСТВО', T.neon, w * .5, 1.48, -.25, .06);
        g.userData.top = h + .7; return g;
      }
      body(g, w, h, d, wall);
      for (let i = 0; i < 4; i++) front(g, .35, h - 2.4, winMat, -w / 2 + .45 + i * (w - .9) / 3, 2.1 + (h - 2.4) / 2);
      front(g, w * .75, 1.2, winMat, 0, .75);
      add(g, box(w * .82, .08, .8, acc), 0, 1.45, .4);
      frontSign(g, 'МЕДИА', T.neon, w * .45, 1.78);
      add(g, box(w + .06, .14, d + .06, trim), 0, h + .07, -d / 2);
      neonEdge(g, w, d, h, neon, true);
      add(g, cyl(.08, .08, .45, darkMat, 8), 0, h + .22, -d / 2);
      const cube = new THREE.Group(); cube.position.set(0, h + 1.15, -d / 2);
      add(cube, box(1.3, 1.3, 1.3, darkMat), 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const holder = new THREE.Group(); holder.rotation.y = k * Math.PI / 2;
        const pn = panel(1.24, .62, new THREE.MeshBasicMaterial({ map: ADS[k] })); pn.position.z = .655; holder.add(pn); cube.add(holder);
      }
      g.add(cube);
      add(g, cyl(.03, .03, 1.3, darkMat, 6), w / 2 - .3, h + .65, -d + .4);
      const blink = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
      add(g, new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), blink), w / 2 - .3, h + 1.33, -d + .4);
      addAnim(g, t => { cube.rotation.y = t * .45; blink.visible = (t % 1.2) < .6; });
      tumba(g, w / 2 + .5, .75);
      g.userData.top = h + 2.3; return g;
    }

    /* ---------- РЕМОНТ: бытовка → мастерская → стройдвор → стройкомпания → девелопер ---------- */
    function buildRepair(T, L){
      const { w, h, d } = T.dims[L];
      const g = new THREE.Group();
      const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
      if (L === 1) {
        const bh = h - .2;
        add(g, box(w, bh, d, acc), 0, .2 + bh / 2, -d / 2);
        for (let x = -w / 2 + .15; x < w / 2; x += .3) add(g, box(.03, bh - .1, .03, acc), x, .2 + bh / 2, .015);
        [-w / 2 + .3, w / 2 - .3].forEach(x => add(g, box(.25, .2, .8, concreteMat), x, .1, -d / 2));
        front(g, .6, .4, winMat, -w * .2, .2 + bh * .62, .035);
        front(g, .45, .95, M(0x4b5563), w * .3, .7, .035);
        add(g, box(.5, .1, .3, concreteMat), w * .3, .1, .2);
        add(g, box(w * .6 + .06, .36, .06, darkMat), 0, .2 + bh + .25, -.3);
        add(g, sign(['РЕМОНТ'], T.accent, w * .6, .3), 0, .2 + bh + .25, -.265);
        trafficCone(g, -w / 2 - .25, .6); trafficCone(g, -w / 2 + .25, 1.0); trafficCone(g, w / 2 + .3, .9);
        sandPile(g, w / 2 + .75, -.3);
        g.userData.top = h + 1.0; return g;
      }
      if (L === 2) {
        body(g, w, h, d, wall);
        add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
        add(g, box(w + .04, .42, .08, acc), 0, h - .25, .04);
        add(g, sign(['МАСТЕРСКАЯ'], T.accent, w * .7, .34), 0, h - .25, .085);
        front(g, w * .5, 1.4, M(0x22252b), -w * .15, .7);
        const px = -w * .15;
        add(g, panel(w * .42, .62, M(0xc9b48a)), px, 1.05, .02);
        add(g, box(.04, .34, .03, woodMat), px - .32, 1.02, .04); add(g, box(.2, .07, .04, steelMat), px - .32, 1.2, .04);
        add(g, box(.05, .3, .03, steelMat), px - .05, 1.05, .04); add(g, new THREE.Mesh(new THREE.TorusGeometry(.06, .02, 6, 10), steelMat), px - .05, 1.22, .04);
        add(g, box(.34, .12, .02, steelMat), px + .27, 1.12, .04); add(g, box(.08, .12, .04, acc), px + .48, 1.12, .04);
        [[-.3, 0xd63c3c], [-.12, 0x3f6fbf], [.06, 0xf2c94c]].forEach(([dx, c]) => add(g, cyl(.08, .08, .16, M(c), 10), px + dx, .08, .12));
        add(g, box(1.0, .06, .45, woodMat), -w * .15, .75, .55);
        add(g, box(.06, .72, .4, darkMat), -w * .15 - .45, .36, .55); add(g, box(.06, .72, .4, darkMat), -w * .15 + .45, .36, .55);
        bricks(g, w * .33, .6);
        const wb = new THREE.Group();
        add(wb, box(.5, .22, .36, acc), 0, .35, 0); wheel(wb, .3, .12, 0, .12);
        add(wb, box(.5, .03, .03, darkMat), -.4, .4, .14); add(wb, box(.5, .03, .03, darkMat), -.4, .4, -.14);
        wb.position.set(w / 2 + .55, 0, 1.0); g.add(wb);
        g.userData.top = h + .6; return g;
      }
      if (L === 3) {
        const cx = -w / 2 + .95;
        cont(g, 1.8, .95, 1.2, cx, 0, 0, acc);
        cont(g, 1.8, .95, 1.2, cx, .95, 0, M(0x6b7280));
        front(g, .5, .4, winMat, cx - .4, .55, .03); front(g, .4, .8, M(0x4b5563), cx + .5, .42, .03);
        front(g, .5, .4, winMat, cx - .4, 1.5, .03); front(g, .5, .4, winMat, cx + .3, 1.5, .03);
        add(g, box(1.66, .34, .05, darkMat), cx, 2.1, -.3);
        add(g, sign(['СТРОЙДВОР'], T.accent, 1.6, .3), cx, 2.1, -.27);
        const fx0 = cx + 1.0, fx1 = w / 2;
        for (let x = fx0; x <= fx1 + .01; x += .4) add(g, box(.05, .9, .05, acc), x, .45, .05);
        [.3, .8].forEach(y => add(g, box(fx1 - fx0, .04, .04, acc), (fx0 + fx1) / 2, y, .05));
        [.3, .8].forEach(y => add(g, box(.04, .04, d, acc), fx1, y, -d / 2 + .05));
        excavator(g, fx0 + .7, -.9, T.accentHex);
        bricks(g, fx0 + .4, -2.0); bricks(g, fx1 - .5, -2.1);
        sandPile(g, fx1 - .5, -1.0);
        trafficCone(g, fx0 - .2, .55); trafficCone(g, fx0 + .3, .7);
        g.userData.top = 2.7; return g;
      }
      if (L === 4) {
        const ox = -w / 2 + .95;
        body(g, 1.9, h, 2.6, wall, ox);
        add(g, box(2.0, .12, 2.7, trim), ox, h + .06, -1.3);
        front(g, .55, 1.15, M(0x4b5563), ox + .5, .58); front(g, .6, .6, winMat, ox - .45, .9);
        roofSign(g, 'СТРОЙКОМПАНИЯ', T.accent, 1.9, h + .7, -.6, ox);
        [ox - .45, ox + .45].forEach(x => front(g, .6, .6, winMat, x, 2.4));
        add(g, box(1.94, .14, .08, acc), ox, h - .1, .04);
        towerCrane(g, w / 2 - .4, -2.2, 4.6, T.accentHex);
        bricks(g, .6, -1.9); sandPile(g, 1.4, -1.0);
        dumpTruck(g, .7, 1.0, T.accentHex);
        trafficCone(g, -w / 2 + .2, 1.6);
        g.userData.top = 5.4; return g;
      }
      const ox = -w / 2 + 1.1;
      add(g, box(2.0, h, 2.8, wall), ox, h / 2, -1.5);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) front(g, .5, .7, winMat, ox - .65 + c * .65, 1.8 + r * .95, -.088);
      front(g, 1.4, 1.1, winMat, ox, .7, -.088);
      [1.35, 2.3, 3.25, 4.2].forEach(y => add(g, box(2.16, .07, 2.96, whiteMat), ox, y, -1.5));
      [[-1, 0], [1, 0], [-1, -1], [1, -1]].forEach(([sx, sz]) => add(g, box(.1, h, .1, acc), ox + sx * 1.1, h / 2, sz * 3));
      const gl = box(2.2, h, 3.0, glassMat); gl.castShadow = false; gl.receiveShadow = false; add(g, gl, ox, h / 2, -1.5);
      roofSign(g, 'ДЕВЕЛОПЕР', T.accent, 2.0, h + .7, -1.4, ox);
      const fx = 1.4;
      [[-.7, -.4], [.7, -.4], [-.7, -2.4], [.7, -2.4]].forEach(([dx, z]) => add(g, box(.14, 3.9, .14, concreteMat), fx + dx, 1.95, z));
      [[.7, 2.4], [-.7, 2.4]].forEach(([dx]) => add(g, box(.14, .7, .14, concreteMat), fx + dx, 4.25, -.4));
      [1.3, 2.6, 3.9].forEach(y => add(g, box(1.6, .12, 2.2, concreteMat), fx, y, -1.4));
      for (let y = .65; y < 3.9; y += 1.3) add(g, box(1.65, .04, .04, M(0xd4a73a)), fx, y, -.25);
      towerCrane(g, w / 2 - .1, -2.9, 6.2, T.accentHex);
      mixerTruck(g, -.6, 1.45, T.accentHex);
      trafficCone(g, 1.0, 1.0); trafficCone(g, 1.6, .8);
      g.userData.top = 7.0; return g;
    }

    /* ---------- business types ---------- */
    const TYPES = {
      coffee: { name: 'Кофейня', sign: 'КОФЕЙНЯ', wall: 0x7a4e34, trim: 0x5a3826, accent: '#D4A73A', accentHex: 0xd4a73a, neon: '#FFB347', neonHex: 0xffb347, base: 169, minLevel: 1, build: buildCoffee,
        dims: [null, { w: 1.9, h: 1.4, d: 1.5 }, { w: 2.6, h: 2.0, d: 2.2 }, { w: 3, h: 3.3, d: 2.4 }, { w: 3.6, h: 3.6, d: 3 }, { w: 3.8, h: 5.4, d: 3 }],
        desc: ['', 'Киоск с чашкой на крыше и зонтиком', 'Кафе с полосатым навесом и цветами', 'Двухэтажное кафе с летней террасой', 'Угловая кофейня с неоновой чашкой', 'Обжарка: медные силосы и гигантская чашка на крыше'] },
      shop: { name: 'Магазин', sign: 'МАГАЗИН', wall: 0x2f4a6b, trim: 0x22364f, accent: '#6CB4EE', accentHex: 0x6cb4ee, neon: '#56C8FF', neonHex: 0x56c8ff, base: 86, minLevel: 1, build: buildShop,
        dims: [null, { w: 1.8, h: 1.3, d: 1.4 }, { w: 2.8, h: 2.1, d: 2.2 }, { w: 3.8, h: 2.4, d: 2.8 }, { w: 4.0, h: 3.4, d: 3.0 }, { w: 4.2, h: 5.6, d: 3.2 }],
        desc: ['', 'Ларёк с ящиками фруктов', 'Магазин у дома с витриной и тележками', 'Супермаркет со стеклянным фасадом', 'Сетевой магазин с логотипом на крыше и доставкой', 'Торговый центр со стеклянным атриумом и флагами'] },
      bakery: { name: 'Пекарня', sign: 'ПЕКАРНЯ', wall: 0xdcc6a0, trim: 0x6b4a2f, accent: '#F2C46B', accentHex: 0xf2c46b, neon: '#FF8F6B', neonHex: 0xff8f6b, base: 120, minLevel: 0, build: buildBakery,
        dims: [{ w: 3.6, h: 1.2, d: 2.6 }, { w: 1.8, h: 1.6, d: 1.4 }, { w: 2.6, h: 2.9, d: 2.2 }, { w: 3, h: 4.0, d: 2.4 }, { w: 3.8, h: 4.0, d: 2.6 }, { w: 4.2, h: 3.4, d: 3.2 }],
        desc: ['Участок продаётся · собрано 88%', 'Хлебный прилавок под черепичной крышей', 'Домик-пекарня с трубой и витриной', 'Дом-пекарня с террасой и кренделем', 'Пекарня-кафе с дровяной печью', 'Хлебозавод: трубы, силос и батон на крыше'] },
      market: { name: 'Магазин на маркетплейсе', sign: 'МАРКЕТ', wall: 0xb9bec8, trim: 0x3b2f5c, accent: '#A78BFA', accentHex: 0x8b5cf6, neon: '#C4B5FD', neonHex: 0xc4b5fd, base: 140, build: buildMarket,
        dims: [null, { w: 2.4, h: 1.6, d: 2.2 }, { w: 2.8, h: 2.2, d: 2.4 }, { w: 3.6, h: 2.6, d: 2.8 }, { w: 4.0, h: 3.2, d: 3.0 }, { w: 4.4, h: 3.5, d: 3.2 }],
        desc: ['Участок продаётся', 'Склад в гараже: коробки и ноутбук', 'Мини-склад с рольставней', 'Склад с рампой и конвейером', 'Фулфилмент-центр с неоновой вывеской', 'Логистический хаб: ангар и дрон-доставка'] },
      pvz: { name: 'Пункт выдачи заказов', sign: 'ПВЗ', wall: 0xe8e4dc, trim: 0x0f766e, accent: '#2DD4BF', accentHex: 0x14b8a6, neon: '#5EEAD4', neonHex: 0x5eead4, base: 60, build: buildPvz,
        dims: [null, { w: 1.9, h: 2.3, d: 1.0 }, { w: 2.2, h: 2.0, d: 1.8 }, { w: 3.0, h: 2.6, d: 2.4 }, { w: 3.4, h: 3.6, d: 2.6 }, { w: 4.2, h: 3.4, d: 3.2 }],
        desc: ['Участок продаётся', 'Постамат под навесом', 'Пункт выдачи в киоске', 'Пункт выдачи с полками посылок и постаматом', 'Двухэтажный ПВЗ и курьер на самокате', 'Сортировочный центр: конвейер и курьеры'] },
      ads: { name: 'Рекламное агентство', sign: 'РЕКЛАМА', wall: 0x2b2d3a, trim: 0x1a1b24, accent: '#F472B6', accentHex: 0xec4899, neon: '#F9A8D4', neonHex: 0xf9a8d4, base: 210, build: buildAds,
        dims: [null, { w: 1.8, h: 1.6, d: 1.4 }, { w: 2.6, h: 2.2, d: 2.0 }, { w: 3.0, h: 3.3, d: 2.4 }, { w: 3.4, h: 4.2, d: 2.8 }, { w: 3.6, h: 6.0, d: 3.0 }],
        desc: ['Участок продаётся', 'Будка с афишами, рупор и тумба', 'Студия с рекламной витриной', 'Агентство с LED-экраном', 'Медиаофис с гигантским экраном', 'Медиахолдинг с вращающимся билбордом'] },
      repair: { name: 'Ремонтная бригада', sign: 'РЕМОНТ', wall: 0x8a8f98, trim: 0x4b5563, accent: '#FB923C', accentHex: 0xf97316, neon: '#FDBA74', neonHex: 0xfdba74, base: 190, build: buildRepair,
        dims: [null, { w: 2.4, h: 1.5, d: 1.1 }, { w: 2.8, h: 2.0, d: 2.2 }, { w: 3.6, h: 2.2, d: 2.8 }, { w: 3.8, h: 3.0, d: 3.0 }, { w: 4.4, h: 5.4, d: 3.2 }],
        desc: ['Участок продаётся', 'Бытовка, конусы и песок', 'Мастерская с верстаком и кирпичами', 'Стройдвор с экскаватором', 'Стройкомпания с башенным краном', 'Девелопер: офис, стройка и бетономешалка'] }
    };
    Object.values(TYPES).forEach(T => { T.minLevel = 0; if (!T.desc[0]) T.desc[0] = 'Участок продаётся'; });

    function buildLot(){
      const g = new THREE.Group();
      add(g, box(3.6, .04, 2.6, M(0x3a3226)), 0, .02, -1.3);
      for (let x = -1.8; x <= 1.81; x += .6) add(g, box(.07, .6, .07, woodMat), x, .3, -.05);
      add(g, box(3.6, .05, .05, woodMat), 0, .45, -.05);
      add(g, box(3.6, .05, .05, woodMat), 0, .2, -.05);
      add(g, box(.05, .05, 2.6, woodMat), -1.8, .45, -1.3);
      add(g, box(.05, .05, 2.6, woodMat), 1.8, .45, -1.3);
      add(g, cyl(.04, .04, 1.6, darkMat, 6), 0, .8, -1.05);
      add(g, box(1.98, .9, .06, darkMat), 0, 1.72, -1.04);
      add(g, sign(['ПРОДАЁТСЯ', '88% собрано'], '#D4A73A', 1.9, .82), 0, 1.72, -1.005);
      g.userData.top = 2.6;
      return g;
    }
    function makeFor(type, L){
      const T = TYPES[type];
      if (L === 0) return buildLot();
      const g = T.build(T, L);
      const pw = T.dims[L].w + 1.4;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(pw, 2.0), poolMat);
      pl.rotation.x = -Math.PI / 2; pl.position.set(0, .135, 1.0); g.add(pl);
      return g;
    }
    function dimsFor(type, L){ return L === 0 ? { w: 3.6, h: 1.2, d: 2.6 } : TYPES[type].dims[L]; }
    function disposeGroup(g){ g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

    /* ---------- environment ---------- */
    const groundMat = M(0x1b2620), sideMat = M(0x3a3e48), roadMat = M(0x202227), curbMat = M(0x5a5f6b);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0x8d929b });
    const skylineMat = new THREE.MeshBasicMaterial({ color: 0x181c28 });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    add(scene, box(52, .05, 9, sideMat), 0, .025, -5.2);
    add(scene, box(64, .12, 2.2, sideMat), 0, .06, 1.1);
    const curbMesh = add(scene, box(64, .16, .12, curbMat), 0, .08, 2.2);
    add(scene, box(64, .04, 4, roadMat), 0, .02, 4.2);
    const dashes = [];
    for (let x = -32; x <= 32; x += 2) dashes.push(add(scene, box(1, .01, .12, dashMat), x, .045, 4.2));
    add(scene, box(64, .12, 1.4, sideMat), 0, .06, 6.9);

    /* background: a quiet back street of houses, then a hazy skyline */
    const bgMats = [];
    function bgMat(dayHex, roof){
      const m = M(dayHex);
      const night = new THREE.Color(dayHex).multiplyScalar(.28).lerp(new THREE.Color(0x1a2030), .35);
      bgMats.push({ m, day: new THREE.Color(dayHex), night, roof: !!roof });
      return m;
    }
    const bgWalls = [0xd9a38f, 0xe3cf9e, 0x9fb7c9, 0xb9c9a7, 0xe6ddd0, 0xc9a6b5].map(c => bgMat(c));
    const bgRoofs = [0x9c4a35, 0x4f5b66, 0x6b4a3a, 0x5d6f5a].map(c => bgMat(c, true));
    const bgFrame = bgMat(0xefe9df), bgPlinth = bgMat(0x6f6a66), bgRail = bgMat(0x3a3d44);
    const bgDoors = [bgMat(0x4a5d72), bgMat(0x6b3f2e), bgMat(0x3f5e4a)];
    const bgWinOn = new THREE.MeshBasicMaterial({ color: 0xffc66b });
    const bgWinOff = new THREE.MeshBasicMaterial({ color: 0x2b3140 });
    function nb(w, h, d, m){ const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.receiveShadow = true; return me; }
    function bgWindow(x, y, zf){
      add(scene, nb(.48, .56, .04, bgFrame), x, y, zf + .02);
      add(scene, panel(.36, .44, Math.random() < .35 ? bgWinOn : bgWinOff), x, y, zf + .045);
      add(scene, nb(.56, .05, .1, bgFrame), x, y - .3, zf + .05);
    }
    function bgHouse(x0, w, h, style){
      const d = 2.5, z = -8.6, zf = z + d / 2, cx = x0 + w / 2;
      const wall = pick(bgWalls), roof = pick(bgRoofs);
      add(scene, nb(w, h, d, wall), cx, h / 2, z);
      add(scene, nb(w + .04, .45, .06, bgPlinth), cx, .225, zf + .03);
      const floors = Math.max(2, Math.floor((h - .4) / 1.05)), cols = w < 2.6 ? 2 : 3;
      const doorCol = Math.floor(rand(0, cols));
      for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
        const x = x0 + (c + .5) * w / cols, y = .95 + f * 1.05;
        if (f === 0 && c === doorCol) {
          const door = pick(bgDoors);
          add(scene, nb(1.0, .12, .5, bgPlinth), x, .06, zf + .25);
          add(scene, nb(1.0, .12, .28, bgPlinth), x, .18, zf + .14);
          add(scene, nb(.8, 1.14, .04, bgFrame), x, .87, zf + .02);
          add(scene, panel(.32, 1.0, door), x - .17, .87, zf + .045);
          add(scene, panel(.32, 1.0, door), x + .17, .87, zf + .045);
          add(scene, nb(1.1, .07, .62, roof), x, 1.55, zf + .31);
          add(scene, nb(.04, .3, .04, bgRail), x - .5, 1.38, zf + .58);
          add(scene, nb(.04, .3, .04, bgRail), x + .5, 1.38, zf + .58);
          add(scene, new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 5), bulbMat), x, 1.45, zf + .08);
          glow(x, 1.45, zf + .12, .7);
          add(scene, nb(.12, .18, .03, bgRail), x + .52, .95, zf + .02);
        } else {
          bgWindow(x, y, zf);
          if (style === 'flat' && f > 0 && c === Math.floor(cols / 2)) {
            add(scene, nb(.8, .06, .4, bgFrame), x, y - .38, zf + .2);
            add(scene, nb(.8, .3, .03, bgRail), x, y - .22, zf + .39);
          }
        }
      }
      if (style === 'gable') {
        add(scene, gable(w + .15, d + .15, .9, roof), cx, h, zf + .075);
        add(scene, new THREE.Mesh(new THREE.CircleGeometry(.17, 14), Math.random() < .5 ? bgWinOn : bgWinOff), cx, h + .33, zf + .08);
        add(scene, nb(.28, .7, .28, bgPlinth), cx + w * .25, h + .55, z - .3);
      } else if (style === 'flat') {
        add(scene, nb(w + .2, .18, d + .2, bgFrame), cx, h + .09, z);
        add(scene, nb(w + .2, .22, .1, wall), cx, h + .29, zf + .05);
      } else {
        add(scene, eaveRoof(w + .2, d + .2, .85, roof), cx, h, z);
        add(scene, nb(.7, .5, .6, wall), cx, h + .3, zf - .5);
        add(scene, gable(.85, .7, .35, roof), cx, h + .55, zf - .15);
        add(scene, panel(.3, .3, Math.random() < .5 ? bgWinOn : bgWinOff), cx, h + .3, zf - .19);
      }
    }
    for (let x = -25; x < 25;) {
      const w = rand(2.2, 3.4), h = rand(3.1, 5.1);
      bgHouse(x, w, h, pick(['gable', 'flat', 'eave']));
      x += w + rand(.15, .45);
    }
    /* promenade along the back houses */
    const pathMat = bgMat(0xcdbfa8, true);
    add(scene, nb(54, .06, 1.2, pathMat), 0, .06, -6.6);
    add(scene, nb(54, .09, .08, bgPlinth), 0, .07, -5.98);
    for (let x = -21; x <= 21; x += 6) {
      add(scene, cyl(.035, .045, 1.5, darkMat, 6), x, .8, -6.05);
      add(scene, new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), bulbMat), x, 1.6, -6.05);
      glow(x, 1.6, -6.0, 1.0); pool(x, -6.45, 2.8, .1);
    }
    [-9.6, 1.6, 10.6].forEach(x => {
      const b = new THREE.Group();
      add(b, nb(1.1, .08, .35, bgDoors[1]), 0, .42, 0);
      add(b, nb(1.1, .3, .06, bgDoors[1]), 0, .66, .16);
      add(b, nb(.06, .4, .3, bgRail), -.48, .2, 0); add(b, nb(.06, .4, .3, bgRail), .48, .2, 0);
      b.position.set(x, .06, -6.12); scene.add(b);
    });
    const bushMats = [M(0x3f8f5a), M(0x4f9a62), M(0x356f48)];
    for (let x = -24; x < 24; x += rand(1.6, 2.6)) {
      if (Math.random() < .25) continue;
      const n = 2 + Math.floor(rand(0, 2));
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(.28, .46), 1), pick(bushMats));
        b.castShadow = true; b.receiveShadow = true; b.scale.y = rand(.75, .95);
        b.position.set(x + i * rand(.35, .5), rand(.22, .3), -4.75 + rand(-.15, .15)); scene.add(b);
      }
      if (Math.random() < .35) for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(.06, 5, 4), M(pick([0xe07a9a, 0xffffff, 0xf2c46b])));
        f.position.set(x + rand(0, .8), rand(.42, .56), -4.55 + rand(-.1, .1)); scene.add(f);
      }
    }
    const farWins = new THREE.Group(); scene.add(farWins);
    const farWinMat = new THREE.MeshBasicMaterial({ color: 0x6b5a3a });
    for (let x = -30; x < 30;) {
      const w = rand(2.4, 4.2), h = rand(6, 13);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), skylineMat);
      const z = rand(-21, -18);
      b.position.set(x + w / 2, h / 2, z); scene.add(b);
      for (let i = 0; i < 4; i++) {
        const p = panel(.3, .3, farWinMat);
        p.position.set(x + rand(.4, w - .4), rand(2, h - 1), z + 1.51); farWins.add(p);
      }
      x += w + rand(.3, 1.2);
    }
    [-22, -17.5, -13.5, -9, -4.5, 4.5, 9, 13.5, 17.5, 22].forEach(x => { const t = tree(); t.position.set(x + rand(-.4, .4), 0, -5.45); t.scale.setScalar(rand(1, 1.3)); scene.add(t); });

    const LAMPS = [-21, -15, -9, -3, 3, 9, 15, 21];
    LAMPS.forEach(x => {
      add(scene, cyl(.05, .07, 2.6, darkMat, 6), x, 1.3, 2.05);
      add(scene, box(.5, .05, .05, darkMat), x - .2, 2.6, 2.05);
      add(scene, new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), bulbMat), x - .42, 2.5, 2.05);
      glow(x - .42, 2.5, 2.1, 1.6);
      pool(x - .42, 2.0, 4.2);
    });


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
    const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xf4f8ff, size: 2 * renderer.getPixelRatio(), sizeAttenuation: false, transparent: true, opacity: .45, depthWrite: false }));
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

    /* ---------- district decor ---------- */
    const DM = { stone: M(0x9a968e), garage: M(0x6b6f78), garageDoor: M(0x4a4e57), tire: M(0x1a1a1a), weed: M(0x6b7a3a), bench: M(0x6b4a2f), dry: M(0x5a4a3a), stripe: M(0xe8e8e8) };
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x5fb7e8, transparent: true, opacity: .8 });
    function garage(x, z){
      const g = new THREE.Group();
      add(g, box(2.2, 1.5, 2.4, DM.garage), 0, .75, -1.2);
      add(g, box(2.3, .1, 2.5, M(0x55585f)), 0, 1.55, -1.2);
      front(g, 1.7, 1.2, DM.garageDoor, 0, .6);
      for (let i = 0; i < 5; i++) add(g, box(1.7, .03, .02, M(0x5a5f6b)), 0, .15 + i * .24, .02);
      g.position.set(x, 0, z); return g;
    }
    function tireStack(x, z){
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(.28, .11, 6, 12), DM.tire); t.rotation.x = Math.PI / 2; t.castShadow = true; add(g, t, rand(-.04, .04), .23 + i * .2, 0); }
      g.position.set(x, 0, z); return g;
    }
    function weeds(x, z){
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) add(g, cone(.08, .35, DM.weed, 5), rand(-.3, .3), .29, rand(-.2, .2));
      g.position.set(x, 0, z); return g;
    }
    function pothole(x, z){
      const m = new THREE.Mesh(new THREE.CircleGeometry(rand(.25, .45), 10), M(0x1d1912));
      m.rotation.x = -Math.PI / 2; m.position.set(x, .043, z); return m;
    }
    function dryTree(x, z){
      const g = new THREE.Group();
      add(g, cyl(.06, .1, 1.6, DM.dry, 6), 0, .8, 0);
      [[.5, .3], [-.6, -.4], [.3, 2.4]].forEach(([r, ry]) => { const b = cyl(.025, .04, .7, DM.dry, 5); b.rotation.z = r; b.rotation.y = ry; add(g, b, 0, 1.3, 0); });
      g.position.set(x, 0, z); return g;
    }
    function bench(x, z, ry){
      const g = new THREE.Group();
      add(g, box(1.1, .08, .35, DM.bench), 0, .42, 0);
      add(g, box(1.1, .3, .06, DM.bench), 0, .66, -.16);
      add(g, box(.06, .4, .3, darkMat), -.48, .2, 0); add(g, box(.06, .4, .3, darkMat), .48, .2, 0);
      g.rotation.y = ry || 0; g.position.set(x, .12, z); return g;
    }
    function flowerBed(x, z){
      const g = new THREE.Group();
      add(g, box(1.2, .25, .5, M(0x55585f)), 0, .125, 0);
      for (let i = 0; i < 7; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), M(pick([0xe07a9a, 0xf2c46b, 0xffffff, 0xd63c3c])));
        add(g, f, -.5 + i * (1 / 6), .3, rand(-.12, .12));
      }
      g.position.set(x, .12, z); return g;
    }
    let fountainJet = null;
    function fountain(x, z){
      const g = new THREE.Group();
      add(g, cyl(1.0, 1.05, .35, DM.stone, 16), 0, .3, 0);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .04, 16), waterMat); add(g, w, 0, .48, 0);
      add(g, cyl(.1, .14, .9, DM.stone, 8), 0, .9, 0);
      add(g, cyl(.42, .3, .12, DM.stone, 12), 0, 1.35, 0);
      fountainJet = new THREE.Mesh(new THREE.ConeGeometry(.16, .7, 8), waterMat); add(g, fountainJet, 0, 1.75, 0);
      g.position.set(x, .12, z); return g;
    }
    function garland(x1, x2, z){
      const g = new THREE.Group();
      const cols = [0xffd36b, 0xff8f6b, 0x6cb4ee, 0x7be0a6];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const b = new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 5), new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
        add(g, b, x1 + (x2 - x1) * t, 2.5 - Math.sin(t * Math.PI) * .45, z);
      }
      return g;
    }
    function billboard(lines, color, x, z){
      const g = new THREE.Group();
      add(g, cyl(.06, .06, 3, darkMat, 6), -1.2, 1.5, 0); add(g, cyl(.06, .06, 3, darkMat, 6), 1.2, 1.5, 0);
      add(g, box(3.2, 1.3, .1, darkMat), 0, 3.4, 0);
      add(g, sign(lines, color, 3.1, 1.2), 0, 3.4, .06);
      g.rotation.y = .25; g.position.set(x, 0, z); return g;
    }
    function crossing(x){
      const g = new THREE.Group();
      for (let i = 0; i < 7; i++) add(g, box(1.8, .012, .3, DM.stripe), x, .047, 2.5 + i * .6);
      return g;
    }
    let decor = new THREE.Group(); scene.add(decor);
    function buildDecor(k){
      scene.remove(decor); disposeGroup(decor); fountainJet = null;
      decor = new THREE.Group();
      dashes.forEach(m => { m.visible = k > 0; });
      curbMesh.visible = k > 0;
      if (k === 0) {
        decor.add(garage(-24.6, -.4), garage(24.6, -.4), tireStack(22.6, .8));
        decor.add(weeds(-10.2, 1.0), weeds(9.4, 6.9), weeds(-4.1, 7.0), weeds(1.6, 1.9), weeds(-19, 6.9), weeds(16.5, 1.0));
        decor.add(pothole(-6, 3.9), pothole(4, 5.1), pothole(10, 3.4), pothole(-1.5, 4.6), pothole(-16, 5.0), pothole(18, 3.8));
        decor.add(dryTree(-3, 7.1), dryTree(6.5, 7.1), dryTree(-14, 7.1));
        decor.add(billboard(['РЕКЛАМА', 'место свободно'], '#9EA3AD', -22.6, 1.0));
      } else {
        const treeXs = k === 2 ? [-21, -16.5, -12, -7.5, -3, 1.5, 6, 10.5, 15, 19.5] : [-20, -13, -3, 3.2, 10.5, 17];
        treeXs.forEach(x => { const t = tree(); t.position.set(x, .12, 7.2); decor.add(t); });
        decor.add(bench(-6.5, 6.95, Math.PI), bench(6.6, 6.95, Math.PI), bench(-15, 6.95, Math.PI), bench(15, 6.95, Math.PI));
        decor.add(billboard(['КОФЕЙНЯ', 'латте −10% до 18:00'], '#D4A73A', -22.6, 1.0));
        if (k === 2) {
          decor.add(crossing(3));
          for (let i = 0; i < LAMPS.length - 1; i++) decor.add(garland(LAMPS[i] - .42, LAMPS[i + 1] - .42, 2.05));
          decor.add(flowerBed(-16, 6.9), flowerBed(-8, 6.9), flowerBed(1, 6.9), flowerBed(9.2, 6.9), flowerBed(17, 6.9));
          decor.add(fountain(24.2, 1.0));
        }
      }
      scene.add(decor);
    }

    /* ---------- slots ---------- */
    const slots = [
      { type: 'market', x: -18, level: 3 },
      { type: 'pvz', x: -12, level: 2 },
      { type: 'coffee', x: -6, level: 2 },
      { type: 'shop', x: 0, level: 2 },
      { type: 'bakery', x: 6, level: 0 },
      { type: 'ads', x: 12, level: 3 },
      { type: 'repair', x: 18, level: 4 }
    ];
    slots.forEach(s => { s.group = makeFor(s.type, s.level); s.group.position.x = s.x; scene.add(s.group); s.busy = false; });

    /* ---------- tweens ---------- */
    const tweens = [];
    function tween(dur, fn, done){ tweens.push({ t: 0, dur, fn, done }); }
    const easeOutBack = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

    function scaffold(D){
      const g = new THREE.Group();
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(D.w + .2, D.h, D.d + .2)), new THREE.LineBasicMaterial({ color: 0xd4a73a }));
      edges.position.set(0, D.h / 2, -D.d / 2); g.add(edges);
      for (let y = .8; y < D.h; y += .8) add(g, box(D.w + .3, .05, .25, woodMat), 0, y, .15);
      const mastH = D.h + 2;
      const yellow = M(0xd4a73a);
      add(g, box(.2, mastH, .2, yellow), D.w / 2 + .7, mastH / 2, -D.d / 2);
      const arm = new THREE.Group(); arm.position.set(D.w / 2 + .7, mastH, -D.d / 2);
      const a = box(3.2, .16, .16, yellow); a.position.x = -1.1; arm.add(a);
      const hook = box(.04, 1, .04, darkMat); hook.position.set(-2.3, -.5, 0); arm.add(hook);
      g.add(arm); g.userData.arm = arm;
      return g;
    }
    const puffGeo = new THREE.SphereGeometry(1, 7, 5);
    function puff(x, y, z, color, size, rise, life){
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .5, depthWrite: false });
      const s = new THREE.Mesh(puffGeo, m); s.scale.setScalar(size); s.position.set(x, y, z); scene.add(s);
      const drift = rand(.2, .5);
      tween(life, p => { s.position.y = y + p * rise; s.position.x = x + p * drift; s.scale.setScalar(size * (1 + p * 1.6)); m.opacity = .5 * (1 - p); },
        () => { scene.remove(s); m.dispose(); });
    }
    function dust(x){
      for (let i = 0; i < 14; i++) puff(x + rand(-2, 2), .2, rand(-2.4, .6), 0x9a948a, .18, .8, 1.1);
    }

    function setLevel(slot, L){
      if (slot.busy || L === slot.level) return;
      const up = L > slot.level;
      slot.busy = true; refreshUI();
      const old = slot.group;
      const finish = () => { slot.busy = false; refreshUI(); };
      const build = (grow) => {
        const ng = makeFor(slot.type, L); ng.position.x = slot.x; scene.add(ng);
        slot.group = ng; slot.level = L; refreshUI();
        if (!grow) { finish(); return; }
        ng.scale.set(.9, .01, .9);
        tween(reduce ? .2 : .7, p => { const e = reduce ? p : easeOutBack(p); ng.scale.set(.9 + .1 * p, Math.max(.01, e), .9 + .1 * p); }, finish);
      };
      if (!up || reduce) { scene.remove(old); disposeGroup(old); build(!reduce); return; }
      tween(.35, p => { old.scale.y = Math.max(.01, 1 - p); }, () => {
        scene.remove(old); disposeGroup(old);
        const sc = scaffold(dimsFor(slot.type, L)); sc.position.x = slot.x; sc.scale.y = .01; scene.add(sc);
        tween(.5, p => { sc.scale.y = Math.max(.01, p); });
        dust(slot.x);
        tween(1.5, p => { sc.userData.arm.rotation.y = p * Math.PI * 1.1; }, () => {
          scene.remove(sc); disposeGroup(sc); build(true);
        });
      });
    }

    /* ---------- coins ---------- */
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
    function spawnCoin(){
      const open = slots.filter(s => s.level > 0 && !s.busy);
      if (!open.length) return;
      const s = pick(open), T = TYPES[s.type];
      const amount = Math.round(T.base * (.8 + .35 * s.level) * rand(1, 1.6));
      const sp = coinSprite(amount);
      const y0 = s.group.userData.top;
      sp.position.set(s.x, y0, .3); scene.add(sp);
      tween(1.5, p => { sp.position.y = y0 + p * 1.3; sp.material.opacity = p < .6 ? 1 : 1 - (p - .6) / .4; },
        () => { scene.remove(sp); sp.userData.dispose(); });
    }

    /* ---------- day / night ---------- */
    const btnDay = document.getElementById('btn-day'), btnNight = document.getElementById('btn-night');
    const hour = new Date().getHours();
    const env = { day: hour >= 7 && hour < 19, district: 1, weather: 'clear' };
    function applyEnv(){
      const day = env.day, k = env.district, wx = env.weather;
      const isRain = wx === 'rain', isSnow = wx === 'snow';
      let sky = day ? 0x9cc8ea : 0x10131d;
      if (isRain) sky = day ? 0x7f8e9e : 0x0b0d13;
      if (isSnow) sky = day ? 0xc9d5e0 : 0x161a24;
      scene.background.set(sky); scene.fog.color.set(sky);
      hemi.intensity = (day ? .78 : .46) * (isRain ? .75 : 1);
      hemi.color.set(day ? 0xdfefff : 0x6f7fb0); hemi.groundColor.set(day ? 0x6b5a45 : 0x1a1a22);
      dir.intensity = (day ? 1.0 : .3) * (isRain ? .55 : 1); dir.color.set(day ? 0xfff1d6 : 0x9fb0ff);
      winMat.color.set(day ? 0x9cc3e0 : 0x2a2a30); winMat.emissiveIntensity = day ? 0 : 1;
      glowMat.visible = !day; poolMat.visible = !day;
      bulbMat.color.set(day ? 0xd8d8d0 : 0xffe08a);
      groundMat.color.set(isSnow ? (day ? 0xe9eef3 : 0x5b6272) : (day ? 0x6f8f57 : 0x1b2620));
      if (isSnow) sideMat.color.set(day ? 0xdfe4ea : 0x4e5462);
      else if (k === 0) sideMat.color.set(day ? 0x8a8478 : 0x34322e);
      else if (k === 2) sideMat.color.set(day ? 0xcfc4b2 : 0x45403a);
      else sideMat.color.set(day ? 0xb7bac0 : 0x3a3e48);
      roadMat.color.set(k === 0 ? (day ? 0x7a6650 : 0x2e281f) : (day ? 0x4a4d55 : 0x202227));
      if (isRain) roadMat.color.multiplyScalar(.72);
      roadMat.roughness = isRain ? .25 : .85; roadMat.metalness = isRain ? .15 : 0;
      roofMat.color.set(isSnow ? 0xeef2f6 : 0xa8492f);
      skylineMat.color.set(day ? (isRain ? 0x8794a2 : isSnow ? 0xb4c2cf : 0xa9bccf) : 0x161a25);
      bgMats.forEach(b => {
        if (b.roof && isSnow) { b.m.color.set(day ? 0xe6ebf0 : 0x6a7282); return; }
        b.m.color.copy(day ? b.day : b.night);
        if (isRain) b.m.color.multiplyScalar(.82);
      });
      bgWinOn.color.set(day ? 0x8fa7bd : 0xe8b45e); bgWinOff.color.set(day ? 0x8fa7bd : 0x2b3140);
      farWins.visible = !day;
      snow.material.opacity = day ? .4 : .35;
      clouds.forEach(c => { c.visible = day; });
      cloudMat.color.set(isRain ? 0x9aa3ad : 0xffffff); cloudMat.emissive.set(isRain ? 0x6a727c : 0xffffff);
      rain.visible = isRain; snow.visible = isSnow;
      walkers.forEach(w => { w.um.visible = isRain; });
      btnDay.setAttribute('aria-pressed', String(day)); btnNight.setAttribute('aria-pressed', String(!day));
      [0, 1, 2].forEach(i => document.getElementById('dist-' + i).setAttribute('aria-pressed', String(i === k)));
      ['clear', 'rain', 'snow'].forEach(n => document.getElementById('wx-' + n).setAttribute('aria-pressed', String(n === wx)));
    }
    btnDay.addEventListener('click', () => { env.day = true; applyEnv(); });
    btnNight.addEventListener('click', () => { env.day = false; applyEnv(); });
    [0, 1, 2].forEach(i => document.getElementById('dist-' + i).addEventListener('click', () => {
      if (env.district === i) return; env.district = i; buildDecor(i); applyEnv();
    }));
    ['clear', 'rain', 'snow'].forEach(n => document.getElementById('wx-' + n).addEventListener('click', () => { env.weather = n; applyEnv(); }));
    buildDecor(env.district);
    applyEnv();

    /* ---------- UI rows ---------- */
    const slotsEl = document.getElementById('slots');
    slots.forEach(s => {
      const T = TYPES[s.type];
      const row = document.createElement('div'); row.className = 'slot';
      const head = document.createElement('div'); head.className = 'slot-head';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = T.accent;
      const title = document.createElement('div'); title.className = 'slot-title';
      const nm = document.createElement('div'); nm.className = 'slot-name'; nm.textContent = T.name;
      const ds = document.createElement('div'); ds.className = 'slot-desc';
      title.append(nm, ds);
      const lv = document.createElement('span'); lv.className = 'lvl';
      head.append(dot, title, lv);
      const ctrl = document.createElement('div'); ctrl.className = 'slot-ctrl';
      const chips = document.createElement('div'); chips.className = 'chips'; chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Уровень: ' + T.name);
      const chipBtns = [];
      for (let L = T.minLevel; L <= 5; L++) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.id = 'lvl-' + s.type + '-' + L;
        b.textContent = L === 0 ? 'Участок' : String(L);
        b.setAttribute('aria-label', L === 0 ? 'Пустой участок' : 'Уровень ' + L);
        b.addEventListener('click', () => setLevel(s, L));
        chips.append(b); chipBtns.push({ b, L });
      }
      const upBtn = document.createElement('button'); upBtn.type = 'button'; upBtn.className = 'up'; upBtn.id = 'up-' + s.type;
      upBtn.addEventListener('click', () => { if (s.level < 5) setLevel(s, s.level + 1); });
      ctrl.append(chips, upBtn);
      row.append(head, ctrl);
      slotsEl.append(row);
      s.ui = { row, ds, lv, chipBtns, upBtn };
    });
    function refreshUI(){
      slots.forEach(s => {
        const T = TYPES[s.type], u = s.ui;
        u.ds.textContent = T.desc[s.level];
        u.lv.textContent = s.level ? 'Ур. ' + s.level : 'Не открыт';
        u.chipBtns.forEach(({ b, L }) => { b.setAttribute('aria-pressed', String(L === s.level)); b.disabled = s.busy; });
        u.upBtn.disabled = s.busy || s.level >= 5;
        u.upBtn.textContent = s.busy ? 'Строим…' : s.level === 0 ? 'Открыть' : s.level >= 5 ? 'Максимум' : 'Улучшить';
      });
    }
    refreshUI();
    function flashRow(s){
      s.ui.row.classList.add('flash');
      s.ui.row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
      setTimeout(() => s.ui.row.classList.remove('flash'), 900);
    }

    /* ---------- touch controls: pan, pinch, wheel, tap ---------- */
    const pointers = new Map();
    let down = null, pinch = null, lastTap = 0;
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function zoomTo(z){ camera.zoom = clamp(z, .7, 2.4); camera.updateProjectionMatrix(); }
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) down = { x: e.clientX, y: e.clientY, moved: 0 };
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: camera.zoom };
        if (down) down.moved = 99;
      }
    });
    canvas.addEventListener('pointermove', e => {
      const prev = pointers.get(e.pointerId); if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY }; pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        const dx = cur.x - prev.x, dy = cur.y - prev.y;
        if (down) down.moved += Math.abs(dx) + Math.abs(dy);
        const wpp = (camera.right - camera.left) / camera.zoom / stage.clientWidth;
        target.x = clamp(target.x - dx * wpp, -18, 18);
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = Array.from(pointers.values());
        zoomTo(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist);
      }
    });
    function endPointer(e){
      if (!pointers.has(e.pointerId)) return;
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasSingle && down && down.moved < 8 && e.type === 'pointerup') {
        const now = performance.now();
        if (now - lastTap < 320) { target.copy(HOME); zoomTo(1); lastTap = 0; }
        else {
          lastTap = now;
          const r = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          raycaster.setFromCamera(ndc, camera);
          const hits = raycaster.intersectObjects(slots.map(s => s.group), true);
          if (hits.length) {
            const o = hits[0].object;
            const s = slots.find(sl => { let p = o; while (p) { if (p === sl.group) return true; p = p.parent; } return false; });
            if (s) flashRow(s);
          }
        }
      }
      if (pointers.size === 0) down = null;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoomTo(camera.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });

    /* ---------- loop ---------- */
    let last = performance.now(), clock = 0, coinT = 0, smokeT = 0, visible = true;
    function frame(){
      const now = performance.now();
      const dt = Math.min(.05, (now - last) / 1000); last = now; clock += dt;
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i]; tw.t += dt; const p = Math.min(1, tw.t / tw.dur);
        tw.fn(p);
        if (p >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); }
      }
      if (!reduce) {
        walkers.forEach(w => {
          w.g.position.x += w.dir * w.speed * dt;
          if (w.g.position.x > w.lim) w.g.position.x = -w.lim; if (w.g.position.x < -w.lim) w.g.position.x = w.lim;
          w.g.position.y = w.y0 + Math.abs(Math.sin(clock * 7 + w.phase)) * .05;
        });
        dog.position.set(dogOwner.g.position.x + dogOwner.dir * .75, .06 + Math.abs(Math.sin(clock * 11)) * .04, dogOwner.g.position.z + .3);
        dog.rotation.y = dogOwner.dir > 0 ? 0 : Math.PI;
        cars.forEach(c => {
          c.g.position.x += c.dir * c.speed * dt;
          if (c.g.position.x > 27) c.g.position.x = -27; if (c.g.position.x < -27) c.g.position.x = 27;
        });
        if (rain.visible) {
          for (let i = 0; i < RN; i++) {
            const o = i * 6; rainPos[o + 1] -= 13 * dt; rainPos[o + 4] -= 13 * dt;
            if (rainPos[o + 4] < 0) { const y = 12 + Math.random() * 2; rainPos[o + 1] = y; rainPos[o + 4] = y - .45; }
          }
          rainGeo.attributes.position.needsUpdate = true;
        }
        if (snow.visible) {
          for (let i = 0; i < SN; i++) {
            const o = i * 3; snowPos[o + 1] -= .7 * dt; snowPos[o] += Math.sin(clock * 1.2 + i) * .2 * dt;
            if (snowPos[o + 1] < 0) snowPos[o + 1] = 10;
          }
          snowGeo.attributes.position.needsUpdate = true;
        }
        clouds.forEach((c, i) => { c.position.x += (.25 + i * .05) * dt; if (c.position.x > 32) c.position.x = -32; });
        if (fountainJet) fountainJet.scale.y = 1 + .18 * Math.sin(clock * 6);

        if (vanState.mode === 'idle') {
          vanState.t -= dt;
          if (vanState.t <= 0) {
            const open = slots.filter(s => s.level > 0 && !s.busy);
            if (open.length) { vanState.target = pick(open); dv.position.x = -28; vanState.mode = 'in'; }
            else vanState.t = 3;
          }
        } else if (vanState.mode === 'in') {
          dv.position.x += 4 * dt;
          if (dv.position.x >= vanState.target.x - .2) {
            dv.position.x = vanState.target.x - .2; vanState.mode = 'stop'; vanState.t = 2.4;
            const lb = labelSprite(VAN_LABEL[vanState.target.type] || 'Склад пополнен'); const y0 = 1.6;
            lb.position.set(dv.position.x, y0, 2.75); scene.add(lb);
            tween(2.2, p => { lb.position.y = y0 + p * .8; lb.material.opacity = p < .7 ? 1 : 1 - (p - .7) / .3; },
              () => { scene.remove(lb); lb.userData.dispose(); });
          }
        } else if (vanState.mode === 'stop') {
          vanState.t -= dt; if (vanState.t <= 0) vanState.mode = 'out';
        } else {
          dv.position.x += 4 * dt;
          if (dv.position.x > 28) { dv.position.x = -30; vanState.mode = 'idle'; vanState.t = rand(7, 11); }
        }

        smokeT += dt;
        if (smokeT > .5) {
          smokeT = 0;
          slots.forEach(s => {
            if (s.busy) return;
            (s.group.userData.smoke || []).forEach(e => {
              if (e.kind === 'steam') puff(s.x + e.x, e.y, e.z, 0xf2f2f4, .1, .9, 1.6);
              else puff(s.x + e.x, e.y, e.z, 0x8f8a86, .16, 1.6, 2.4);
            });
          });
        }
      }
      slots.forEach(s => (s.group.userData.anims || []).forEach(fn => fn(clock, dt)));
      slots.forEach(s => (s.group.userData.flicker || []).forEach((m, i) => {
        m.color.setRGB(1, .42 + .1 * Math.sin(clock * 11 + i * 2) + .05 * Math.sin(clock * 23), .12);
      }));
      coinT += dt;
      if (coinT > (reduce ? 3.2 : 1.6)) { coinT = 0; spawnCoin(); }
      placeCamera();
      renderer.render(scene, camera);
    }
    function setRunning(on){ renderer.setAnimationLoop(on ? frame : null); if (on) last = performance.now(); }
    setRunning(true);
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; setRunning(visible && !document.hidden); }).observe(stage);
    document.addEventListener('visibilitychange', () => setRunning(visible && !document.hidden));
  }
})();
