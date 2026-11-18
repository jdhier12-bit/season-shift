import * as THREE from 'three';

// Simple, original low-poly clothes for the panda. Everything attaches to the panda's head group
// (hats) or rig (scarves, packs, capes). The panda faces -Z, so all detail is modelled on the back
// (+Z) side that the camera sees.

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function canvasTex(w, h, draw, repeatU = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatU, 1);
  return t;
}
const stripeTex = (colors, n = 8) => canvasTex(256, 16, (g, w, h) => {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect((i * w) / n, 0, w / n + 1, h); }
});
const capeTex = (base, trim, emblem) => canvasTex(256, 320, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,.18)'); grd.addColorStop(1, 'rgba(0,0,0,.18)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = trim; g.lineWidth = 18; g.strokeRect(9, -20, w - 18, h + 11);
  g.fillStyle = trim;
  g.save(); g.translate(w / 2, h * 0.42);
  if (emblem === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 26 : 62, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
  } else {
    // little crown emblem
    g.beginPath(); g.moveTo(-55, 30); g.lineTo(-55, -25); g.lineTo(-28, 5); g.lineTo(0, -40); g.lineTo(28, 5); g.lineTo(55, -25); g.lineTo(55, 30); g.closePath(); g.fill();
  }
  g.restore();
});

const M = {};
function mats() {
  if (M.ready) return M;
  Object.assign(M, {
    ready: true,
    knit: lam(0xffffff, { map: stripeTex(['#2bb3a6', '#24998e'], 24) }),
    cream: lam(0xfff4e0),
    pom: lam(0xfff4e0),
    straw: lam(0xe8c56a),
    strawDark: lam(0xc9a24a),
    ribbon: lam(0xe0413b),
    gold: new THREE.MeshPhongMaterial({ color: 0xffc928, emissive: 0x4a3000, specular: 0xfff2b0, shininess: 80, side: THREE.DoubleSide }),
    ruby: new THREE.MeshPhongMaterial({ color: 0xe0254a, emissive: 0x3a0010, shininess: 90 }),
    sapphire: new THREE.MeshPhongMaterial({ color: 0x2a6bff, emissive: 0x001040, shininess: 90 }),
    vine: lam(0x4f9e3c),
    petals: [lam(0xff8fb8), lam(0xffe14d), lam(0xffffff), lam(0xb48cff)],
    red: lam(0xe0413b),
    stripe: lam(0xffffff, { map: stripeTex(['#2a62c9', '#ffffff', '#e0413b', '#ffffff'], 16) }),
    rainbow: lam(0xffffff, { map: stripeTex(['#ff4b4b', '#ff9a3d', '#ffe14d', '#5bd16a', '#3fa9ff', '#a96bff'], 18) }),
    stripeFlat: lam(0xffffff, { map: stripeTex(['#2a62c9', '#ffffff', '#e0413b', '#ffffff'], 4) }),
    rainbowFlat: lam(0xffffff, { map: stripeTex(['#ff4b4b', '#ff9a3d', '#ffe14d', '#5bd16a', '#3fa9ff', '#a96bff'], 6) }),
    canvas: lam(0x9a6a3c),
    canvasDark: lam(0x6e4826),
    roll: lam(0x4f8a4a),
    leaf: lam(0x5cbf48),
    leafDark: lam(0x3d8f36),
    stem: lam(0x7a5236),
    hero: lam(0xffffff, { map: capeTex('#d7263d', '#ffd23a', 'star'), side: THREE.DoubleSide }),
    royal: lam(0xffffff, { map: capeTex('#6a2fb8', '#ffd23a', 'crown'), side: THREE.DoubleSide }),
  });
  return M;
}

