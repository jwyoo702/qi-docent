/* =====================================================================
   World — first-person 3D museum (National Museum of Korea, 1F, simplified)
   Layout follows the official floor map (leaflet 2026-07-20):
   entrance → great hall ("history road") → right wing:
   101 Paleolithic → 102 Neolithic → 103 Bronze Age → 104 Gojoseon·Buyeo·Samhan
   → 105 Goguryeo → 106 Baekje → 107 Gaya → 108-110 Silla
   Looks: /museum background (great hall + galleries) and /박물관 배경 (Goguryeo = dark room with backlit stele rubbings,
   Baekje = bright white room with a big chimi, Silla = warm wood floor with hexagonal vitrines).
   Free-browsing exhibits come from exhibits.js (photos in assets/exhibits). Scenario artifacts are the 5 "stations".
   Uses the globals of the phone app (S, ART, EXH, setNear, t, L, ...).  x = east, -z = north.   Disable with ?world=0
   ===================================================================== */
import * as THREE from './vendor/three/three.module.js';

(function init() {
  const q = new URLSearchParams(location.search);
  if (q.get('world') === '0' || innerWidth <= 900) return;
  const canvas = document.getElementById('world');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { console.warn('WebGL unavailable → plain phone mode', e); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

  S.world = true; document.body.classList.add('world'); fit(); $('#hud').style.display = 'block';

  /* ------------------------------------------------------------ layout constants */
  const H = 5, HH = 11, EYE = 1.62, ZE = -152;                      // wing ceiling / great-hall ceiling / eye height / far end
  const HALL = { x0: -14, x1: 8, z0: ZE, z1: 8 }, WING = { x0: 8, x1: 32, z0: ZE, z1: -10 };
  const ROOMS = [
    { no: '101-102', ko: '구석기·신석기', en: 'Paleolithic · Neolithic', z0: -12, z1: -22, theme: 'dark' },
    { no: '103', ko: '청동기', en: 'Bronze Age', z0: -22, z1: -27, theme: 'dark' }, { no: '104', ko: '고조선·부여·삼한', en: 'Gojoseon · Buyeo · Samhan', z0: -27, z1: -32, theme: 'dark' },
    { no: '105', key: 'gogu', z0: -32, z1: -64, theme: 'gogu' }, { no: '106', key: 'baek', z0: -64, z1: -96, theme: 'baek' },
    { no: '107', key: 'gaya', z0: -96, z1: -112, theme: 'dark' }, { no: '108-110', key: 'silla', z0: -112, z1: ZE, theme: 'silla' } ];
  const OPEN = [[-22, -12], [-110, -98], [-125, -113]];  // openings in the hall/wing wall (z ranges) — kept clear of the wall cases
  const DIV = ROOMS.slice(1).map(r => r.z0);                         // room dividers (8 m doorway in the middle)
  const SIGNS = ROOMS;
  const STN = { gogu: { x: 27, z: -40 }, baek: { x: 13, z: -70 }, absent: { x: 27, z: -72 }, gaya: { x: 27, z: -104 }, silla: { x: 14, z: -120 } };
  const STAND = { gogu: [22.5, -37], baek: [17.5, -67], absent: [22.5, -69], gaya: [22.5, -101], silla: [19.5, -117] };
  const SPINE = [[0, 3], [0, -16], [20, -16], [20, -37], [20, -69], [20, -101], [20, -117]];
  const ART_Y = 1.9;

  /* ------------------------------------------------------------ scene, environment */
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#1a1a1b'); scene.fog = new THREE.Fog('#2a2927', 36, 170);
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 260);
  { const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene(); env.background = new THREE.Color('#6d6a66');
    const panel = (c, w, h, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    panel('#ffffff', 30, 30, 0, 14, 0, Math.PI / 2, 0); panel('#ffe9c8', 16, 8, -16, 5, 0, 0, Math.PI / 2); panel('#dfe8f5', 16, 8, 16, 5, 0, 0, Math.PI / 2);
    scene.environment = pm.fromScene(env, 0.03).texture; pm.dispose(); }
  scene.add(new THREE.HemisphereLight('#fff4e4', '#8d8478', 1.1)); const sun = new THREE.DirectionalLight('#fff3dc', 1.4); sun.position.set(-8, 30, -20); scene.add(sun);
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .85, metalness: 0 }, o));
  const BLACK = mat('#17181a', { roughness: .45 }), TRIM = mat('#3a3b3e', { roughness: .4, metalness: .3 }), WHITEF = mat('#f1f1ef', { roughness: .5 });
  const GLASS = new THREE.MeshStandardMaterial({ color: '#cfe4f2', transparent: true, opacity: .13, roughness: .04, metalness: .1, depthWrite: false });
  const GLOW = new THREE.MeshBasicMaterial({ color: '#fff0d2' }), WARMGLOW = new THREE.MeshBasicMaterial({ color: '#ffd9a8' });
  const add = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); return m; };
  const box = (w, h, d, x, y, z, m) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);
  const texLoader = new THREE.TextureLoader();
  const loadImg = (url, ok, fail) => texLoader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; ok(t); }, undefined, fail || (() => {}));

  /* textures */
  function canvasTex(w, h, draw, rx = 1, ry = 1) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  const stoneTex = (rx, ry) => canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d3c1a5'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#d8c7ac' : '#cdbb9e'; g.fillRect(0, i * 64, w, 64); g.fillStyle = '#b9a789'; g.fillRect(0, i * 64, w, 2); } g.fillStyle = '#b9a789'; g.fillRect(128, 0, 2, 64); g.fillRect(64, 64, 2, 64); g.fillRect(192, 128, 2, 64); g.fillRect(96, 192, 2, 64); }, rx, ry);
  const tileTex = (base, line, hi, rx, ry) => canvasTex(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(0, 0, w, h); g.fillStyle = hi; g.fillRect(6, 6, 116, 116); g.fillRect(134, 134, 116, 116); }, rx, ry);
  const woodTex = (rx, ry) => canvasTex(256, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { const sh = 78 + ((i * 37) % 22); g.fillStyle = `rgb(${Math.round(sh * .92)},${Math.round(sh * .5)},${Math.round(sh * .34)})`; g.fillRect(0, i * 32, w, 32); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, i * 32, w, 2); const o = (i * 97) % 200; g.fillRect(o, i * 32, 2, 32); } }, rx, ry);
  const gridTex = (rx, ry) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#212224'; g.fillRect(0, 0, w, h); g.strokeStyle = '#17181a'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); }, rx, ry);

  /* room themes (look of each gallery) */
  /* great hall: pale travertine in tall panels (from the central-hall photos) */
  const travTex = (rx, ry) => canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#d9c8ad'; g.fillRect(0, 0, w, h); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 2; r++) { const x = c * 128, y = r * 256, sh = 214 + Math.round(rnd() * 14); g.fillStyle = `rgb(${sh},${sh - 14},${sh - 38})`; g.fillRect(x + 2, y + 2, 124, 252); for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${150 + rnd() * 40},${125 + rnd() * 30},${95 + rnd() * 30},${.05 + rnd() * .08})`; g.fillRect(x + 4, y + rnd() * 250, 120, 1 + rnd() * 2); } }
    g.fillStyle = '#b9a688'; for (let c = 0; c <= 4; c++) g.fillRect(c * 128 - 1, 0, 2, h); g.fillRect(0, 255, w, 2); g.fillRect(0, 0, w, 2); }, rx, ry);
  const hallStone = new THREE.MeshStandardMaterial({ map: travTex(10, 4), roughness: .5, metalness: .02, envMapIntensity: .6 });
  const DARK = mat('#2c2d30', { roughness: .8 });
  const THEME = {
    dark:  { wall: DARK, floor: new THREE.MeshStandardMaterial({ map: tileTex('#3a2f2a', '#2a221e', 'rgba(255,255,255,.03)', 6, 6), roughness: .3, metalness: .05, envMapIntensity: .8 }), ceil: new THREE.MeshStandardMaterial({ map: gridTex(20, 20), roughness: .9 }), frame: BLACK },
    gogu:  { wall: mat('#202225', { roughness: .85 }), floor: new THREE.MeshStandardMaterial({ map: tileTex('#242220', '#181716', 'rgba(255,255,255,.02)', 6, 8), roughness: .3, metalness: .08, envMapIntensity: .7 }), ceil: mat('#141517'), frame: BLACK },
    baek:  { wall: mat('#f4f4f2', { roughness: .8 }), floor: new THREE.MeshStandardMaterial({ map: tileTex('#d4d7db', '#c3c7cc', 'rgba(255,255,255,.35)', 6, 8), roughness: .1, metalness: .05, envMapIntensity: 1.3 }), ceil: mat('#f6f6f6', { emissive: '#e6e6e6', emissiveIntensity: .75 }), frame: WHITEF },
    silla: { wall: mat('#3f2f2a', { roughness: .85 }), floor: new THREE.MeshStandardMaterial({ map: woodTex(6, 10), roughness: .3, metalness: .05, envMapIntensity: .9 }), ceil: mat('#2a211e'), frame: BLACK },
  };
  const slab = (x0, x1, z0, z1, floorMat, ceilMat, ceilH) => { const w = x1 - x0, d = z0 - z1, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat); f.rotation.x = -Math.PI / 2; add(f, cx, 0, cz); const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat); c.rotation.x = Math.PI / 2; add(c, cx, ceilH, cz); };
  // great hall
  { const t = tileTex('#cdb999', '#b4a07f', 'rgba(255,255,255,.12)', (HALL.x1 - HALL.x0) / 4, (HALL.z1 - HALL.z0) / 4); slab(HALL.x0, HALL.x1, HALL.z1, HALL.z0, new THREE.MeshStandardMaterial({ map: t, roughness: .09, metalness: .1, envMapIntensity: .95 }), mat('#d6c9b3'), HH); }
  // each gallery gets its own floor / ceiling
  ROOMS.forEach(r => { const th = THEME[r.theme]; slab(WING.x0, WING.x1, r.z0, r.z1, th.floor, th.ceil, H); });
  // skylights over the great hall
  const SKY = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const [cz, sz] of [[-120, 18], [-62, 12], [-14, 12], [-92, 12]]) { box(14, .1, sz, -3, HH - .06, cz, SKY); for (let i = -2; i <= 2; i++) box(.18, .14, sz, -3 + i * 3, HH - .12, cz, TRIM); for (let j = -2; j <= 2; j++) box(14, .14, .18, -3, HH - .12, cz + j * sz / 4, TRIM); }
  // linear ceiling lights (dark galleries) / bright ceiling panels (Baekje) / warm lamps (Silla)
  const STRIP = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  ROOMS.forEach(r => { const len = r.z0 - r.z1 - 1, cz = (r.z0 + r.z1) / 2;
    if (r.theme === 'baek') { for (let i = 0; i < 4; i++) box(6, .05, 5, 20, H - .03, r.z0 - 4 - i * 8, SKY); }
    else if (r.theme === 'silla') { for (let i = 0; i < 5; i++) { box(5, .05, .3, 20, H - .03, r.z0 - 4 - i * 7.5, WARMGLOW); } }
    else for (const x of [13.5, 26.5]) box(.12, .04, len, x, H - .03, cz, STRIP); });
  box(.14, .012, 130, 20, .006, -77, new THREE.MeshBasicMaterial({ color: '#d9c9a6' }));   // pale guide line on the floor (from the reference photo)

  /* walls + collision obstacles */
  const OBST = [];
  function wall(x, z, w, d, mats, solid = true, h = H) { box(w, h, d, x, h / 2, z, mats); if (solid) OBST.push({ x0: x - w / 2 - .3, x1: x + w / 2 + .3, z0: z - d / 2 - .3, z1: z + d / 2 + .3 }); }
  wall(-14, (HALL.z0 + HALL.z1) / 2, .4, HALL.z1 - HALL.z0, hallStone, false, HH); wall(-3, HALL.z0, 22, .4, hallStone, false, HH);
  wall(-9, HALL.z1, 10, .4, hallStone, false, HH); wall(6, HALL.z1, 4, .4, hallStone, false, HH); box(8, HH - 4, .4, 0, (HH + 4) / 2, HALL.z1, hallStone);
  wall(20, WING.z1, 24, .4, DARK, false); wall(20, WING.z0, 24, .4, THEME.silla.wall, false);
  ROOMS.forEach(r => { const len = r.z0 - r.z1, mz = (r.z0 + r.z1) / 2; wall(32, mz, .4, len, THEME[r.theme].wall, false); });
  add(new THREE.Mesh(new THREE.BoxGeometry(8, 4, .1), GLASS), 0, 2, HALL.z1); for (const x of [-4, 0, 4]) box(.12, 4, .12, x, 2, HALL.z1, TRIM);
  { const day = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshBasicMaterial({ color: '#e6eef8' })); day.rotation.y = Math.PI; add(day, 0, 12, HALL.z1 + 8); }
  // hall / wing wall: hall side travertine, wing side = that room's wall
  { const sorted = OPEN.slice().sort((a, b) => b[0] - a[0]); const solid = []; let top = WING.z1; for (const [a, b] of sorted) { if (top > b) solid.push([top, b]); top = a; } if (top > WING.z0) solid.push([top, WING.z0]);   // [from, to] going north
    for (const [a, b] of solid) for (const r of ROOMS) { const lo = Math.max(b, r.z1), hi = Math.min(a, r.z0); if (hi - lo < .2) continue; const two = [THEME[r.theme].wall, hallStone, DARK, DARK, DARK, DARK]; wall(8, (hi + lo) / 2, .6, hi - lo, two, true, HH); }
    for (const [a, b] of OPEN) { const two = [DARK, hallStone, DARK, DARK, DARK, DARK]; box(.6, HH - H, a - b, 8, (HH + H) / 2, (a + b) / 2, two); box(.62, .9, a - b, 8, H - .45, (a + b) / 2, DARK); } }
  for (const z of DIV) { wall(12, z, 8, .5, DARK); wall(28, z, 8, .5, DARK); box(8, 1.5, .5, 20, H - .75, z, DARK); }
  box(8, 1.2, .5, 20, H - .6, -12, DARK);
  /* hall wall panels removed: plain travertine walls */

  /* hall dressing: recessed tall windows in the stone walls, balcony + glazed end wall, sun patches under the skylights, wall spots */
  { const FR = mat('#c3b193', { roughness: .6 }), INS = new THREE.MeshStandardMaterial({ color: '#8a7f70', roughness: .9, emissive: '#fff1d6', emissiveIntensity: .18 });
    const recess = (x, z, facing) => { const w = 1.5, h = 3.4, y = 7.2, f = facing; box(.5, .22, w + .5, x, y + h / 2 + .1, z, FR); box(.5, .22, w + .5, x, y - h / 2 - .1, z, FR); box(.5, h, .25, x, y, z + (w / 2 + .12), FR); box(.5, h, .25, x, y, z - (w / 2 + .12), FR);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), INS); p.rotation.y = f > 0 ? (Math.PI / 2) : -(Math.PI / 2); add(p, x + f * .02, y, z); };
    /* wall recess frames removed (read as ambiguous windows/artworks) */
    // balcony + glass end wall (far end of the hall, like the 2F gallery seen above the pagoda in the photo)
    box(22, .4, 6, -3, 5.1, ZE + 3.4, mat('#cdbd9f')); box(22, 1.1, .08, -3, 5.8, ZE + 6.4, new THREE.MeshStandardMaterial({ color: '#cfe4f2', transparent: true, opacity: .25, roughness: .05, depthWrite: false }));
    box(22, .06, .08, -3, 6.35, ZE + 6.4, TRIM); for (let x = -13; x <= 7; x += 2) box(.05, 1.1, .05, x, 5.8, ZE + 6.4, TRIM);
    const glassEnd = new THREE.Mesh(new THREE.PlaneGeometry(22, 5), new THREE.MeshBasicMaterial({ color: '#dfe9f2' })); glassEnd.position.set(-3, 8, ZE + .35); add(glassEnd, -3, 8, ZE + .35);
    for (let x = -13; x <= 7; x += 4) box(.18, 5, .2, x, 8, ZE + .45, TRIM); box(22, .18, .2, -3, 8, ZE + .45, TRIM);
    for (const cz of [-14, -62, -92, -120]) { const patch = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ color: '#fff7e6', transparent: true, opacity: .16, depthWrite: false })); patch.rotation.x = -Math.PI / 2; patch.rotation.z = .35; add(patch, -2 + 3, .012, cz + 4); }
    // ceiling spots (recessed) in the dark galleries — small warm discs in rows over the cases
    const spotM = new THREE.MeshBasicMaterial({ color: '#fff0d2' }), spotG = new THREE.CircleGeometry(.07, 12);
    for (const r of ROOMS) { if (r.theme === 'baek') continue; for (let z = r.z0 - 2; z > r.z1 + 1; z -= 3.5) for (const x of [11, 17, 23, 29]) { const d = new THREE.Mesh(spotG, spotM); d.rotation.x = Math.PI / 2; d.position.set(x, H - .02, z); scene.add(d); } } }

  /* labels */
  function labelTex(lines, w, h, opt = {}) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = opt.bg || '#17181a'; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => { g.font = `${i === 0 ? '700' : '500'} ${ln.size}px "Apple SD Gothic Neo","Hiragino Sans","PingFang SC","Noto Sans KR",sans-serif`; g.fillStyle = ln.color || (opt.fg || '#f1f1ef'); g.fillText(ln.text, w / 2, ln.y); }); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  function roomSignText(sg) { const nation = sg.key ? t('nations')[sg.key] : (S.set.lang === 'ko' ? sg.ko : sg.en); const sub = sg.key ? '' : (S.set.lang === 'ko' ? sg.en : sg.ko); return [{ text: `${sg.no}`, size: 44, y: 48, color: '#a8a8a2' }, { text: nation, size: 62, y: 118 }].concat(sub ? [{ text: sub, size: 32, y: 170, color: '#a8a8a2' }] : []); }
  for (const sg of SIGNS) { const light = sg.theme === 'baek'; const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: labelTex(roomSignText(sg), 640, 200, light ? { bg: '#ececea', fg: '#202225' } : {}) })); m.position.set(20, H - .75, sg.z0 + .28); scene.add(m); sg.mesh = m; }
  { const es = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1), new THREE.MeshBasicMaterial({ map: labelTex([{ text: '국립중앙박물관 · National Museum of Korea', size: 46, y: 70 }], 1024, 140, { bg: '#e6dac6', fg: '#2a2723' }) })); es.position.set(0, 4.6, HALL.z1 - .3); es.rotation.y = Math.PI; scene.add(es); }
  /* entrance signage: "선사·고대관" over the doorway to room 101 + a hanging sign seen from the hall entrance */
  { const mkSign = (w, h) => labelTex([{ text: '선사·고대관  →', size: 92, y: 96 }, { text: 'Prehistory & Ancient History · 101–110', size: 40, y: 172, color: '#c9c9c3' }], w, h, { bg: '#17181a' });
    const wallSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.9), new THREE.MeshBasicMaterial({ map: mkSign(1024, 216) })); wallSign.rotation.y = -Math.PI / 2; add(wallSign, 7.62, 7.4, -17);
    const hang = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.48), new THREE.MeshBasicMaterial({ map: mkSign(1024, 216) })); add(hang, 2.5, 7.3, -8); const back = hang.clone(); back.rotation.y = Math.PI; back.position.z = -8.02; scene.add(back);
    for (const dx of [-3, 3]) box(.05, HH - 8, .05, 2.5 + dx, (HH + 8) / 2, -8, TRIM); }
  const bandTex = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#d5d6d3'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3b3e'; g.fillRect(14, 12, 150, 16); g.fillStyle = '#8c8e8a'; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(14 + c * 168, 38 + r * 12, 150 - (r * 13) % 40, 5); });
  const bandMat = new THREE.MeshBasicMaterial({ map: bandTex, color: '#bfc0bc' });
  for (const z of [-14.5, -19.5, -24.5, -29.5, -104]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.6), bandMat); b.rotation.y = -Math.PI / 2; add(b, 31.78, 1.9, z); }

  /* ---------- cases ---------- */
  function vitrine(x, z, w = 1.5, baseH = .9, glassH = 1.9, frame = BLACK) {
    box(w, baseH, w, x, baseH / 2, z, frame); box(w + .06, .05, w + .06, x, baseH + .025, z, TRIM);
    add(new THREE.Mesh(new THREE.BoxGeometry(w, glassH, w), GLASS), x, baseH + .05 + glassH / 2, z);
    box(w + .06, .12, w + .06, x, baseH + .05 + glassH + .06, z, frame); box(w - .12, .03, w - .12, x, baseH + .05 + glassH - .02, z, GLOW);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(.04, glassH, .04, x + dx * w / 2, baseH + .05 + glassH / 2, z + dz * w / 2, TRIM);
    OBST.push({ x0: x - w / 2 - .45, x1: x + w / 2 + .45, z0: z - w / 2 - .45, z1: z + w / 2 + .45 });
  }
  function hexCase(x, z, yaw) {   // Silla: tall hexagonal vitrine with a grey-blue backing panel
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.9, .96, .9, 6), BLACK); add(base, x, .45, z);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.86, .86, 2.1, 6), GLASS), x, .9 + 1.05, z);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.92, .92, .12, 6), BLACK), x, 3.06, z); add(new THREE.Mesh(new THREE.CylinderGeometry(.74, .74, .03, 6), WARMGLOW), x, 2.98, z);
    const n = [Math.sin(yaw), Math.cos(yaw)]; const back = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.75), new THREE.MeshStandardMaterial({ color: '#5d6b79', roughness: .9 })); back.rotation.y = yaw; add(back, x - n[0] * .42, 1.95, z - n[1] * .42);
    OBST.push({ x0: x - 1.2, x1: x + 1.2, z0: z - 1.2, z1: z + 1.2 });
  }
  function nicheFrame(x, z, yaw, frameMat, backColor) {   // case set into the wall
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
    const add2 = (m, lx, ly, lz) => { m.position.set(lx, ly, lz); g.add(m); return m; };
    add2(new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.5, .12), mat(backColor, { roughness: .9 })), 0, 1.6, -.3);
    add2(new THREE.Mesh(new THREE.BoxGeometry(2.0, .08, .55), frameMat), 0, 2.88, -.12); add2(new THREE.Mesh(new THREE.BoxGeometry(2.0, .08, .55), frameMat), 0, .38, -.12);
    add2(new THREE.Mesh(new THREE.BoxGeometry(.08, 2.5, .55), frameMat), -.96, 1.6, -.12); add2(new THREE.Mesh(new THREE.BoxGeometry(.08, 2.5, .55), frameMat), .96, 1.6, -.12);
    add2(new THREE.Mesh(new THREE.BoxGeometry(1.8, .03, .4), GLOW), 0, 2.82, -.1);
    add2(new THREE.Mesh(new THREE.PlaneGeometry(1.84, 2.4), GLASS), 0, 1.6, .12);
    add2(new THREE.Mesh(new THREE.BoxGeometry(1.9, .5, .5), frameMat), 0, .15, -.05);
    return g;
  }

  /* ---------- exhibits (free browsing) ---------- */
  const ITEMS = [];            // { id, nation, x, y, z }
  function plateFor(group, id, maxS, opt = {}) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#8a8a8a' })); group.add(mesh);
    loadImg(EXH_IMG(id), tx => { const a = tx.image.width / tx.image.height, w = a >= 1 ? maxS : maxS * a, h = a >= 1 ? maxS / a : maxS; mesh.geometry.dispose(); mesh.geometry = new THREE.PlaneGeometry(w, h); mesh.material.map = tx; mesh.material.color.set(opt.tint || '#eeeeee'); mesh.material.needsUpdate = true;
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(w + .06, h + .06), new THREE.MeshBasicMaterial({ color: '#0b0b0c' })); fr.position.z = -.01; mesh.add(fr); });   // child of the plate so it follows the plate's own position/rotation (was added to the scene origin → black slab at spawn)
    return mesh;
  }
  /* 3D toy-style icon (유물 정리/…/3D 아이콘): transparent sprite that turns to face the visitor, with a soft contact shadow */
  const BILLS = [];
  const shadowTex = canvasTex(128, 128, (g, w, h) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  /* real 3D from the icon: the silhouette (alpha) is inflated into a rounded solid (front + back shells, Lambert-lit) so it has true depth and turns slowly on its pedestal */
  const GN = 112;
  function inflate(img, size, depth) {
    const c = document.createElement('canvas'); c.width = c.height = GN; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, GN, GN); const px = g.getImageData(0, 0, GN, GN).data;
    const INF = 1e4, d = new Float32Array(GN * GN); for (let i = 0; i < GN * GN; i++) d[i] = px[i * 4 + 3] > 110 ? INF : 0;
    for (let y = 0; y < GN; y++) for (let x = 0; x < GN; x++) { const i = y * GN + x; if (!d[i]) continue; let v = d[i]; if (x === 0 || y === 0 || x === GN - 1 || y === GN - 1) v = 1; if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) v = Math.min(v, d[i - GN] + 1); if (x > 0 && y > 0) v = Math.min(v, d[i - GN - 1] + 1.4); if (x < GN - 1 && y > 0) v = Math.min(v, d[i - GN + 1] + 1.4); d[i] = v; }
    for (let y = GN - 1; y >= 0; y--) for (let x = GN - 1; x >= 0; x--) { const i = y * GN + x; if (!d[i]) continue; let v = d[i]; if (x < GN - 1) v = Math.min(v, d[i + 1] + 1); if (y < GN - 1) v = Math.min(v, d[i + GN] + 1); if (x < GN - 1 && y < GN - 1) v = Math.min(v, d[i + GN + 1] + 1.4); if (x > 0 && y < GN - 1) v = Math.min(v, d[i + GN - 1] + 1.4); d[i] = v; }
    let mx = 1; for (let i = 0; i < d.length; i++) mx = Math.max(mx, d[i]); mx = Math.min(mx, 16);          // thickness ramps up over ~9 cells from the rim, so thin parts stay thin
    let h = new Float32Array(GN * GN); for (let i = 0; i < h.length; i++) { const t = Math.min(1, d[i] / mx); h[i] = depth * (t * t * (3 - 2 * t)); }
    for (let pass = 0; pass < 2; pass++) { const o = h.slice(); for (let y = 1; y < GN - 1; y++) for (let x = 1; x < GN - 1; x++) { const i = y * GN + x; if (o[i] > 0) h[i] = (o[i] * 4 + o[i - 1] + o[i + 1] + o[i - GN] + o[i + GN]) / 8; } }
    const geo = (sign) => { const gm = new THREE.PlaneGeometry(size, size, GN - 1, GN - 1), pos = gm.attributes.position; for (let i = 0; i < pos.count; i++) pos.setZ(i, h[i] * sign); if (sign < 0) { const idx = gm.index.array; for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } gm.index.needsUpdate = true; } gm.computeVertexNormals(); return gm; };
    return [geo(1), geo(-1)];
  }
  function iconFor(group, id, size, opt = {}) {
    const holder = new THREE.Group(); holder.position.y = opt.dy || 0; group.add(holder); const rec = { mesh: holder, group, amp: opt.clamp || .6, ph: (id.length * 1.7) % 6.28 }; BILLS.push(rec);
    loadImg('assets/icons/' + id + '.webp', tx => { try { const [gf, gb] = inflate(tx.image, size, size * .11); const mf = new THREE.MeshStandardMaterial({ map: tx, alphaTest: .5, roughness: .6, metalness: .05, envMapIntensity: .35, emissiveMap: tx, emissive: '#ffffff', emissiveIntensity: .42 }), mb = new THREE.MeshStandardMaterial({ map: tx, alphaTest: .5, color: '#b9b4ac', roughness: .7, envMapIntensity: .3, emissiveMap: tx, emissive: '#ffffff', emissiveIntensity: .25 }); mb.side = THREE.FrontSide;
        holder.add(new THREE.Mesh(gf, mf), new THREE.Mesh(gb, mb)); } catch (e) { console.warn('icon 3D failed', id, e); } }, () => { BILLS.splice(BILLS.indexOf(rec), 1); group.remove(holder); if (opt.fallback) opt.fallback(); });
    if (opt.shadow) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(size * .8, size * .8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = opt.shadowY; group.add(sh); }
    return holder;
  }
  function putItem(id, kind, x, z, yaw) {
    const e = EXHMAP[id]; if (!e) return; const th = THEME[ROOMS.find(r => z <= r.z0 && z > r.z1)?.theme || 'dark']; const g = new THREE.Group(); g.rotation.y = yaw;
    let y = ART_Y, s = 1.15;
    if (kind === 'niche') { nicheFrame(x, z, yaw, th.frame, th.frame === WHITEF ? '#d9dadc' : '#2a2c30'); g.position.set(x, 1.7, z); const o = [Math.sin(yaw), Math.cos(yaw)]; g.position.x += o[0] * .02; g.position.z += o[1] * .02; y = 1.7; s = 1.7; }
    else if (kind === 'free') { vitrine(x, z, 1.5, .9, 1.9, th.frame); g.position.set(x, ART_Y, z); }
    else if (kind === 'hex') { hexCase(x, z, yaw); g.position.set(x, ART_Y, z); s = 1.25; }
    else if (kind === 'table') { box(2.7, .9, 1.4, x, .45, z, BLACK); box(2.8, .06, 1.5, x, .93, z, TRIM); add(new THREE.Mesh(new THREE.BoxGeometry(2.55, .02, 1.25), GLASS), x, 1.0, z); OBST.push({ x0: x - 1.65, x1: x + 1.65, z0: z - 1, z1: z + 1 });
      const m = plateFor(scene, id, 2.2, { tint: '#d8d8d8' }); m.rotation.x = -Math.PI / 2; m.position.set(x, 1.02, z); m.rotation.z = yaw; const scr = new THREE.Mesh(new THREE.PlaneGeometry(.9, .45), new THREE.MeshBasicMaterial({ color: '#3a7a9a' })); scr.rotation.x = -Math.PI / 2 + .35; add(scr, x, 1.0, z + .85); { const tg = new THREE.Group(); tg.position.set(x - .55, 1.75, z - .1); scene.add(tg); iconFor(tg, id, 1.3, { shadow: true, shadowY: -.72 }); m.position.x += .5; } ITEMS.push({ id, nation: e.nation, x, y: 1.0, z }); return; }
    else if (kind === 'podium') { box(2.2, .5, 2.2, x, .25, z, BLACK); OBST.push({ x0: x - 1.6, x1: x + 1.6, z0: z - 1.6, z1: z + 1.6 }); g.position.set(x, 1.85, z); s = 2.6; y = 1.85; }
    else if (kind === 'wallcase') { /* big wall case (north wall of Silla) */ g.position.set(x, 2.2, z); s = 7; y = 2.2; const f = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.9, .3), BLACK); f.position.set(x, 2.2, z - .22); scene.add(f); }
    scene.add(g); const hasShadow = kind === 'free' || kind === 'hex' || kind === 'podium'; iconFor(g, id, s * (kind === 'wallcase' ? .62 : .98), { clamp: kind === 'niche' ? .3 : kind === 'wallcase' ? .35 : kind === 'hex' ? .5 : .65, fallback: () => plateFor(g, id, s), shadow: hasShadow, shadowY: kind === 'free' ? -.9 : kind === 'hex' ? -.9 : -1.35, dy: kind === 'wallcase' ? -.3 : 0 }); ITEMS.push({ id, nation: e.nation, x, y, z });
  }
  const PI2 = Math.PI / 2;
  // Goguryeo (105): niches along both walls, free cases, a low table with the stele rubbing
  [['g_crown1', -38], ['g_crown2', -44], ['g_shoes', -50], ['g_tile', -56]].forEach(([id, z]) => putItem(id, 'niche', 8.42, z, PI2));
  [['g_stove', -46], ['g_sanggo', -52], ['g_yeonga', -58], ['g_clay', -62]].forEach(([id, z]) => putItem(id, 'niche', 31.58, z, -PI2));
  putItem('g_tripod', 'free', 14.5, -48, PI2); putItem('g_stele', 'table', 24, -57, 0);
  // Baekje (106): bright niches, free case, chimi on a podium
  [['b_crownorn', -77], ['b_cap', -82], ['b_beads', -87], ['b_flower', -92]].forEach(([id, z]) => putItem(id, 'niche', 8.42, z, PI2));
  [['b_cauldron', -80], ['b_sheep', -85]].forEach(([id, z]) => putItem(id, 'niche', 31.58, z, -PI2));
  putItem('b_ossuary', 'free', 15.5, -76, PI2); putItem('b_chimi', 'podium', 24, -90, -PI2);
  // Silla (108-110): hexagonal vitrines on the wood floor + the big pottery wall case
  [['s_earring', -128], ['s_belt', -135], ['s_glass', -142]].forEach(([id, z]) => putItem(id, 'hex', 13, z, PI2));
  [['s_capcrown', -118], ['s_shoes', -125], ['s_horseman', -132], ['s_boat', -139], ['s_toou', -146]].forEach(([id, z]) => putItem(id, 'hex', 27, z, -PI2));
  putItem('s_pottery', 'wallcase', 20, ZE + .5, 0);

  /* room atmosphere textures cut out of the reference photos */
  // Goguryeo: four tall back-lit stele rubbings flanking the doorway (north wall of room 105)
  loadImg('assets/rooms/gogu_rubbing.jpg', tx => { for (let k = 0; k < 4; k++) { const t2 = tx.clone(); t2.needsUpdate = true; t2.repeat.set(.25, 1); t2.offset.set(k * .25, 0); const m = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 4.4), new THREE.MeshBasicMaterial({ map: t2, color: '#d6dbe0' })); m.position.set(k < 2 ? 9.9 + k * 3.25 : 24.7 + (k - 2) * 3.25, 2.6, -63.7); scene.add(m); } });
  box(.2, 4.6, .12, 16.2, 2.6, -63.75, GLOW); box(.2, 4.6, .12, 23.8, 2.6, -63.75, GLOW);
  // Baekje: pottery shelves on the walls
  loadImg('assets/rooms/baek_shelf.jpg', tx => { const a = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.8), new THREE.MeshBasicMaterial({ map: tx, color: '#e8e8e8' })); a.rotation.y = PI2; add(a, 8.4, 2.4, -69); const b = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.8), new THREE.MeshBasicMaterial({ map: tx, color: '#e8e8e8' })); b.rotation.y = -PI2; add(b, 31.6, 2.4, -72); });
  // Silla: poster of the crown display on the east wall
  loadImg(EXH_IMG('poster_silla'), tx => { const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.05), new THREE.MeshBasicMaterial({ map: tx })); m.rotation.y = -PI2; add(m, 31.7, 2.3, -148); });
  // warm lights in the Silla room + cool spots in the Goguryeo room
  for (const z of [-118, -130, -142]) { const l = new THREE.PointLight('#ffb36b', 20, 14, 2); l.position.set(20, 3.8, z); scene.add(l); }
  for (const z of [-44, -58]) { const l = new THREE.PointLight('#bcd2ff', 14, 11, 2); l.position.set(20, 3.9, z); scene.add(l); }

  /* ---------- set dressing: rooms 101-104, hall ---------- */
  { const props = [[12, -14.5, 'stone'], [28, -19.5, 'pot'], [12, -24.5, 'bronze'], [28, -29.5, 'bronze']];
    for (const [x, z, kind] of props) { vitrine(x, z, 1.2, .8, 1.35); const m = kind === 'stone' ? new THREE.Mesh(new THREE.DodecahedronGeometry(.3, 0), mat('#a39d92')) : kind === 'pot' ? new THREE.Mesh(new THREE.ConeGeometry(.26, .6, 16), mat('#b98f6a')) : new THREE.Mesh(new THREE.CylinderGeometry(.22, .3, .45, 18), mat('#7d9a86', { metalness: .3 })); add(m, x, 1.55, z); } }
  const PZ = -118, SZ = -62;
  { /* Gyeongcheonsa ten-storey stone pagoda (central hall landmark) — tapered tiers, eaves and relief bands */
    const stoneM = mat('#7a7c7c', { roughness: .85 }), darkM = mat('#4b4d4e', { roughness: .9 }), tx = -3;
    box(7.4, .35, 7.4, tx, .175, PZ, mat('#26272a', { roughness: .5 })); box(5.8, .5, 5.8, tx, .6, PZ, darkM); box(4.6, .5, 4.6, tx, 1.1, PZ, stoneM); let y = 1.35;
    for (let i = 0; i < 10; i++) { const s0 = i < 3 ? 3.5 - i * .1 : 3.0 - (i - 3) * .2, bh = i < 3 ? 1.15 : .8;
      const body = new THREE.Mesh(new THREE.BoxGeometry(s0, bh, s0), stoneM); add(body, tx, y + bh / 2, PZ);
      for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, PI2], [-1, 0, -PI2]]) for (let k = -1; k <= 1; k++) { const rel = new THREE.Mesh(new THREE.BoxGeometry(s0 * .26, bh * .62, .07), darkM); rel.rotation.y = ry; rel.position.set(tx + dx * (s0 / 2 + .02) + (dz ? k * s0 * .3 : 0), y + bh / 2, PZ + dz * (s0 / 2 + .02) + (dx ? k * s0 * .3 : 0)); scene.add(rel); }
      y += bh; const roof = new THREE.Mesh(new THREE.CylinderGeometry(s0 * .62, s0 * .98, .32, 4), stoneM); roof.rotation.y = Math.PI / 4; add(roof, tx, y + .16, PZ); const lip = new THREE.Mesh(new THREE.BoxGeometry(s0 * 1.5, .06, s0 * 1.5), darkM); add(lip, tx, y + .02, PZ); y += .3; }
    const fin = new THREE.Mesh(new THREE.ConeGeometry(.18, 1.4, 8), mat('#3a3b3c')); add(fin, tx, y + .7, PZ);
    const spot = new THREE.SpotLight('#fff1d8', 90, 26, .5, .5, 1.6); spot.position.set(tx + 3, 9.5, PZ + 6); spot.target.position.set(tx, 5, PZ); scene.add(spot, spot.target);
    OBST.push({ x0: -7.3, x1: 1.3, z0: PZ - 4.2, z1: PZ + 4.2 }); }
  { /* Gwanggaeto Stele (central hall): back-lit panel with the stone — textures cropped from 유물 정리/광개토대왕릉비.jpg */
    const sx = -3, dark = mat('#1d1d1f', { roughness: .6 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, .3, 48), mat('#1a1a1c', { roughness: .35, metalness: .2 })); add(base, sx, .15, SZ);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 5.5, .4), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ color: '#d9d9d9' }), new THREE.MeshBasicMaterial({ color: '#d9d9d9' })]); add(body, sx, 3.05, SZ);
    loadImg('assets/rooms/stele_main.jpg', tx => { for (const m of [body.material[4], body.material[5]]) { m.map = tx; m.color.set('#ffffff'); m.needsUpdate = true; } });
    const sp = new THREE.SpotLight('#ffffff', 40, 14, .6, .6, 1.5); sp.position.set(sx, 9, SZ + 5); sp.target.position.set(sx, 3, SZ); scene.add(sp, sp.target);
    OBST.push({ x0: sx - 3.7, x1: sx + 3.7, z0: SZ - 3.7, z1: SZ + 3.7 }); }

  /* ---------- scenario artifacts (stations) ---------- */
  const WHITEKEY = { vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'uniform sampler2D map; uniform float glow; varying vec2 vUv; void main(){ vec4 c=texture2D(map,vUv); float m=min(c.r,min(c.g,c.b)); float a=(1.0-smoothstep(0.9,0.985,m))*c.a; gl_FragColor=vec4(c.rgb+glow*0.12,a); gl_FragColor=linearToOutputTexel(gl_FragColor);} ' };
  const ARTW = {};
  function procedural(id) {
    const a = ART[id], c0 = new THREE.Color(a.c[0]), c1 = new THREE.Color(a.c[1]), c2 = new THREE.Color(a.c[2]); const g = new THREE.Group(); const m = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .55, metalness: .05 }, o));
    if (id === 'gogu') { const prof = [[0, 0], [.34, 0], [.4, .08], [.52, .3], [.5, .5], [.36, .62], [.14, .7], [0, .72]].map(p => new THREE.Vector2(p[0], p[1])); const v = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), m(c1)); g.add(v); const lid = new THREE.Mesh(new THREE.SphereGeometry(.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m(c2)); lid.position.y = .7; g.add(lid); const ring = new THREE.Mesh(new THREE.TorusGeometry(.5, .025, 8, 36), m(c0)); ring.rotation.x = Math.PI / 2; ring.position.y = .34; g.add(ring); g.position.y = -.35; }
    else if (id === 'baek') { const b = new THREE.Mesh(new THREE.BoxGeometry(1, .22, 1), m(c1)); g.add(b); const peak = (x, z, h) => { const k = new THREE.Mesh(new THREE.ConeGeometry(.26, h, 6), m(c2)); k.position.set(x, .11 + h / 2, z); g.add(k); }; peak(-.2, .1, .4); peak(.15, -.05, .5); peak(.32, .2, .3); g.rotation.x = -.5; }
    else if (id === 'gaya') { const body = new THREE.Mesh(new THREE.CylinderGeometry(.42, .34, .7, 24, 1, true), m(c1, { side: THREE.DoubleSide })); g.add(body); for (let i = 0; i < 5; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(.38 - i * .01, .028, 8, 28), m(c0)); band.rotation.x = Math.PI / 2; band.position.y = -.28 + i * .14; g.add(band); } const helm = new THREE.Mesh(new THREE.ConeGeometry(.22, .34, 20), m(c2)); helm.position.y = .55; g.add(helm); for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.SphereGeometry(.025, 8, 6), m('#ff8a3d')); const an = i / 8 * Math.PI * 2; r.position.set(Math.cos(an) * .2, .43, Math.sin(an) * .2); g.add(r); } }
    else if (id === 'silla') { const band = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .12, 28, 1, true), m(c1, { side: THREE.DoubleSide, metalness: .5, roughness: .35 })); g.add(band); for (const [x, h] of [[-.2, .42], [0, .55], [.2, .42]]) { const u = new THREE.Mesh(new THREE.BoxGeometry(.05, h, .02), m(c1, { metalness: .5, roughness: .35 })); u.position.set(x, .06 + h / 2, 0); g.add(u); } g.scale.setScalar(1.5); }
    else { const prof = [[0, 0], [.3, 0], [.38, .08], [.18, .22], [.14, .4], [.3, .6], [.22, .78], [.04, .9]].map(p => new THREE.Vector2(p[0], p[1])); const v = new THREE.Mesh(new THREE.LatheGeometry(prof, 30), new THREE.MeshStandardMaterial({ color: c1, transparent: true, opacity: .55, emissive: c2, emissiveIntensity: .6, roughness: .3 })); g.add(v); g.position.y = -.4; }
    return g;
  }
  const MAINIMG = new Set(['baek', 'silla', 'absent']);
  for (const id of Object.keys(STN)) {
    const { x, z } = STN[id]; const th = THEME[ROOMS.find(r => z <= r.z0 && z > r.z1).theme]; vitrine(x, z, 1.5, .9, 1.9, th.frame); const face = x > 20 ? -PI2 : PI2;
    const g = new THREE.Group(); g.position.set(x, ART_Y, z); scene.add(g); const base = procedural(id); g.add(base);
    const light = new THREE.PointLight(ART[id].c[1], 0, 6, 2); light.position.set(x, 2.7, z + 1.2); scene.add(light);
    ARTW[id] = { group: g, base, light, billboard: null, y0: ART_Y, fixed: false };
    // 1) toy-style cut-out in assets/artifacts/<id>.png (white background keyed out)  2) photo plate from assets/exhibits/<id>.jpg
    loadImg(`assets/artifacts/${id}.png`, tex => { const aspect = tex.image.width / tex.image.height, mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3 * aspect, 1.3), new THREE.ShaderMaterial(Object.assign({ uniforms: { map: { value: tex }, glow: { value: 0 } }, transparent: true, depthWrite: false }, WHITEKEY))); g.remove(base); g.add(mesh); ARTW[id].billboard = mesh; ARTW[id].base = null; },
      () => { if (!MAINIMG.has(id)) return; g.remove(base); ARTW[id].base = null; ARTW[id].fixed = true; g.rotation.y = face; iconFor(g, id, 1.45, { shadow: true, shadowY: -.9, fallback: () => { ARTW[id].plate3 = plateFor(g, id, 1.5); } }); });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .38), new THREE.MeshBasicMaterial({ map: labelTex([{ text: '', size: 30, y: 50 }], 512, 160) })); plate.position.set(x + (x > 20 ? -.76 : .76), .55, z); plate.rotation.y = face; scene.add(plate); ARTW[id].plate = plate;
  }
  function refreshPlates() { for (const id of Object.keys(STN)) { const mt = ARTW[id].plate.material; const nm = L(ART[id].name); mt.map = labelTex([{ text: nm.length > 20 ? nm.slice(0, 19) + '…' : nm, size: 36, y: 60 }, { text: t('nations')[id], size: 28, y: 112, color: '#a8a8a2' }], 512, 160); mt.needsUpdate = true; }
    for (const sg of SIGNS) { const light = sg.theme === 'baek'; sg.mesh.material.map = labelTex(roomSignText(sg), 640, 200, light ? { bg: '#ececea', fg: '#202225' } : {}); sg.mesh.material.needsUpdate = true; } }
  let lastLang = '';

  /* ---------- path dots (way-finding) ---------- */
  const dotGeo = new THREE.CircleGeometry(.16, 16), DOTS = [];
  for (let i = 0; i < 140; i++) { const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#35B39A', transparent: true, opacity: .95, depthWrite: false })); d.rotation.x = -Math.PI / 2; d.visible = false; scene.add(d); DOTS.push(d); }
  function projectOnSpine(px, pz) { let best = { d: 1e9, i: 0, t: 0, x: 0, z: 0 }; for (let i = 0; i < SPINE.length - 1; i++) { const [ax, az] = SPINE[i], [bx, bz] = SPINE[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let tt = ((px - ax) * dx + (pz - az) * dz) / l2; tt = Math.max(0, Math.min(1, tt)); const x = ax + dx * tt, z = az + dz * tt, d = Math.hypot(px - x, pz - z); if (d < best.d) best = { d, i, t: tt, x, z }; } return best; }
  function pathTo(id, px, pz) {
    const st = STAND[id], pr = projectOnSpine(px, pz), tp = projectOnSpine(st[0], st[1]); const pts = [[px, pz], [pr.x, pr.z]];
    const pu = pr.i + pr.t, tu = tp.i + tp.t;
    if (tu >= pu) { for (let i = pr.i + 1; i <= tp.i; i++) pts.push(SPINE[i]); } else { for (let i = pr.i; i > tp.i; i--) pts.push(SPINE[i]); }
    pts.push([tp.x, tp.z]); pts.push([st[0], st[1]]); return pts;
  }
  function placeDots(pts, time) { let acc = 0, k = 0; const step = 1.5; let carry = (time * 1.2) % step; for (let i = 0; i < pts.length - 1 && k < DOTS.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < .001) continue; let d = (step - carry) % step; while (d < l && k < DOTS.length) { const f = d / l, dot = DOTS[k++]; dot.position.set(ax + (bx - ax) * f, .035, az + (bz - az) * f); dot.visible = true; const s = .75 + .35 * Math.sin(time * 4 - (acc + d) * .8); dot.scale.setScalar(s); d += step; } carry = ((carry + l) % step); acc += l; }
    for (; k < DOTS.length; k++) DOTS[k].visible = false; }

  /* ------------------------------------------------------------ player */
  const P = { x: 0, z: 3, yaw: 0, pitch: 0, bob: 0 }; const keys = {}; let locked = false;
  const rects = [{ x0: HALL.x0 + .4, x1: HALL.x1 + .4, z0: HALL.z0 + .4, z1: HALL.z1 - .4 }, { x0: WING.x0 - .4, x1: WING.x1 - .4, z0: WING.z0 + .4, z1: WING.z1 - .4 }];
  const inside = (x, z) => rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) && !OBST.some(o => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1);
  function tryMove(dx, dz) { if (inside(P.x + dx, P.z)) P.x += dx; if (inside(P.x, P.z + dz)) P.z += dz; }
  function place(x, z, yaw) { P.x = x; P.z = z; if (yaw != null) P.yaw = yaw; }
  /* auto-walk: QI leads the visitor along the path to the next artifact (keeps a live demo moving) */
  const AW = { on: false, pts: null, seg: 0, speed: 0, target: null, face: 0 };
  const lerpAng = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };
  function autoWalk(id) { id = id || (S.started && S.view === 'agent' ? nextPending() : null); if (!id || !STN[id]) return false; AW.pts = pathTo(id, P.x, P.z); AW.seg = 0; AW.speed = 0; AW.on = true; AW.target = id; AW.face = 0; log('auto-walk → ' + id); return true; }
  function stepAutoWalk(dt) {
    if (AW.face > 0) { const a = STN[AW.target]; P.yaw = lerpAng(P.yaw, Math.atan2(-(a.x - P.x), -(a.z - P.z)), Math.min(1, dt * 5)); P.pitch += (Math.atan2(ART_Y - EYE, Math.hypot(a.x - P.x, a.z - P.z)) - P.pitch) * Math.min(1, dt * 5); AW.face -= dt; return; }
    if (!AW.on) return;
    if (S.view !== 'agent' || keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) { AW.on = false; return; }
    const pts = AW.pts, [tx, tz] = pts[Math.min(AW.seg + 1, pts.length - 1)], dx = tx - P.x, dz = tz - P.z, d = Math.hypot(dx, dz), last = AW.seg >= pts.length - 2;
    AW.speed = Math.min(AW.speed + 26 * dt, 13.5, last ? Math.max(2, d * 2.6) : 13.5);
    if (d < .3) { AW.seg++; if (AW.seg >= pts.length - 1) { AW.on = false; AW.face = .9; } return; }
    const step = Math.min(d, AW.speed * dt); P.x += dx / d * step; P.z += dz / d * step; P.yaw = lerpAng(P.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 7)); P.pitch += (0 - P.pitch) * Math.min(1, dt * 4); P.bob += dt * 10;
  }
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code === 'KeyG' && document.body.classList.contains('demo')) autoWalk(); });
  $('#autowalk').onclick = () => { unlockAudio(); autoWalk(); };
  window.WORLD_API = {
    on: true, autoWalk, distTo(id) { const a = STN[id]; return a ? Math.hypot(a.x - P.x, a.z - P.z) : 1e9; },
    release() { if (document.pointerLockElement) document.exitPointerLock(); },
    setPose(x, z, yaw, pitch) { place(x, z, yaw); if (pitch != null) P.pitch = pitch; },
    teleport(id) { if (!id) { place(0, 3, 0); P.pitch = 0; return; } const s = STAND[id], a = STN[id]; place(s[0], s[1], Math.atan2(-(a.x - s[0]), -(a.z - s[1]))); P.pitch = Math.atan2(ART_Y - EYE, Math.hypot(a.x - s[0], a.z - s[1])); log('teleport → ' + id); },
    teleportRoom(no) { const r = ROOMS.find(x => x.no === no); if (!r) return; place(20, r.z0 - 3, 0); P.pitch = 0; },
    state: () => ({ x: P.x, z: P.z, yaw: P.yaw, locked }), items: () => ITEMS.map(i => i.id),
    introduce: id => showItemCard(id),
  };
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; const k = e.code; keys[k] = true; if (S.view === 'chat' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) miniChat(); if (k === 'KeyF') { S.manualLook = true; renderLab(); clearTimeout(window._flook); window._flook = setTimeout(() => { S.manualLook = false; renderLab(); }, 1600); log('F: looked at phone'); } if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k) && S.view === 'agent' && e.target === document.body) e.preventDefault(); });
  addEventListener('keyup', e => { keys[e.code] = false; });
  canvas.addEventListener('mousedown', e => { if (S.view !== 'agent') return; unlockAudio(); if (!document.pointerLockElement && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (x) {} } });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => { const drag = e.buttons & 1; if (!locked && !drag) return; if (S.view !== 'agent') return; const sx = e.movementX || 0, sy = e.movementY || 0; P.yaw -= sx * .0023; P.pitch = Math.max(-1.2, Math.min(1.2, P.pitch - sy * .0023)); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  $('#hud-lab').onclick = () => $('#lab').classList.toggle('open');

  /* ------------------------------------------------------------ gaze / proximity → phone app */
  const FWD = new THREE.Vector3(); const dwell = { id: null, t: 0 }; const shownAt = {}; let cardTimer = 0;
  const angTo = (x, y, z) => { const cx = x - P.x, cy = y - EYE, cz = z - P.z, len = Math.hypot(cx, cy, cz); return Math.acos(Math.min(1, Math.max(-1, (FWD.x * cx + FWD.y * cy + FWD.z * cz) / len))); };
  function showItemCard(id) {   // no corner card any more: QI explains in the chat thread
    const e = EXHMAP[id]; if (!e) return; shownAt[id] = performance.now();
    if (!S.prog[id]) { S.prog[id] = { date: new Date().toLocaleDateString(S.set.lang === 'en' ? 'en-US' : S.set.lang, { month: 'short', day: 'numeric' }), seen: true }; save(); log('seen: ' + id); }
    const fresh = !S.started; if (fresh) { try { startFree(); } catch (x) {} }          // looking at an exhibit before pressing Start: open the conversation first
    let tries = 0; const go = () => { if (window.qiIntroduce && qiIntroduce(id)) return; if (++tries < 14) setTimeout(go, 500); };
    if (fresh) { setTimeout(() => { try { stopSpeak(); } catch (x) {} go(); }, 900); } else go();
  }
  function updateAgentLink(dt) {
    camera.getWorldDirection(FWD);
    let nearest = null, nd = 1e9, gazeId = null, gazeAng = 1e9;
    for (const id of Object.keys(STN)) { const a = STN[id], d = Math.hypot(a.x - P.x, a.z - P.z); if (d < nd) { nd = d; nearest = id; } const ang = angTo(a.x, ART_Y, a.z); if (d < 8.5 && ang < .2 && ang < gazeAng) { gazeAng = ang; gazeId = id; } }
    const okState = S.started && S.view === 'agent' && ['idle', 'observe', 'cooldown', 'quiet'].includes(S.state);
    if (okState) { const cur = S.near; let want = cur; const dCur = cur && STN[cur] ? Math.hypot(STN[cur].x - P.x, STN[cur].z - P.z) : 1e9;
      if (cur && dCur < 10 && !(nearest !== cur && nd < 4.2 && dCur > nd + 3)) want = cur; else want = nd < 6.5 ? nearest : null;
      if (want !== cur) setNear(want); }
    if (S.near && STN[S.near] && ['signal', 'guide', 'question'].includes(S.state) && Math.hypot(STN[S.near].x - P.x, STN[S.near].z - P.z) > 11) softWithdraw();
    const gz = !!(gazeId && S.near === gazeId && S.view === 'agent' && !document.hidden);
    if (gz !== S.worldGaze) { S.worldGaze = gz; log(gz ? 'view locked on artifact' : 'view left artifact'); renderLab(); }
    // free-browsing exhibits: look at one for ~1.6 s and QI introduces it
    let best = null, ba = 1e9; const free = S.view === 'agent' && !gz && (!S.started || S.chatMini || ['idle', 'observe', 'cooldown', 'quiet'].includes(S.state));
    if (free) for (const it of ITEMS) { const d = Math.hypot(it.x - P.x, it.z - P.z); if (d > 7.5) continue; const ang = angTo(it.x, it.y, it.z); if (ang < .17 && ang < ba) { ba = ang; best = it; } }
    if (best && best.id === dwell.id) dwell.t += dt; else { dwell.id = best ? best.id : null; dwell.t = 0; }
    if (best) { S.stats.gaze[best.nation] = (S.stats.gaze[best.nation] || 0) + dt * 1000; if (dwell.t > 1.6 && (!shownAt[best.id] || performance.now() - shownAt[best.id] > 600000)) showItemCard(best.id); }
    const xh = $('#xhair'); const thr = threshold(); xh.classList.toggle('on', gz || !!best);
    xh.style.setProperty('--gz', gz ? (S.state === 'observe' ? Math.min(100, S.gazeMs / thr * 100) : (['signal', 'guide', 'question'].includes(S.state) ? 100 : 0)) : (best ? Math.min(100, dwell.t / 1.6 * 100) : 0));
    for (const id of Object.keys(ARTW)) { const w = ARTW[id], isNear = S.near === id; let target = 0.0; if (isNear) target = S.state === 'observe' ? .5 : (['signal', 'guide', 'question', 'explain'].includes(S.state) ? 1.6 : .8); w.light.intensity += (target * 5 - w.light.intensity) * Math.min(1, dt * 4);
      const pulse = isNear && S.state === 'guide' ? 1 + S.lvl * .25 : 1; w.group.scale.setScalar(pulse); if (w.billboard) w.billboard.material.uniforms.glow.value = isNear ? S.lvl + .3 : 0; }
    return { nearest, nd };
  }

  /* ------------------------------------------------------------ HUD + minimap */
  const mm = $('#minimap'), mg = mm.getContext('2d'); const ZMIN = HALL.z0 - 2, MK = Math.min(480 / (HALL.z1 - ZMIN), 220 / 46);
  const mx = x => (x - (-16)) * MK + 8, mz = z => (z - ZMIN) * MK;
  const MAPCOL = { dark: '#4a4b4e', gogu: '#34363a', baek: '#e9ecef', silla: '#7a4a3a' };
  function drawMap() {
    mg.clearRect(0, 0, mm.width, mm.height);
    mg.fillStyle = '#e6dac6'; mg.fillRect(mx(HALL.x0), mz(HALL.z0), (HALL.x1 - HALL.x0) * MK, (HALL.z1 - HALL.z0) * MK);
    for (const r of ROOMS) { mg.fillStyle = MAPCOL[r.theme]; mg.fillRect(mx(WING.x0), mz(r.z1), (WING.x1 - WING.x0) * MK, (r.z0 - r.z1) * MK); }
    mg.strokeStyle = '#8a8c90'; mg.lineWidth = 1.5; for (const z of DIV) { mg.beginPath(); mg.moveTo(mx(8), mz(z)); mg.lineTo(mx(32), mz(z)); mg.stroke(); }
    mg.strokeStyle = '#222'; mg.lineWidth = 2.5; mg.strokeRect(mx(HALL.x0), mz(HALL.z0), (WING.x1 - HALL.x0) * MK, (HALL.z1 - HALL.z0) * MK);
    mg.font = '600 14px sans-serif'; mg.textAlign = 'center';
    for (const r of ROOMS) { if (r.z0 - r.z1 < 8 && !['101-102'].includes(r.no)) continue; mg.fillStyle = r.theme === 'baek' ? '#444' : '#d8d8d4'; mg.fillText(r.no, mx(20), mz((r.z0 + r.z1) / 2) + 5); }
    mg.fillStyle = '#7b6f5c'; mg.fillText('Hall', mx(-3), mz(-20));
    for (const it of ITEMS) { mg.beginPath(); mg.arc(mx(it.x), mz(it.z), 2.6, 0, 7); mg.fillStyle = S.prog[it.id] ? '#35B39A' : '#b0a99c'; mg.fill(); }
    const nx = S.started ? nextPending() : null;
    for (const id of Object.keys(STN)) { const s = STN[id], on = id === nx; mg.beginPath(); mg.arc(mx(s.x), mz(s.z), on ? 8 : 5, 0, 7); mg.fillStyle = S.done.has(id) ? '#8d8d92' : (on ? '#35B39A' : ART[id].c[1]); mg.fill(); if (on) { mg.strokeStyle = '#35B39A'; mg.lineWidth = 2; mg.beginPath(); mg.arc(mx(s.x), mz(s.z), 13, 0, 7); mg.stroke(); } }
    mg.save(); mg.translate(mx(P.x), mz(P.z)); mg.rotate(-P.yaw); mg.fillStyle = '#ff5a4d'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.beginPath(); mg.moveTo(0, -11); mg.lineTo(7.5, 8); mg.lineTo(0, 4); mg.lineTo(-7.5, 8); mg.closePath(); mg.fill(); mg.stroke(); mg.restore();
  }
  function roomName() { if (P.x < 8) return { name: S.set.lang === 'ko' ? '역사의 길 (대공간)' : 'Great Hall · History Road', sub: '1F' };
    const r = ROOMS.find(x => P.z <= x.z0 && P.z > x.z1) || ROOMS[0]; const nation = r.key ? t('nations')[r.key] : (S.set.lang === 'ko' ? r.ko : r.en); return { name: `${r.no} · ${nation}`, sub: S.set.lang === 'ko' ? '선사·고대관 1F' : 'Prehistory & Ancient 1F' }; }
  const HINT = { en: ['Click the scene to look around', 'WASD walk · Shift run · mouse look · Esc release · F look at phone'], ko: ['화면을 클릭하면 둘러볼 수 있어요', 'WASD 걷기 · Shift 달리기 · 마우스 시점 · Esc 해제 · F 폰 보기'], ja: ['画面をクリックすると見回せます', 'WASD 歩く · Shift 走る · マウス 視点 · Esc 解除 · F スマホを見る'], zh: ['点击画面即可环顾四周', 'WASD 行走 · Shift 奔跑 · 鼠标环顾 · Esc 释放 · F 看手机'] };
  function updateHud() {
    const rn = roomName(); $('#rs-name').textContent = rn.name; $('#rs-sub').textContent = rn.sub;
    const nx = document.body.classList.contains('demo') && S.started && S.view === 'agent' ? nextPending() : null, tag = $('#nexttag');   // free tour: no "suggested next" pill (demo mode only)
    if (nx) { const st = STN[nx], d = Math.round(Math.hypot(st.x - P.x, st.z - P.z)); if (d > 5) { tag.style.display = 'block'; tag.textContent = `${t('sugg')} ➜ ${L(ART[nx].name)} · ${d} m`; } else tag.style.display = 'none'; } else tag.style.display = 'none';
    const aw = $('#autowalk'); aw.style.display = (nx && Math.hypot(STN[nx].x - P.x, STN[nx].z - P.z) > 7 && !AW.on) ? 'block' : 'none'; aw.textContent = t('autoWalk');
    const hint = $('#ctrlhint'); const show = S.view === 'agent' && !locked; hint.style.opacity = show ? 1 : 0; const h = HINT[S.set.lang] || HINT.en; hint.innerHTML = `${h[0]}<small>${h[1]}</small>`;
    const wm = $('#worldmsg'); const need = S.state === 'guide' && !S.camOn && S.view === 'agent'; wm.classList.toggle('on', need); if (need) wm.textContent = t('tapHintW');
    $('#xhair').style.display = S.view === 'agent' ? 'block' : 'none';
  }

  /* ------------------------------------------------------------ loop */
  let last = performance.now(), tAcc = 0, frames = 0;
  function loop(now) {
    requestAnimationFrame(loop); const dt = Math.min(.05, (now - last) / 1000); last = now; tAcc += dt;
    if (S.set.lang !== lastLang) { lastLang = S.set.lang; refreshPlates(); }
    if (S.view === 'agent' && !document.hidden) {
      const run = keys.ShiftLeft || keys.ShiftRight, sp = (run ? 8 : 4.4) * dt; let f = 0, r = 0; if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1; if (keys.KeyD || keys.ArrowRight) r += 1; if (keys.KeyA || keys.ArrowLeft) r -= 1;
      if (keys.KeyQ) P.yaw += 1.6 * dt; if (keys.KeyE) P.yaw -= 1.6 * dt;
      if (f || r) { const l = Math.hypot(f, r); f /= l; r /= l; const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw); tryMove((fx * f + rx * r) * sp, (fz * f + rz * r) * sp); P.bob += dt * (run ? 11 : 7.5); }
    } else if (document.pointerLockElement && S.view !== 'agent') document.exitPointerLock();
    stepAutoWalk(dt);
    camera.position.set(P.x, EYE + Math.sin(P.bob) * .028, P.z); camera.rotation.order = 'YXZ'; camera.rotation.set(P.pitch, P.yaw, 0); camera.updateMatrixWorld();
    for (const id of Object.keys(ARTW)) { const w = ARTW[id]; if (!w.fixed) w.group.position.y = w.y0 + Math.sin(tAcc * 1.4 + STN[id].z) * .04; if (w.billboard) w.billboard.rotation.y = Math.atan2(P.x - w.group.position.x, P.z - w.group.position.z); else if (w.base) w.base.rotation.y += dt * .5; }
    /* artifacts stay still (museum objects don't spin) */
    updateAgentLink(dt);
    const nx = document.body.classList.contains('demo') && S.started && S.view === 'agent' ? nextPending() : null; if (nx && Math.hypot(STN[nx].x - P.x, STN[nx].z - P.z) > 4.2) placeDots(pathTo(nx, P.x, P.z), tAcc); else placeDots([[0, 0], [0, 0]], tAcc);
    updateHud(); drawMap(); renderer.render(scene, camera); if (++frames === 40 && window.bootDone) bootDone();
  }
  refreshPlates(); requestAnimationFrame(loop); console.log('world ready');
})();
