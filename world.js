/* =====================================================================
   World — first-person 3D museum (National Museum of Korea, 1F, simplified)
   Layout follows the official floor map (leaflet 2026-07-20):
   entrance → great hall ("history road") → right wing:
   101 Paleolithic → 102 Neolithic → 103 Bronze Age → 104 Gojoseon·Buyeo·Samhan
   → 105 Goguryeo → 106 Baekje → 107 Gaya → 108-110 Silla
   Look & feel follows /museum background: warm travertine great hall with skylights, glossy floor and a dark
   stone pagoda; dark charcoal galleries with black vitrines, linear ceiling lights and a pale guide line on the floor.
   Uses the globals of the phone app (S, ART, setNear, t, L, ...).  x = east, -z = north.   Disable with ?world=0
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

  /* ------------------------------------------------------------ constants */
  // the rooms 101-104 (before the artifacts) are compressed so the walk to the first artifact is short enough for a live demo
  const zm = z => z >= -12 ? z : z >= -62 ? -12 + (z + 12) * 0.45 : -34.5 + (z + 62);
  const H = 5, HH = 11, EYE = 1.62;             // wing ceiling / great-hall ceiling / eye height
  const HALL = { x0: -14, x1: 8, z0: zm(-142), z1: 8 }, WING = { x0: 8, x1: 32, z0: zm(-142), z1: -10 };
  const OPEN = [[-24, -12], [-80, -66], [-134, -120]].map(([a, b]) => [zm(a), zm(b)]);               // openings in the hall/wing wall (z ranges)
  const DIV = [-24, -36, -50, -62, -80, -96, -112].map(zm);                  // room dividers inside the wing
  const SIGNS = [
    { z: -12, no: '101', ko: '구석기', en: 'Paleolithic' }, { z: -24, no: '102', ko: '신석기', en: 'Neolithic' }, { z: -36, no: '103', ko: '청동기', en: 'Bronze Age' },
    { z: -50, no: '104', ko: '고조선·부여·삼한', en: 'Gojoseon · Buyeo · Samhan' }, { z: -62, no: '105', key: 'gogu' }, { z: -80, no: '106', key: 'baek' }, { z: -96, no: '107', key: 'gaya' }, { z: -112, no: '108-110', key: 'silla' } ];
  SIGNS.forEach(sg => sg.z = zm(sg.z));
  const STN = { gogu: { x: 27, z: -72 }, baek: { x: 13, z: -88 }, absent: { x: 27, z: -88 }, gaya: { x: 27, z: -104 }, silla: { x: 14, z: -128 } };
  const STAND = { gogu: [22.5, -69], baek: [17.5, -85], absent: [22.5, -85], gaya: [22.5, -101], silla: [19.5, -125] };
  const SPINE = [[0, 3], [0, -16], [20, -16], [20, -70], [20, -86], [20, -102], [20, -126]];
  for (const k in STN) STN[k].z = zm(STN[k].z); for (const k in STAND) STAND[k][1] = zm(STAND[k][1]); SPINE.forEach(p => p[1] = zm(p[1]));
  const ART_Y = 1.9;                                                // height of the artifact centre inside its vitrine

  /* ------------------------------------------------------------ scene, environment */
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#1a1a1b'); scene.fog = new THREE.Fog('#2a2927', 30, 150);
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 240);
  // soft studio-like environment so the glossy floor and glass pick up bright panels
  { const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene(); env.background = new THREE.Color('#6d6a66');
    const panel = (c, w, h, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    panel('#ffffff', 30, 30, 0, 14, 0, Math.PI / 2, 0); panel('#ffe9c8', 16, 8, -16, 5, 0, 0, Math.PI / 2); panel('#dfe8f5', 16, 8, 16, 5, 0, 0, Math.PI / 2);
    scene.environment = pm.fromScene(env, 0.03).texture; pm.dispose(); }
  scene.add(new THREE.HemisphereLight('#fff4e4', '#8d8478', 1.1)); const sun = new THREE.DirectionalLight('#fff3dc', 1.4); sun.position.set(-8, 30, -20); scene.add(sun);
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .85, metalness: 0 }, o));
  const BLACK = mat('#17181a', { roughness: .45 }), TRIM = mat('#3a3b3e', { roughness: .4, metalness: .3 });
  const GLASS = new THREE.MeshStandardMaterial({ color: '#cfe4f2', transparent: true, opacity: .13, roughness: .04, metalness: .1, depthWrite: false });
  const GLOW = new THREE.MeshBasicMaterial({ color: '#fff0d2' });
  const add = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); return m; };
  const box = (w, h, d, x, y, z, m) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);

  /* textures */
  function canvasTex(w, h, draw, rx = 1, ry = 1) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  const stoneTex = (rx, ry) => canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d3c1a5'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#d8c7ac' : '#cdbb9e'; g.fillRect(0, i * 64, w, 64); g.fillStyle = '#b9a789'; g.fillRect(0, i * 64, w, 2); } g.fillStyle = '#b9a789'; g.fillRect(128, 0, 2, 64); g.fillRect(64, 64, 2, 64); g.fillRect(192, 128, 2, 64); g.fillRect(96, 192, 2, 64); }, rx, ry);
  const hallFloorTex = (rx, ry) => canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d9cab2'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c3b399'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(6, 6, 116, 116); g.fillRect(134, 134, 116, 116); }, rx, ry);
  const wingFloorTex = (rx, ry) => canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#3a3836'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2b2a28'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(6, 6, 116, 116); g.fillRect(134, 134, 116, 116); }, rx, ry);
  const gridTex = (rx, ry) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#212224'; g.fillRect(0, 0, w, h); g.strokeStyle = '#17181a'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); }, rx, ry);

  const STONE = tex => new THREE.MeshStandardMaterial({ map: tex, roughness: .7 });
  const DARK = mat('#2c2d30', { roughness: .8 });

  /* floors / ceilings */
  function slab(r, floorMat, ceilMat, ceilH) { const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat); f.rotation.x = -Math.PI / 2; add(f, cx, 0, cz); const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat); c.rotation.x = Math.PI / 2; add(c, cx, ceilH, cz); }
  { const t = hallFloorTex((HALL.x1 - HALL.x0) / 4, (HALL.z1 - HALL.z0) / 4); slab(HALL, new THREE.MeshStandardMaterial({ map: t, roughness: .16, metalness: .05, envMapIntensity: 1.1 }), mat('#d6c9b3'), HH); }
  { const t = wingFloorTex((WING.x1 - WING.x0) / 4, (WING.z1 - WING.z0) / 4), g = gridTex((WING.x1 - WING.x0) / 1.2, (WING.z1 - WING.z0) / 1.2); slab(WING, new THREE.MeshStandardMaterial({ map: t, roughness: .32, metalness: .05, envMapIntensity: .8 }), new THREE.MeshStandardMaterial({ map: g, roughness: .9 }), H); }
  // skylights over the great hall (bright panels with dark mullions)
  const SKY = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const [cz, sz] of [[-116, 18], [-62, 12], [-14, 12]].map(([c, z]) => [zm(c), z])) { box(14, .1, sz, -3, HH - .06, cz, SKY); for (let i = -2; i <= 2; i++) box(.18, .14, sz, -3 + i * 3, HH - .12, cz, TRIM); for (let j = -2; j <= 2; j++) box(14, .14, .18, -3, HH - .12, cz + j * sz / 4, TRIM); }
  // linear ceiling lights in the galleries (like the reference photo)
  const STRIP = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const x of [13.5, 26.5]) box(.12, .04, WING.z1 - WING.z0 - 2, x, H - .03, (WING.z0 + WING.z1) / 2, STRIP);
  // pale guide line on the gallery floor (reference photo)
  box(.14, .012, WING.z1 - WING.z0, 20, .006, (WING.z0 + WING.z1) / 2, new THREE.MeshBasicMaterial({ color: '#d9c9a6' }));

  /* walls + collision obstacles */
  const OBST = [];
  function wall(x, z, w, d, mats, solid = true, h = H) { box(w, h, d, x, h / 2, z, mats); if (solid) OBST.push({ x0: x - w / 2 - .3, x1: x + w / 2 + .3, z0: z - d / 2 - .3, z1: z + d / 2 + .3 }); }
  const hallStone = STONE(stoneTex(6, 3));
  // outer shell
  wall(-14, (HALL.z0 + HALL.z1) / 2, .4, HALL.z1 - HALL.z0, hallStone, false, HH); wall(0, HALL.z0, 22, .4, hallStone, false, HH);
  wall(-9, HALL.z1, 10, .4, hallStone, false, HH); wall(6, HALL.z1, 4, .4, hallStone, false, HH); box(8, HH - 4, .4, 0, (HH + 4) / 2, HALL.z1, hallStone);
  wall(32, (WING.z0 + WING.z1) / 2, .4, WING.z1 - WING.z0, DARK, false); wall(20, WING.z0, 24, .4, DARK, false); wall(20, WING.z1, 24, .4, DARK, false);
  // glass entrance with daylight outside
  add(new THREE.Mesh(new THREE.BoxGeometry(8, 4, .1), GLASS), 0, 2, HALL.z1); for (const x of [-4, 0, 4]) box(.12, 4, .12, x, 2, HALL.z1, TRIM);
  { const day = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshBasicMaterial({ color: '#e6eef8' })); day.rotation.y = Math.PI; add(day, 0, 12, HALL.z1 + 8); }
  // hall / wing wall: hall side travertine, wing side charcoal
  { let z = WING.z0; const segs = []; const sorted = OPEN.slice().sort((a, b) => a[0] - b[0]); for (const [a, b] of sorted) { if (a > z) segs.push([z, a]); z = b; } if (z < WING.z1) segs.push([z, WING.z1]);
    const two = [DARK, hallStone, DARK, DARK, DARK, DARK];
    for (const [a, b] of segs) wall(8, (a + b) / 2, .6, b - a, two, true, HH);
    for (const [a, b] of OPEN) { box(.6, HH - H, b - a, 8, (HH + H) / 2, (a + b) / 2, two); box(.62, .9, b - a, 8, H - .45, (a + b) / 2, DARK); } }
  // dividers between rooms: two solid sides and a lintel over the 8 m doorway
  for (const z of DIV) { wall(12, z, 8, .5, DARK); wall(28, z, 8, .5, DARK); box(8, 1.5, .5, 20, H - .75, z, DARK); }
  box(8, 1.2, .5, 20, H - .6, -12, DARK);
  // dark recessed niches on the hall wall, like the reference photo
  for (let zz = -22; zz > -136; zz -= 14) { const z = zm(zz); const n = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.2), new THREE.MeshStandardMaterial({ color: '#6b5f50', roughness: 1 })); n.rotation.y = Math.PI / 2; add(n, -13.78, 3.4, z); const ln = new THREE.Mesh(new THREE.PlaneGeometry(3.2, .08), GLOW); ln.rotation.y = Math.PI / 2; add(ln, -13.76, 5.5, z); }

  /* label textures */
  function labelTex(lines, w, h, opt = {}) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = opt.bg || '#17181a'; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => { g.font = `${i === 0 ? '700' : '500'} ${ln.size}px "Apple SD Gothic Neo","Hiragino Sans","PingFang SC","Noto Sans KR",sans-serif`; g.fillStyle = ln.color || (opt.fg || '#f1f1ef'); g.fillText(ln.text, w / 2, ln.y); }); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  const signMeshes = [];
  function roomSignText(sg) { const nation = sg.key ? t('nations')[sg.key] : (S.set.lang === 'ko' ? sg.ko : sg.en); const sub = sg.key ? '' : (S.set.lang === 'ko' ? sg.en : sg.ko); return [{ text: `${sg.no}`, size: 44, y: 48, color: '#a8a8a2' }, { text: nation, size: 62, y: 118 }].concat(sub ? [{ text: sub, size: 32, y: 170, color: '#a8a8a2' }] : []); }
  for (const sg of SIGNS) { const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: labelTex(roomSignText(sg), 640, 200) })); m.position.set(20, H - .75, sg.z + .28); scene.add(m); sg.mesh = m; signMeshes.push(sg); }
  { const es = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1), new THREE.MeshBasicMaterial({ map: labelTex([{ text: '국립중앙박물관 · National Museum of Korea', size: 46, y: 70 }], 1024, 140, { bg: '#e6dac6', fg: '#2a2723' }) })); es.position.set(0, 4.6, HALL.z1 - .3); es.rotation.y = Math.PI; scene.add(es); }
  // wall text bands (faint grey panels with tiny text lines)
  const bandTex = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#d5d6d3'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3b3e'; g.fillRect(14, 12, 150, 16); g.fillStyle = '#8c8e8a'; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(14 + c * 168, 38 + r * 12, 150 - (r * 13) % 40, 5); });
  const bandMat = new THREE.MeshBasicMaterial({ map: bandTex, color: '#bfc0bc' });
  for (const z of [-18, -30, -43, -56, -71, -88, -104, -127].map(zm)) { const b = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 1.6), bandMat); b.rotation.y = -Math.PI / 2; add(b, 31.78, 1.9, z); }
  for (const z of [-45, -100].map(zm)) { const b = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 1.6), bandMat); b.rotation.y = Math.PI / 2; add(b, 8.36, 1.9, z); }

  /* ---------- vitrines (black display cases) ---------- */
  function vitrine(x, z, w = 1.5, baseH = .9, glassH = 1.9) {
    box(w, baseH, w, x, baseH / 2, z, BLACK); box(w + .06, .05, w + .06, x, baseH + .025, z, TRIM);
    add(new THREE.Mesh(new THREE.BoxGeometry(w, glassH, w), GLASS), x, baseH + .05 + glassH / 2, z);
    box(w + .06, .12, w + .06, x, baseH + .05 + glassH + .06, z, BLACK); box(w - .12, .03, w - .12, x, baseH + .05 + glassH - .02, z, GLOW);   // lit canopy
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(.04, glassH, .04, x + dx * w / 2, baseH + .05 + glassH / 2, z + dz * w / 2, TRIM);
    OBST.push({ x0: x - w / 2 - .45, x1: x + w / 2 + .45, z0: z - w / 2 - .45, z1: z + w / 2 + .45 });
  }
  // generic props in rooms 101-104 (simple stones / pots so the rooms do not feel empty)
  const props = [[12, -18, 'stone'], [28, -18, 'stone'], [28, -30, 'pot'], [12, -30, 'pot'], [12, -43, 'bronze'], [28, -43, 'bronze'], [28, -56, 'bronze'], [12, -56, 'pot']];
  for (const [x, z0, kind] of props) { const z = zm(z0); vitrine(x, z, 1.2, .8, 1.35); const m = kind === 'stone' ? new THREE.Mesh(new THREE.DodecahedronGeometry(.3, 0), mat('#a39d92')) : kind === 'pot' ? new THREE.Mesh(new THREE.ConeGeometry(.26, .6, 16), mat('#b98f6a')) : new THREE.Mesh(new THREE.CylinderGeometry(.22, .3, .45, 18), mat('#7d9a86', { metalness: .3 })); add(m, x, 1.55, z); }
  // Gyeongcheonsa pagoda (dark stone, stacked tiers) + digital Gwanggaeto stele in the great hall
  const PZ = zm(-118), SZ = zm(-62);
  { box(5.6, .6, 5.6, -3, .3, PZ, mat('#3a3937')); let y = .6; for (let i = 0; i < 10; i++) { const s = 4.2 - i * .26; const tier = new THREE.Mesh(new THREE.BoxGeometry(s, .7, s), mat(i % 2 ? '#4c4a47' : '#5a5753', { roughness: .9 })); tier.position.set(-3, y + .35, PZ); scene.add(tier);
      for (let k = -1; k <= 1; k++) { const rel = new THREE.Mesh(new THREE.BoxGeometry(.5, .45, .06), mat('#2f2e2c')); rel.position.set(-3 + k * s / 3.2, y + .35, PZ + s / 2 + .02); scene.add(rel); }
      y += .7; const roof = new THREE.Mesh(new THREE.BoxGeometry(s + .55, .16, s + .55), mat('#363532')); roof.position.set(-3, y + .08, PZ); scene.add(roof); y += .16 + .08; }
    OBST.push({ x0: -6.4, x1: .4, z0: PZ - 3.4, z1: PZ + 3.4 }); }
  { const st = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.8, .8), mat('#e9eef7', { emissive: '#bcd3ff', emissiveIntensity: .5 })); add(st, -3, 2.4, SZ); box(2.4, .3, 1.6, -3, .15, SZ, mat('#2a2b2d')); OBST.push({ x0: -4.7, x1: -1.3, z0: SZ - 1.2, z1: SZ + 1.2 }); }

  /* ---------- artifacts ---------- */
  const WHITEKEY = { vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'uniform sampler2D map; uniform float glow; varying vec2 vUv; void main(){ vec4 c=texture2D(map,vUv); float m=min(c.r,min(c.g,c.b)); float a=(1.0-smoothstep(0.9,0.985,m))*c.a; gl_FragColor=vec4(c.rgb+glow*0.12,a); gl_FragColor=linearToOutputTexel(gl_FragColor);} ' };
  const ARTW = {};   // id -> {group, light, billboard?, base}
  function procedural(id) {
    const a = ART[id], c0 = new THREE.Color(a.c[0]), c1 = new THREE.Color(a.c[1]), c2 = new THREE.Color(a.c[2]); const g = new THREE.Group(); const m = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .55, metalness: .05 }, o));
    if (id === 'gogu') { const prof = [[0, 0], [.34, 0], [.4, .08], [.52, .3], [.5, .5], [.36, .62], [.14, .7], [0, .72]].map(p => new THREE.Vector2(p[0], p[1])); const v = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), m(c1)); g.add(v); const lid = new THREE.Mesh(new THREE.SphereGeometry(.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m(c2)); lid.position.y = .7; g.add(lid); const ring = new THREE.Mesh(new THREE.TorusGeometry(.5, .025, 8, 36), m(c0)); ring.rotation.x = Math.PI / 2; ring.position.y = .34; g.add(ring); g.position.y = -.35; }
    else if (id === 'baek') { const b = new THREE.Mesh(new THREE.BoxGeometry(1, .22, 1), m(c1)); g.add(b); const peak = (x, z, h) => { const k = new THREE.Mesh(new THREE.ConeGeometry(.26, h, 6), m(c2)); k.position.set(x, .11 + h / 2, z); g.add(k); }; peak(-.2, .1, .4); peak(.15, -.05, .5); peak(.32, .2, .3); const hut = new THREE.Mesh(new THREE.BoxGeometry(.16, .1, .16), m(c0)); hut.position.set(-.3, .27, -.25); g.add(hut); const roof = new THREE.Mesh(new THREE.ConeGeometry(.15, .1, 4), m('#d98aa8')); roof.position.set(-.3, .37, -.25); roof.rotation.y = Math.PI / 4; g.add(roof); g.rotation.x = -.5; }
    else if (id === 'gaya') { const body = new THREE.Mesh(new THREE.CylinderGeometry(.42, .34, .7, 24, 1, true), m(c1, { side: THREE.DoubleSide })); g.add(body); for (let i = 0; i < 5; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(.38 - i * .01, .028, 8, 28), m(c0)); band.rotation.x = Math.PI / 2; band.position.y = -.28 + i * .14; g.add(band); } const helm = new THREE.Mesh(new THREE.ConeGeometry(.22, .34, 20), m(c2)); helm.position.y = .55; g.add(helm); for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.SphereGeometry(.025, 8, 6), m('#ff8a3d')); const an = i / 8 * Math.PI * 2; r.position.set(Math.cos(an) * .2, .43, Math.sin(an) * .2); g.add(r); } }
    else if (id === 'silla') { const band = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .12, 28, 1, true), m(c1, { side: THREE.DoubleSide, metalness: .5, roughness: .35 })); g.add(band); const up = (x, h, rot) => { const u = new THREE.Mesh(new THREE.BoxGeometry(.05, h, .02), m(c1, { metalness: .5, roughness: .35 })); u.position.set(x, .06 + h / 2, 0); u.rotation.z = rot; g.add(u); const top = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), m(c2)); top.position.set(x + Math.sin(-rot) * h / 2, .06 + h, 0); g.add(top); }; up(-.2, .42, .06); up(0, .55, 0); up(.2, .42, -.06); for (let i = 0; i < 9; i++) { const an = (i / 9 - .5) * Math.PI * 1.6, j = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 6), m(i % 2 ? '#9fe3c8' : c2, { emissive: i % 2 ? '#9fe3c8' : '#000', emissiveIntensity: .2 })); j.position.set(Math.sin(an) * .3, -.08, Math.cos(an) * .3); g.add(j); } g.scale.setScalar(1.5); }
    else { const prof = [[0, 0], [.3, 0], [.38, .08], [.18, .22], [.14, .4], [.3, .6], [.22, .78], [.04, .9]].map(p => new THREE.Vector2(p[0], p[1])); const v = new THREE.Mesh(new THREE.LatheGeometry(prof, 30), new THREE.MeshStandardMaterial({ color: c1, transparent: true, opacity: .55, emissive: c2, emissiveIntensity: .6, roughness: .3 })); g.add(v); g.position.y = -.4; }
    return g;
  }
  function loadTex(id, cb) { new THREE.TextureLoader().load(`assets/artifacts/${id}.png`, tex => { tex.colorSpace = THREE.SRGBColorSpace; cb(tex); }, undefined, () => {}); }
  for (const id of Object.keys(STN)) {
    const { x, z } = STN[id]; vitrine(x, z, 1.5, .9, 1.9);
    const g = new THREE.Group(); g.position.set(x, ART_Y, z); scene.add(g); const base = procedural(id); g.add(base);
    const light = new THREE.PointLight(ART[id].c[1], 0, 6, 2); light.position.set(x, 2.7, z + 1.2); scene.add(light);
    const spot = new THREE.PointLight('#fff1d6', 5, 4.5, 2); spot.position.set(x, 2.75, z); scene.add(spot);     // warm case light
    ARTW[id] = { group: g, base, light, billboard: null, y0: ART_Y };
    loadTex(id, tex => { const aspect = tex.image.width / tex.image.height, mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3 * aspect, 1.3), new THREE.ShaderMaterial(Object.assign({ uniforms: { map: { value: tex }, glow: { value: 0 } }, transparent: true, depthWrite: false }, WHITEKEY))); g.remove(base); g.add(mesh); ARTW[id].billboard = mesh; ARTW[id].base = null; console.log('artifact image loaded:', id); });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .38), new THREE.MeshBasicMaterial({ map: labelTex([{ text: '', size: 30, y: 50 }], 512, 160) })); plate.position.set(x, .55, z + .76); scene.add(plate); ARTW[id].plate = plate;
  }
  function refreshPlates() { for (const id of Object.keys(STN)) { const mt = ARTW[id].plate.material; const nm = L(ART[id].name); mt.map = labelTex([{ text: nm.length > 20 ? nm.slice(0, 19) + '…' : nm, size: 36, y: 60 }, { text: t('nations')[id], size: 28, y: 112, color: '#a8a8a2' }], 512, 160); mt.needsUpdate = true; }
    for (const sg of signMeshes) { sg.mesh.material.map = labelTex(roomSignText(sg), 640, 200); sg.mesh.material.needsUpdate = true; } }
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
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code === 'KeyG') autoWalk(); });
  $('#autowalk').onclick = () => { unlockAudio(); autoWalk(); };
  window.WORLD_API = {
    on: true, autoWalk,
    release() { if (document.pointerLockElement) document.exitPointerLock(); },
    setPose(x, z, yaw, pitch) { place(x, z, yaw); if (pitch != null) P.pitch = pitch; },
    teleport(id) { if (!id) { place(0, 3, 0); P.pitch = 0; return; } const s = STAND[id], a = STN[id]; place(s[0], s[1], Math.atan2(-(a.x - s[0]), -(a.z - s[1]))); P.pitch = Math.atan2(ART_Y - EYE, Math.hypot(a.x - s[0], a.z - s[1])); log('teleport → ' + id); },
    state: () => ({ x: P.x, z: P.z, yaw: P.yaw, locked }),
  };
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; const k = e.code; keys[k] = true; if (k === 'KeyF') { S.manualLook = true; renderLab(); clearTimeout(window._flook); window._flook = setTimeout(() => { S.manualLook = false; renderLab(); }, 1600); log('F: looked at phone'); } if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k) && S.view === 'agent' && e.target === document.body) e.preventDefault(); });
  addEventListener('keyup', e => { keys[e.code] = false; });
  canvas.addEventListener('mousedown', e => { if (S.view !== 'agent') return; unlockAudio(); if (!document.pointerLockElement && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (x) {} } });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => { const drag = e.buttons & 1; if (!locked && !drag) return; if (S.view !== 'agent') return; const sx = e.movementX || 0, sy = e.movementY || 0; P.yaw -= sx * .0023; P.pitch = Math.max(-1.2, Math.min(1.2, P.pitch - sy * .0023)); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  $('#hud-lab').onclick = () => $('#lab').classList.toggle('open');

  /* ------------------------------------------------------------ gaze / proximity → phone app */
  const FWD = new THREE.Vector3();
  function updateAgentLink(dt) {
    camera.getWorldDirection(FWD);
    let nearest = null, nd = 1e9, gazeId = null, gazeAng = 1e9;
    for (const id of Object.keys(STN)) { const a = STN[id], cx = a.x - P.x, cz = a.z - P.z, cy = ART_Y - EYE, d = Math.hypot(cx, cz); if (d < nd) { nd = d; nearest = id; }
      const len = Math.hypot(cx, cy, cz), dot = (FWD.x * cx + FWD.y * cy + FWD.z * cz) / len, ang = Math.acos(Math.min(1, Math.max(-1, dot))); if (d < 8.5 && ang < .2 && ang < gazeAng) { gazeAng = ang; gazeId = id; } }
    const okState = S.started && S.view === 'agent' && ['idle', 'observe', 'cooldown', 'quiet'].includes(S.state);
    if (okState) { const cur = S.near; let want = cur; const dCur = cur && STN[cur] ? Math.hypot(STN[cur].x - P.x, STN[cur].z - P.z) : 1e9;
      if (cur && dCur < 10 && !(nearest !== cur && nd < 4.2 && dCur > nd + 3)) want = cur; else want = nd < 6.5 ? nearest : null;
      if (want !== cur) setNear(want); }
    const gz = !!(gazeId && S.near === gazeId && S.view === 'agent' && !document.hidden);
    if (gz !== S.worldGaze) { S.worldGaze = gz; log(gz ? 'view locked on artifact' : 'view left artifact'); renderLab(); }
    const xh = $('#xhair'); const thr = threshold(); xh.classList.toggle('on', gz); xh.style.setProperty('--gz', S.state === 'observe' ? Math.min(100, S.gazeMs / thr * 100) : (['signal', 'guide', 'question'].includes(S.state) ? 100 : 0));
    for (const id of Object.keys(ARTW)) { const w = ARTW[id], isNear = S.near === id; let target = 0.0; if (isNear) target = S.state === 'observe' ? .5 : (['signal', 'guide', 'question', 'explain'].includes(S.state) ? 1.6 : .8); w.light.intensity += (target * 5 - w.light.intensity) * Math.min(1, dt * 4);
      const pulse = isNear && S.state === 'guide' ? 1 + S.lvl * .25 : 1; w.group.scale.setScalar(pulse); if (w.billboard) w.billboard.material.uniforms.glow.value = isNear ? S.lvl + .3 : 0; }
    return { nearest, nd };
  }

  /* ------------------------------------------------------------ HUD + minimap */
  const mm = $('#minimap'), mg = mm.getContext('2d'); const ZMIN = HALL.z0 - 2, MK = Math.min(480 / (HALL.z1 - ZMIN), 220 / 46);
  const mx = x => (x - (-16)) * MK + 8, mz = z => (z - ZMIN) * MK;
  function drawMap() {
    mg.clearRect(0, 0, mm.width, mm.height);
    mg.fillStyle = '#e6dac6'; mg.fillRect(mx(HALL.x0), mz(HALL.z0), (HALL.x1 - HALL.x0) * MK, (HALL.z1 - HALL.z0) * MK);
    mg.fillStyle = '#4a4b4e'; mg.fillRect(mx(WING.x0), mz(WING.z0), (WING.x1 - WING.x0) * MK, (WING.z1 - WING.z0) * MK);
    mg.strokeStyle = '#8a8c90'; mg.lineWidth = 1.5; for (const z of DIV) { mg.beginPath(); mg.moveTo(mx(8), mz(z)); mg.lineTo(mx(32), mz(z)); mg.stroke(); }
    mg.strokeStyle = '#222'; mg.lineWidth = 2.5; mg.strokeRect(mx(HALL.x0), mz(HALL.z0), (WING.x1 - HALL.x0) * MK, (HALL.z1 - HALL.z0) * MK);
    mg.fillStyle = '#d8d8d4'; mg.font = '600 15px sans-serif'; mg.textAlign = 'center';
    const rooms = [['101', -18], ['102', -30], ['103', -43], ['104', -56], ['105', -71], ['106', -88], ['107', -104], ['108-110', -127]].map(([n, z]) => [n, zm(z)]); for (const [n, z] of rooms) mg.fillText(n, mx(20), mz(z) + 5);
    mg.fillStyle = '#7b6f5c'; mg.fillText('Hall', mx(-3), mz(-20));
    const nx = S.started ? nextPending() : null;
    for (const id of Object.keys(STN)) { const s = STN[id], on = id === nx; mg.beginPath(); mg.arc(mx(s.x), mz(s.z), on ? 8 : 5, 0, 7); mg.fillStyle = S.done.has(id) ? '#8d8d92' : (on ? '#35B39A' : ART[id].c[1]); mg.fill(); if (on) { mg.strokeStyle = '#35B39A'; mg.lineWidth = 2; mg.beginPath(); mg.arc(mx(s.x), mz(s.z), 13, 0, 7); mg.stroke(); } }
    mg.save(); mg.translate(mx(P.x), mz(P.z)); mg.rotate(-P.yaw); mg.fillStyle = '#ff5a4d'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.beginPath(); mg.moveTo(0, -11); mg.lineTo(7.5, 8); mg.lineTo(0, 4); mg.lineTo(-7.5, 8); mg.closePath(); mg.fill(); mg.stroke(); mg.restore();
  }
  function roomName() { if (P.x < 8) return { name: S.set.lang === 'ko' ? '역사의 길 (대공간)' : 'Great Hall · History Road', sub: '1F' };
    let sg = null; for (const s of SIGNS) if (P.z <= s.z + .2) sg = s; if (!sg) sg = SIGNS[0]; const nation = sg.key ? t('nations')[sg.key] : (S.set.lang === 'ko' ? sg.ko : sg.en); return { name: `${sg.no} · ${nation}`, sub: S.set.lang === 'ko' ? '선사·고대관 1F' : 'Prehistory & Ancient 1F' }; }
  const HINT = { en: ['Click the scene to look around', 'WASD walk · Shift run · mouse look · Esc release · F look at phone · G auto-walk'], ko: ['화면을 클릭하면 둘러볼 수 있어요', 'WASD 걷기 · Shift 달리기 · 마우스 시점 · Esc 해제 · F 폰 보기 · G 자동 이동'], ja: ['画面をクリックすると見回せます', 'WASD 歩く · Shift 走る · マウス 視点 · Esc 解除 · F スマホを見る · G 自動移動'], zh: ['点击画面即可环顾四周', 'WASD 行走 · Shift 奔跑 · 鼠标环顾 · Esc 释放 · F 看手机 · G 自动前往'] };
  function updateHud() {
    const rn = roomName(); $('#rs-name').textContent = rn.name; $('#rs-sub').textContent = rn.sub;
    const nx = S.started && S.view === 'agent' ? nextPending() : null, tag = $('#nexttag');
    if (nx) { const st = STN[nx], d = Math.round(Math.hypot(st.x - P.x, st.z - P.z)); if (d > 5) { tag.style.display = 'block'; tag.textContent = `➜ ${L(ART[nx].name)} · ${d} m`; } else tag.style.display = 'none'; } else tag.style.display = 'none';
    const aw = $('#autowalk'); aw.style.display = (nx && Math.hypot(STN[nx].x - P.x, STN[nx].z - P.z) > 7 && !AW.on) ? 'block' : 'none'; aw.textContent = t('autoWalk');
    const hint = $('#ctrlhint'); const show = S.view === 'agent' && !locked; hint.style.opacity = show ? 1 : 0; const h = HINT[S.set.lang] || HINT.en; hint.innerHTML = `${h[0]}<small>${h[1]}</small>`;
    const wm = $('#worldmsg'); const need = S.state === 'guide' && !S.camOn && S.view === 'agent'; wm.classList.toggle('on', need); if (need) wm.textContent = t('tapHintW');
    $('#xhair').style.display = S.view === 'agent' ? 'block' : 'none';
  }

  /* ------------------------------------------------------------ loop */
  let last = performance.now(), tAcc = 0;
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
    for (const id of Object.keys(ARTW)) { const w = ARTW[id]; w.group.position.y = w.y0 + Math.sin(tAcc * 1.4 + STN[id].z) * .04; if (w.billboard) w.billboard.rotation.y = Math.atan2(P.x - w.group.position.x, P.z - w.group.position.z); else if (w.base) w.base.rotation.y += dt * .5; }
    updateAgentLink(dt);
    const nx = S.started && S.view === 'agent' ? nextPending() : null; if (nx && Math.hypot(STN[nx].x - P.x, STN[nx].z - P.z) > 4.2) placeDots(pathTo(nx, P.x, P.z), tAcc); else placeDots([[0, 0], [0, 0]], tAcc);
    updateHud(); drawMap(); renderer.render(scene, camera);
  }
  refreshPlates(); requestAnimationFrame(loop); console.log('world ready');
})();