function mesh(parent, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ builders
const BUILD = {
  beanie(head) {
    const m = mats(), g = new THREE.Group();
    mesh(g, new THREE.SphereGeometry(0.4, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.knit, 0, 0.03, 0, 1, 0.88, 1);
    mesh(g, new THREE.TorusGeometry(0.39, 0.065, 8, 26).rotateX(Math.PI / 2), m.cream, 0, 0.05, 0);
    mesh(g, new THREE.IcosahedronGeometry(0.11, 1), m.pom, 0, 0.4, 0.02);
    g.rotation.x = 0.12;
    head.add(g); return g;
  },
  straw(head) {
    const m = mats(), g = new THREE.Group();
    mesh(g, new THREE.CylinderGeometry(0.68, 0.7, 0.03, 30), m.straw, 0, 0.3, 0);
    mesh(g, new THREE.CylinderGeometry(0.3, 0.36, 0.26, 22), m.straw, 0, 0.44, 0);
    mesh(g, new THREE.CylinderGeometry(0.31, 0.31, 0.03, 22), m.strawDark, 0, 0.575, 0);
    mesh(g, new THREE.CylinderGeometry(0.365, 0.365, 0.07, 22, 1, true), m.ribbon, 0, 0.35, 0);
    // ribbon tails on the back
    for (const sd of [-1, 1]) { const t = mesh(g, new THREE.BoxGeometry(0.07, 0.2, 0.015), m.ribbon, sd * 0.06, 0.25, 0.37); t.rotation.z = sd * 0.25; }
    g.rotation.x = 0.1;
    head.add(g); return g;
  },
  flowercrown(head) {
    const m = mats(), g = new THREE.Group();
    mesh(g, new THREE.TorusGeometry(0.33, 0.03, 6, 28).rotateX(Math.PI / 2), m.vine, 0, 0, 0);
    const petal = new THREE.IcosahedronGeometry(0.065, 0);
    const center = new THREE.IcosahedronGeometry(0.035, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.sin(a) * 0.33, z = Math.cos(a) * 0.33;
      mesh(g, petal, m.petals[i % 4], x, 0.03, z, 1, 0.7, 1);
      mesh(g, center, m.petals[1], x, 0.07, z);
    }
    g.position.set(0, 0.26, 0.01);
    g.rotation.x = 0.18;
    head.add(g); return g;
  },
  crown(head) {
    const m = mats(), g = new THREE.Group();
    mesh(g, new THREE.CylinderGeometry(0.2, 0.18, 0.13, 18, 1, true), m.gold, 0, 0, 0);
    const spike = new THREE.ConeGeometry(0.045, 0.13, 6);
    const ball = new THREE.SphereGeometry(0.028, 8, 6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      mesh(g, spike, m.gold, Math.sin(a) * 0.19, 0.12, Math.cos(a) * 0.19);
      mesh(g, ball, m.gold, Math.sin(a) * 0.19, 0.2, Math.cos(a) * 0.19);
    }
    const gem = new THREE.OctahedronGeometry(0.04, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.45;
      mesh(g, gem, i % 2 ? m.sapphire : m.ruby, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
    }
    g.position.set(0, 0.41, 0.02);
    g.rotation.x = 0.1;
    head.add(g); return g;
  },
  scarfRed(rig) { return scarf(rig, mats().red, mats().red); },
  scarfStripe(rig) { return scarf(rig, mats().stripe, mats().stripeFlat); },
  scarfRainbow(rig) { return scarf(rig, mats().rainbow, mats().rainbowFlat); },
  explorer(rig) {
    const m = mats(), g = new THREE.Group();
    mesh(g, new THREE.BoxGeometry(0.46, 0.52, 0.24), m.canvas, 0, 0, 0);
    mesh(g, new THREE.BoxGeometry(0.48, 0.17, 0.27), m.canvasDark, 0, 0.2, 0.01);
    mesh(g, new THREE.BoxGeometry(0.3, 0.18, 0.07), m.canvasDark, 0, -0.12, 0.15);
    for (const sd of [-1, 1]) mesh(g, new THREE.BoxGeometry(0.05, 0.07, 0.02), m.gold, sd * 0.12, 0.1, 0.15);
    mesh(g, new THREE.CylinderGeometry(0.095, 0.095, 0.56, 14).rotateZ(Math.PI / 2), m.roll, 0, 0.34, -0.01);
    for (const sd of [-1, 1]) mesh(g, new THREE.CylinderGeometry(0.1, 0.1, 0.03, 14).rotateZ(Math.PI / 2), m.canvasDark, sd * 0.2, 0.34, -0.01);
    g.position.set(0, 0.96, 0.53);
    g.rotation.x = -0.08;
    rig.add(g); return g;
  },
  leafpack(rig) {
    const m = mats(), g = new THREE.Group();
    mesh(g, new THREE.SphereGeometry(1, 18, 12), m.leaf, 0, 0, 0, 0.27, 0.36, 0.12);
    mesh(g, new THREE.BoxGeometry(0.025, 0.62, 0.02), m.leafDark, 0, 0, 0.115);
    for (let k = -2; k <= 2; k++) {
      if (!k) continue;
      for (const sd of [-1, 1]) { const v = mesh(g, new THREE.BoxGeometry(0.16, 0.018, 0.02), m.leafDark, sd * 0.08, k * 0.1 + 0.03, 0.105); v.rotation.z = sd * 0.5; }
    }
    mesh(g, new THREE.CylinderGeometry(0.02, 0.03, 0.18, 8), m.stem, 0, 0.42, 0);
    const small = mesh(g, new THREE.SphereGeometry(1, 12, 8), m.leafDark, 0.2, -0.2, 0.05, 0.12, 0.17, 0.06);
    small.rotation.z = -0.7;
    g.position.set(0, 0.98, 0.53);
    g.rotation.z = 0.08;
    rig.add(g); return g;
  },
  cape(rig) { return cape(rig, mats().hero); },
  royalcape(rig) {
    const g = cape(rig, mats().royal);
    // gold clasp bar across the shoulders
    mesh(g, new THREE.CylinderGeometry(0.035, 0.035, 0.72, 10).rotateZ(Math.PI / 2), mats().gold, 0, 0, 0);
    return g;
  },
};

function scarf(rig, ringMat, tailMat) {
  const g = new THREE.Group();
  mesh(g, new THREE.TorusGeometry(0.355, 0.085, 10, 28).rotateX(Math.PI / 2), ringMat, 0, 0, 0, 1, 1, 0.95);
  const tails = [];
  for (const sd of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(sd * 0.09, -0.02, 0.34);
    g.add(piv);
    const t = mesh(piv, new THREE.BoxGeometry(0.15, 0.44, 0.045).translate(0, -0.22, 0), tailMat, 0, 0, 0);
    t.rotation.z = sd * 0.12;
    tails.push(piv);
  }
  g.position.set(0, 1.3, 0);
  g.userData.tails = tails;
  rig.add(g); return g;
}

function cape(rig, mat) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.78, 0.98, 4, 10).translate(0, -0.49, 0);
  const base = geo.attributes.position.array.slice();
  const m = mesh(g, geo, mat, 0, 0, 0);
  m.castShadow = true;
  g.position.set(0, 1.36, 0.47);
  g.userData.cape = { geo, base, t: 0 };
  rig.add(g); return g;
}

// ------------------------------------------------------------------ public API
export class Outfit {
  constructor(panda) {
    this.panda = panda;
    this.items = { hat: null, neck: null, back: null };
    this.ids = { hat: null, neck: null, back: null };
  }
  set(equipped) {
    for (const slot of ['hat', 'neck', 'back']) {
      const id = equipped[slot] || null;
      if (this.ids[slot] === id) continue;
      const old = this.items[slot];
      if (old) old.parent.remove(old);
      this.items[slot] = id ? BUILD[id](slot === 'hat' ? this.panda.head : this.panda.rig) : null;
      this.ids[slot] = id;
    }
  }
  update(dt, speed, mode) {
    const run = mode === 'run' || mode === 'jump' || mode === 'slide';
    const k = run ? Math.min(1, speed / 30) : 0.15;
    const back = this.items.back;
    if (back && back.userData.cape) {
      const c = back.userData.cape;
      c.t += dt * (4 + 10 * k);
      back.rotation.x = -(0.32 + 0.5 * k) + Math.sin(c.t * 0.7) * 0.05;
      const pos = c.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = c.base[i * 3 + 1], x = c.base[i * 3];
        pos.array[i * 3 + 2] = c.base[i * 3 + 2] + Math.sin(c.t - y * 6 + x * 2) * 0.05 * (-y) * (0.4 + k);
      }
      pos.needsUpdate = true;
      c.geo.computeVertexNormals();
    }
    const neck = this.items.neck;
    if (neck) {
      neck.userData.t = (neck.userData.t || 0) + dt * (5 + 12 * k);
      neck.userData.tails.forEach((p, i) => { p.rotation.x = -(0.15 + 0.9 * k) + Math.sin(neck.userData.t + i * 1.3) * 0.12 * (0.3 + k); });
    }
  }
}

/** Render small rear-3/4 thumbnails of each clothing item (never the panda's face). */
export async function renderThumbnails(createPanda, ids, size = 160) {
  const out = {};
  let r;
  try {
    const canvas = document.createElement('canvas');
    r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f9f, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(2, 4, 4);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    for (const id of ids) {
      const p = createPanda();
      p.animate(0.016, { mode: 'idle', speed: 0 });
      const o = new Outfit(p);
      const slot = id.startsWith('scarf') ? 'neck' : ['explorer', 'leafpack', 'cape', 'royalcape'].includes(id) ? 'back' : 'hat';
      o.set({ [slot]: id });
      o.update(0.3, 0, 'idle');
      scene.add(p.root);
      // rear 3/4 view from behind-right (+Z is the panda's back)
      if (slot === 'hat') { cam.position.set(1.0, 2.35, 2.2); cam.lookAt(0, 1.62, 0); }
      else if (slot === 'neck') { cam.position.set(1.15, 2.0, 2.5); cam.lookAt(0, 1.3, 0); }
      else { cam.position.set(1.4, 1.75, 3.2); cam.lookAt(0, 1.0, 0); }
      r.render(scene, cam);
      out[id] = canvas.toDataURL('image/png');
      scene.remove(p.root);
    }
  } catch (e) { /* thumbnails are optional */ }
  if (r) { r.dispose(); r.forceContextLoss(); }
  return out;
}
