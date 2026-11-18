import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { SEASONS } from './seasons.js';
import { makeRoadTexture, makeSpriteTexture } from './textures.js';

// ---------------------------------------------------------------------------------------------
// Track model
//   The path is a chain of straight segments joined by square 90° corners. Each segment has a
//   start point (the previous corner centre), a grid direction and a length to its end corner.
//   Gameplay works in segment-local coordinates: s = distance along the segment, x = lateral
//   offset (+x = right). Headings never point "south", which makes the path a staircase that can
//   never intersect itself.
// ---------------------------------------------------------------------------------------------
export const ROAD_W = 5.2;
export const HALF = ROAD_W / 2;
export const CURB = 0.36;
export const INNER = HALF - CURB; // inner face of the curbs
export const PANDA_HALF_W = 0.3;
export const PLAY_HALF = INNER - PANDA_HALF_W - 0.02; // how far the panda's centre may move sideways
export const GROUND_Y = -1.0;
export const SEG_PER_SEASON = 4;

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W  (x, z)
export const dirVec = (d) => DIRS[d];
export const rightVec = (d) => DIRS[(d + 1) % 4];
export const yawOf = (d) => -d * Math.PI / 2;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality; // 'high' | 'low'
    this.layout = [];
    this.built = new Map(); // index -> segment build data
    this.startSeason = 0;
    this.genSpeed = 12;
    this.difficulty = 0;
    this.time = 0;
    this._initShared();
    this._initAtmosphere();
  }

  // ---------------------------------------------------------------- shared resources
  _initShared() {
    const roadTex = makeRoadTexture(this.renderer);
    this.mat = SEASONS.map((p) => ({
      road: new THREE.MeshLambertMaterial({ color: p.road, map: roadTex }),
      side: new THREE.MeshLambertMaterial({ color: p.roadSide }),
      curb: new THREE.MeshLambertMaterial({ color: p.curb }),
    }));
    this.foliageMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.trunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.rockMat = new THREE.MeshLambertMaterial({ color: 0x9a9690, flatShading: true });
    this.snowMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.barkMat = new THREE.MeshLambertMaterial({ color: 0x7b5034 });
    this.ringMat = new THREE.MeshLambertMaterial({ color: 0xe0b77f });
    this.woodMat = new THREE.MeshLambertMaterial({ color: 0x8a5a36 });
    this.coalMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    this.carrotMat = new THREE.MeshLambertMaterial({ color: 0xff8a2a });

    const trunk = new THREE.CylinderGeometry(0.11, 0.19, 1, 6);
    trunk.translate(0, 0.5, 0);
    this.geo = { trunk };

    const cones = [
      new THREE.ConeGeometry(1.0, 1.5, 7).translate(0, 1.15, 0),
      new THREE.ConeGeometry(0.8, 1.3, 7).translate(0, 1.85, 0),
      new THREE.ConeGeometry(0.55, 1.1, 7).translate(0, 2.5, 0),
    ];
    this.geo.pine = mergeGeometries(cones.map((g) => g.toNonIndexed()));
    const blobs = [
      new THREE.IcosahedronGeometry(0.95, 1).translate(0, 2.0, 0),
      new THREE.IcosahedronGeometry(0.7, 1).translate(0.55, 1.65, 0.2),
      new THREE.IcosahedronGeometry(0.66, 1).translate(-0.5, 1.75, -0.25),
      new THREE.IcosahedronGeometry(0.55, 1).translate(0.1, 1.6, 0.6),
    ];
    this.geo.round = mergeGeometries(blobs);
    this.geo.bush = new THREE.IcosahedronGeometry(0.55, 1).translate(0, 0.25, 0);
    this.geo.deco = new THREE.IcosahedronGeometry(0.14, 0);
    this.geo.rock = new THREE.DodecahedronGeometry(1, 0);
    this.geo.snowcap = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geo.log = new THREE.CylinderGeometry(0.36, 0.38, ROAD_W - 0.1, 14).rotateZ(Math.PI / 2).translate(0, 0.36, 0);
    this.geo.post = new THREE.BoxGeometry(0.28, 2.6, 0.28).translate(0, 1.3, 0);
    this.geo.beam = new THREE.CylinderGeometry(0.2, 0.2, ROAD_W + 0.2, 10).rotateZ(Math.PI / 2);
    this.geo.leafBlob = new THREE.IcosahedronGeometry(0.5, 1);
    this.geo.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.geo.nose = new THREE.ConeGeometry(0.07, 0.35, 8).rotateX(-Math.PI / 2);

    // Coins: a single instanced pool for every live coin.
    const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20).rotateX(Math.PI / 2);
    this.coinMat = new THREE.MeshPhongMaterial({ color: 0xffc928, emissive: 0x6b4400, specular: 0xfff2b0, shininess: 70 });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, this.coinMat, 700);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.castShadow = false;
    this.scene.add(this.coinMesh);

    // Ground: a large plane that follows the player; texture snapped to world grid.
    const gc = document.createElement('canvas');
    gc.width = gc.height = 128;
    const g2 = gc.getContext('2d');
    g2.fillStyle = '#e8e8e8';
    g2.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      const v = 200 + Math.random() * 55;
      g2.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g2.beginPath();
      g2.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 7, 0, Math.PI * 2);
      g2.fill();
    }
    const gtex = new THREE.CanvasTexture(gc);
    gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
    gtex.colorSpace = THREE.SRGBColorSpace;
    this.groundTile = 10;
    this.groundSize = 480;
    gtex.repeat.set(this.groundSize / this.groundTile, this.groundSize / this.groundTile);
    this.groundMat = new THREE.MeshLambertMaterial({ color: SEASONS[0].ground, map: gtex });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(this.groundSize, this.groundSize).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.position.y = GROUND_Y;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  _initAtmosphere() {
    const p = SEASONS[0];
    this.scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    this.skyUniforms = {
      top: { value: new THREE.Color(p.skyTop) },
      horizon: { value: new THREE.Color(p.skyHorizon) },
      sunDir: { value: new THREE.Vector3(-0.4, 0.35, -0.85).normalize() },
      sunColor: { value: new THREE.Color(0xfff3d6) },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y, 0.0, 1.0);
            vec3 col = mix(horizon, top, pow(h, 0.55));
            float s = max(dot(normalize(vDir), sunDir), 0.0);
            col += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.25);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);

    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(p.sun, p.sunIntensity);
    this.sun.castShadow = true;
    const sm = this.quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.sunOffset = new THREE.Vector3(14, 30, 18);

    // Seasonal weather particles (petals, pollen, leaves, snow)
    const N = 260;
    this.pN = N;
    const pos = new Float32Array(N * 3);
    this.pSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-22, 22);
      pos[i * 3 + 1] = rand(-1, 14);
      pos[i * 3 + 2] = rand(-22, 22);
      this.pSeed[i] = Math.random() * 100;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particleMat = new THREE.PointsMaterial({
      color: p.particles.color, size: p.particles.size, map: makeSpriteTexture(), transparent: true,
      depthWrite: false, sizeAttenuation: true, opacity: 0.95,
    });
    this.particles = new THREE.Points(pg, this.particleMat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.cur = { // live, blended atmosphere values
      fog: new THREE.Color(p.fog), fogNear: p.fogNear, fogFar: p.fogFar,
      top: new THREE.Color(p.skyTop), horizon: new THREE.Color(p.skyHorizon), ground: new THREE.Color(p.ground),
      hemiSky: new THREE.Color(p.hemiSky), hemiGround: new THREE.Color(p.hemiGround), hemiI: p.hemiIntensity,
      sun: new THREE.Color(p.sun), sunI: p.sunIntensity, pColor: new THREE.Color(p.particles.color), pSize: p.particles.size,
    };
    this.atmoSeason = 0;
  }

  /** Set the season the atmosphere blends towards. */
  setAtmosphere(i, instant = false) {
    this.atmoSeason = i;
    if (instant) this.updateAtmosphere(100);
  }

  updateAtmosphere(dt) {
    const p = SEASONS[this.atmoSeason];
    const k = 1 - Math.exp(-dt * 1.6);
    const c = this.cur;
    c.fog.lerp(tmpC.set(p.fog), k);
    c.top.lerp(tmpC.set(p.skyTop), k);
    c.horizon.lerp(tmpC.set(p.skyHorizon), k);
    c.ground.lerp(tmpC.set(p.ground), k);
    c.hemiSky.lerp(tmpC.set(p.hemiSky), k);
    c.hemiGround.lerp(tmpC.set(p.hemiGround), k);
    c.sun.lerp(tmpC.set(p.sun), k);
    c.pColor.lerp(tmpC.set(p.particles.color), k);
    c.fogNear += (p.fogNear - c.fogNear) * k;
    c.fogFar += (p.fogFar - c.fogFar) * k;
    c.hemiI += (p.hemiIntensity - c.hemiI) * k;
    c.sunI += (p.sunIntensity - c.sunI) * k;
    c.pSize += (p.particles.size - c.pSize) * k;
    this.scene.fog.color.copy(c.fog);
    this.scene.fog.near = c.fogNear;
    this.scene.fog.far = c.fogFar;
    this.skyUniforms.top.value.copy(c.top);
    this.skyUniforms.horizon.value.copy(c.horizon);
    this.groundMat.color.copy(c.ground);
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiI;
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunI;
    this.particleMat.color.copy(c.pColor);
    this.particleMat.size = c.pSize;
  }

  /** Per-frame: move sky/ground/light/weather with the player focus point. */
  follow(focus, camera, dt) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    const t = this.groundTile;
    this.ground.position.x = Math.round(focus.x / t) * t;
    this.ground.position.z = Math.round(focus.z / t) * t;
    this.sun.position.copy(focus).add(this.sunOffset);
    this.sun.target.position.copy(focus);

    const pp = SEASONS[this.atmoSeason].particles;
    const count = this.quality === 'high' ? pp.count : Math.floor(pp.count * 0.6);
    this.particles.geometry.setDrawRange(0, count);
    const a = this.particles.geometry.attributes.position.array;
    const R = 22;
    for (let i = 0; i < count; i++) {
      const sd = this.pSeed[i];
      let x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      y -= pp.fall * dt * (0.7 + (sd % 1) * 0.6);
      x += Math.sin(this.time * 1.3 + sd) * pp.sway * dt;
      z += Math.cos(this.time * 1.1 + sd * 1.7) * pp.sway * 0.6 * dt;
      if (y < GROUND_Y) y += 15; else if (y > 14) y -= 15;
      x = focus.x + ((((x - focus.x + R) % (2 * R)) + 2 * R) % (2 * R)) - R;
      z = focus.z + ((((z - focus.z + R) % (2 * R)) + 2 * R) % (2 * R)) - R;
      a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- layout
  reset(startSeason) {
    for (const seg of this.built.values()) this._dispose(seg);
    this.built.clear();
    this.layout = [];
    this.startSeason = startSeason;
    this.difficulty = 0;
    this.setAtmosphere(startSeason, true);
    this._ensureLayout(8);
  }

  seasonOf(i) { return (this.startSeason + Math.floor(i / SEG_PER_SEASON)) % 4; }

  _ensureLayout(n) {
    while (this.layout.length < n) {
      const i = this.layout.length;
      let seg;
      const speedBonus = this.genSpeed * 1.9;
      if (i === 0) {
        seg = { i, dir: 0, sx: 0, sz: 0, len: 125 };
      } else {
        const prev = this.layout[i - 1];
        const [dx, dz] = dirVec(prev.dir);
        const dir = (prev.dir + prev.turn + 4) % 4;
        const len = dir === 0 ? rand(55, 110) + speedBonus : rand(45, 85) + speedBonus;
        seg = { i, dir, sx: prev.sx + dx * prev.len, sz: prev.sz + dz * prev.len, len: Math.round(len) };
      }
      // choose the turn at the end of this segment (never head south)
      if (seg.dir === 0) seg.turn = Math.random() < 0.5 ? -1 : 1;
      else if (seg.dir === 1) seg.turn = -1;
      else seg.turn = 1;
      seg.season = this.seasonOf(i);
      seg.yaw = yawOf(seg.dir);
      seg.s0 = i === 0 ? -45 : -HALF;
      this.layout.push(seg);
    }
  }

  seg(i) { this._ensureLayout(i + 6); return this.layout[i]; }

  localToWorld(seg, s, x, out = new THREE.Vector3(), y = 0) {
    const [dx, dz] = dirVec(seg.dir);
    const [rx, rz] = rightVec(seg.dir);
    return out.set(seg.sx + dx * s + rx * x, y, seg.sz + dz * s + rz * x);
  }

  /** Is a world point on (or within margin of) any road near segment i? */
  _onRoad(wx, wz, i, margin) {
    const lo = Math.max(0, i - 3), hi = i + 3;
    for (let j = lo; j <= hi; j++) {
      const g = this.seg(j);
      const [dx, dz] = dirVec(g.dir);
      const [rx, rz] = rightVec(g.dir);
      const px = wx - g.sx, pz = wz - g.sz;
      const s = px * dx + pz * dz;
      const x = px * rx + pz * rz;
      if (s > g.s0 - margin && s < g.len + HALF + margin && Math.abs(x) < HALF + margin) return true;
    }
    return false;
  }

  /** Build segments ahead of the player and drop ones far behind. */
  ensure(playerSeg, playerS, maxBuilds = Infinity) {
    // keep ~260 units of road built ahead; at most `maxBuilds` optional segments per call so
    // building never causes a long frame (the current and next segment are always built).
    let ahead = -playerS;
    let i = playerSeg;
    let builds = 0;
    while (ahead < 260 || i <= playerSeg + 1) {
      if (!this.built.has(i)) {
        if (i > playerSeg + 1 && builds >= maxBuilds) break;
        this._build(this.seg(i));
        builds++;
      }
      ahead += this.seg(i).len;
      i++;
    }
    for (const [k, seg] of this.built) {
      if (k < playerSeg - 1 || k > i + 1) { this._dispose(seg); this.built.delete(k); }
    }
  }

  _dispose(seg) {
    if (!seg.group) return;
    this.scene.remove(seg.group);
    seg.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.userData.ownGeo) o.geometry.dispose();
    });
    seg.group = null;
  }

  // ---------------------------------------------------------------- building
  _build(seg) {
    const S = SEASONS[seg.season];
    const m = this.mat[seg.season];
    const group = new THREE.Group();
    group.position.set(seg.sx, 0, seg.sz);
    group.rotation.y = seg.yaw;
    seg.group = group;

    // ---- road (local frame: forward = -z, right = +x)
    const straightA = seg.i === 0 ? seg.s0 : HALF;
    const straightB = seg.len - HALF;
    const L = straightB - straightA;
    const mid = (straightA + straightB) / 2;
    const tops = [], sides = [], curbs = [];
    const top = new THREE.PlaneGeometry(ROAD_W, L).rotateX(-Math.PI / 2);
    scaleUV(top, 1, L / ROAD_W);
    tops.push(top.translate(0, 0, -mid));
    sides.push(new THREE.BoxGeometry(ROAD_W, -GROUND_Y, L).translate(0, GROUND_Y / 2 - 0.01, -mid));
    for (const sd of [-1, 1]) curbs.push(new THREE.BoxGeometry(CURB, 0.22, L).translate(sd * (HALF - CURB / 2), 0.11, -mid));
    // corner tile at the end
    const ctop = new THREE.PlaneGeometry(ROAD_W, ROAD_W).rotateX(-Math.PI / 2).translate(0, 0, -seg.len);
    tops.push(ctop);
    sides.push(new THREE.BoxGeometry(ROAD_W, -GROUND_Y, ROAD_W).translate(0, GROUND_Y / 2 - 0.01, -seg.len));
    curbs.push(new THREE.BoxGeometry(ROAD_W, 0.22, CURB).translate(0, 0.11, -(seg.len + HALF - CURB / 2)));
    curbs.push(new THREE.BoxGeometry(CURB, 0.22, ROAD_W).translate(-seg.turn * (HALF - CURB / 2), 0.11, -seg.len));
    const addMerged = (list, mat, shadow) => {
      const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = shadow;
      mesh.userData.ownGeo = true;
      group.add(mesh);
    };
    addMerged(tops, m.road, false);
    addMerged(sides, m.side, false);
    addMerged(curbs, m.curb, true);

    // ---- vegetation
    this._plantTrees(seg, group, S);

    // ---- obstacles + coins
    seg.obstacles = [];
    seg.coins = [];
    this._placeObstacles(seg, group, S);

    this.scene.add(group);
    group.updateMatrixWorld(true);
    this.built.set(seg.i, seg);
  }

  _plantTrees(seg, group, S) {
    const trunks = [], pines = [], rounds = [], bushes = [], decos = [];
    const wp = new THREE.Vector3();
    const winter = seg.season === 3;
    const density = this.quality === 'high' ? 1 : 0.7;
    const sStart = seg.i === 0 ? seg.s0 - 10 : -HALF;
    const sEnd = seg.len + HALF;
    for (const side of [-1, 1]) {
      let s = sStart + rand(0, 2);
      while (s < sEnd) {
        const rows = Math.random() < 0.65 ? 2 : 1;
        let d = HALF + 0.9 + Math.pow(Math.random(), 1.7) * 9;
        for (let r = 0; r < rows; r++) {
          const scale = rand(0.75, 1.65) * (r ? 1.15 : 1);
          const isPine = winter ? Math.random() < 0.6 : Math.random() < (seg.season === 1 ? 0.45 : 0.35);
          const x = side * d;
          const ss = s + rand(-1.2, 1.2);
          this.localToWorld(seg, ss, x, wp);
          const reach = (isPine ? 1.0 : 1.1) * scale;
          if (!this._onRoad(wp.x, wp.z, seg.i, 0.35 + reach)) {
            const rot = Math.random() * Math.PI * 2;
            const h = rand(0.9, 1.3);
            trunks.push(mat(x, GROUND_Y, -ss, rot, scale * 1.1, scale * (isPine ? 1.3 : 1.6) * h - GROUND_Y * 0.2, scale * 1.1), S.trunk);
            (isPine ? pines : rounds).push([mat(x, GROUND_Y + (isPine ? 0.2 : 0.1) * scale, -ss, rot, scale, scale * h, scale), pick(isPine ? S.pine : S.round)]);
          }
          d += rand(4, 13);
        }
        // a bush or ground decoration near the road edge
        if (Math.random() < 0.55 * density) {
          const bx = side * (HALF + rand(0.5, 3.5));
          const bs = s + rand(-1.5, 1.5);
          this.localToWorld(seg, bs, bx, wp);
          const sc = rand(0.6, 1.3);
          if (!this._onRoad(wp.x, wp.z, seg.i, 0.2 + 0.55 * sc)) bushes.push([mat(bx, GROUND_Y, -bs, Math.random() * 6, sc, sc * rand(0.7, 1.0), sc), pick(S.bush)]);
        }
        for (let k = 0; k < 3 * density; k++) {
          const fx = side * (HALF + rand(0.3, 7));
          const fs = s + rand(-2, 2);
          this.localToWorld(seg, fs, fx, wp);
          if (this._onRoad(wp.x, wp.z, seg.i, 0.25)) continue;
          if (winter) decos.push([mat(fx, GROUND_Y - 0.02, -fs, Math.random() * 6, rand(3, 6), rand(1, 2), rand(3, 6)), 0xffffff]);
          else if (seg.season === 2) decos.push([mat(fx, GROUND_Y + 0.02, -fs, Math.random() * 6, rand(1.2, 2.2), 0.35, rand(1.2, 2.2)), pick(S.flowers)]);
          else decos.push([mat(fx, GROUND_Y + 0.1, -fs, 0, 1, 0.8, 1), pick(S.flowers)]);
        }
        s += rand(1.4, 4.6) / density;
      }
    }
    const addInst = (geo, material, list, cast, colorOf) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      for (let k = 0; k < list.length; k++) {
        im.setMatrixAt(k, list[k][0]);
        im.setColorAt(k, tmpC.set(colorOf ? colorOf(list[k]) : list[k][1]));
      }
      im.castShadow = cast;
      im.receiveShadow = !cast || this.quality === 'high';
      im.computeBoundingSphere();
      group.add(im);
    };
    // trunks list was pushed as alternating (matrix, color) pairs; normalise
    const tl = [];
    for (let k = 0; k < trunks.length; k += 2) tl.push([trunks[k], trunks[k + 1]]);
    addInst(this.geo.trunk, this.trunkMat, tl, true);
    addInst(this.geo.pine, this.foliageMat, pines, true);
    addInst(this.geo.round, this.foliageMat, rounds, true);
    addInst(this.geo.bush, this.foliageMat, bushes, this.quality === 'high');
    addInst(this.geo.deco, this.foliageMat, decos, false);
  }

  // ---------------------------------------------------------------- obstacles & coins
  _placeObstacles(seg, group, S) {
    const speed = this.genSpeed;
    const d = this.difficulty;
    // no obstacles in a corner or for ~1.75 s after one; keep the approach to the next corner clear
    const sStart = seg.i === 0 ? 48 : HALF + speed * 1.85 + 2;
    const sEnd = seg.len - HALF - 8;
    const list = [];
    let s = sStart;
    let last = null;
    while (s < sEnd) {
      const r = Math.random();
      let type;
      if (r < 0.28) type = 'log';
      else if (r < 0.52) type = 'bar';
      else if (r < 0.74) type = Math.random() < 0.5 ? 'rockL' : 'rockR';
      else if (r < 0.88) type = 'rockC';
      else type = 'rockLR';
      if (last && last === type && type !== 'log') type = 'log';
      list.push({ type, s });
      last = type;
      const gapT = (1.4 - 0.58 * d) * rand(0.9, 1.35);
      s += Math.max(9, speed * gapT);
    }

    for (const o of list) this._makeObstacle(seg, group, S, o);

    // coins: safe-zone trail after the corner
    const firstObs = list.length ? list[0].s : sEnd;
    this._coinTrail(seg, (seg.i === 0 ? 10 : HALF + 4), Math.min(firstObs - 4, (seg.i === 0 ? 40 : HALF + 30)), rand(-1, 1) * 0.9);
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      const next = list[k + 1];
      // pattern tied to the obstacle itself
      if (o.type === 'log' && Math.random() < 0.7) this._coinArc(seg, o.s, rand(-1.2, 1.2));
      else if (o.type === 'bar' && Math.random() < 0.6) for (const ds of [-1.4, 0, 1.4]) this._coin(seg, o.s + ds, o.coinX ?? 0, 0.5);
      else if (o.safeX !== undefined && Math.random() < 0.6) for (const ds of [-2.6, -1.3, 0, 1.3, 2.6]) this._coin(seg, o.s + ds, o.safeX, 0.7);
      // trail through the gap leading into the next obstacle's safe line
      const a = o.s + 2.6, b = (next ? next.s : sEnd) - 2.6;
      if (b - a > 5 && Math.random() < 0.75) {
        const x = next && next.safeX !== undefined ? next.safeX : rand(-1.3, 1.3);
        this._coinTrail(seg, a, Math.min(b, a + 12), x);
      }
    }
  }

  _coin(seg, s, x, y) {
    const w = this.localToWorld(seg, s, x, new THREE.Vector3(), y);
    seg.coins.push({ s, x, y, w, taken: false, tt: 0 });
  }
  _coinTrail(seg, a, b, x) { for (let s = a; s <= b; s += 1.6) this._coin(seg, s, x, 0.7); }
  _coinArc(seg, s, x) {
    for (let k = -3; k <= 3; k++) {
      const u = k / 3.4;
      this._coin(seg, s + k * 1.25, x, 0.75 + 1.25 * (1 - u * u));
    }
  }

  _makeObstacle(seg, group, S, o) {
    const winter = seg.season === 3;
    const add = (geo, material, x, y, s, sx = 1, sy = 1, sz = 1, ry = 0) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, -s);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const boxes = [];
    if (o.type === 'log') {
      add(this.geo.log, [this.barkMat, this.ringMat, this.ringMat], 0, 0, o.s);
      if (winter) add(this.geo.snowcap, this.snowMat, 0, 0.66, o.s, ROAD_W / 2 - 0.1, 0.12, 0.3);
      boxes.push({ s0: o.s - 0.3, s1: o.s + 0.3, x0: -9, x1: 9, y0: -1, y1: 0.66 });
    } else if (o.type === 'bar') {
      for (const sd of [-1, 1]) add(this.geo.post, this.woodMat, sd * (HALF - 0.14), 0, o.s);
      add(this.geo.beam, this.barkMat, 0, 1.38, o.s);
      add(this.geo.beam, this.barkMat, 0, 2.45, o.s);
      const leaf = this._colorMat(pick(S.round));
      for (let k = 0; k < 6; k++) add(this.geo.leafBlob, winter ? this.snowMat : leaf, -HALF + 0.4 + k * (ROAD_W - 0.8) / 5, 2.75 + rand(-0.1, 0.2), o.s + rand(-0.15, 0.15), rand(0.9, 1.3), rand(0.7, 1), rand(0.8, 1.1));
      // hanging leaves under the bar make the "duck" cue obvious
      for (let k = 0; k < 7; k++) add(this.geo.leafBlob, winter ? this.snowMat : leaf, -HALF + 0.5 + k * (ROAD_W - 1) / 6, 1.12, o.s, 0.35, 0.3, 0.35);
      boxes.push({ s0: o.s - 0.32, s1: o.s + 0.32, x0: -9, x1: 9, y0: 1.06, y1: 9 });
    } else {
      // rocks / blockers to steer around (cannot be jumped)
      let ranges;
      if (o.type === 'rockL') { ranges = [[-INNER - 0.05, 0.15]]; o.safeX = 1.2; }
      else if (o.type === 'rockR') { ranges = [[-0.15, INNER + 0.05]]; o.safeX = -1.2; }
      else if (o.type === 'rockC') { ranges = [[-0.8, 0.8]]; o.safeX = Math.random() < 0.5 ? -1.45 : 1.45; }
      else { ranges = [[-INNER - 0.05, -0.95], [0.95, INNER + 0.05]]; o.safeX = 0; }
      for (const [a, b] of ranges) {
        const cx = (a + b) / 2, w = b - a;
        if (winter && o.type === 'rockC' && Math.random() < 0.7) {
          this._snowman(group, add, cx, o.s);
          boxes.push({ s0: o.s - 0.55, s1: o.s + 0.55, x0: -0.62, x1: 0.62, y0: -1, y1: 99 });
          continue;
        }
        const h = rand(1.1, 1.5);
        const rock = add(this.geo.rock, this.rockMat, cx, h * 0.55, o.s, w / 2 * 1.02, h, 0.85, rand(-0.15, 0.15));
        rock.rotation.x = rand(-0.2, 0.2);
        if (winter) add(this.geo.snowcap, this.snowMat, cx, h * 1.05, o.s, w / 2 * 0.75, 0.3, 0.6);
        else if (Math.random() < 0.5) {
          const moss = this._colorMat(pick(S.bush));
          add(this.geo.leafBlob, moss, cx + rand(-0.3, 0.3) * w / 2, h * 1.15, o.s, 0.5, 0.35, 0.45);
        }
        boxes.push({ s0: o.s - 0.52, s1: o.s + 0.52, x0: a + 0.14, x1: b - 0.14, y0: -1, y1: 99 });
      }
    }
    for (const b of boxes) seg.obstacles.push({ ...b, type: o.type });
  }

  _colorMat(color) {
    this._mats = this._mats || new Map();
    if (!this._mats.has(color)) this._mats.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return this._mats.get(color);
  }

  _snowman(group, add, x, s) {
    add(this.geo.sphere, this.snowMat, x, 0.6, s, 0.72, 0.68, 0.72);
    add(this.geo.sphere, this.snowMat, x, 1.45, s, 0.52, 0.5, 0.52);
    add(this.geo.sphere, this.snowMat, x, 2.1, s, 0.36, 0.36, 0.36);
    // the snowman faces the runner (towards +s side means local +z)
    add(this.geo.nose, this.carrotMat, x, 2.1, s - 0.48, 1, 1, 1, Math.PI);
    for (const e of [-0.13, 0.13]) add(this.geo.sphere, this.coalMat, x + e, 2.2, s - 0.31, 0.05, 0.05, 0.05);
    for (const b of [1.3, 1.55]) add(this.geo.sphere, this.coalMat, x, b, s - 0.5, 0.06, 0.06, 0.06);
  }

  // ---------------------------------------------------------------- gameplay queries
  /** Swept AABB test against the obstacles of a segment. */
  hit(seg, sA, sB, x, feet, height) {
    const s0 = Math.min(sA, sB) - 0.26, s1 = Math.max(sA, sB) + 0.26;
    const x0 = x - PANDA_HALF_W, x1 = x + PANDA_HALF_W;
    const y0 = feet + 0.05, y1 = feet + height;
    for (const o of seg.obstacles || []) {
      if (s1 < o.s0 || s0 > o.s1) continue;
      if (x1 < o.x0 || x0 > o.x1) continue;
      if (y1 < o.y0 || y0 > o.y1) continue;
      return o;
    }
    return null;
  }

  collect(seg, sA, sB, x, cy) {
    let n = 0;
    const s0 = Math.min(sA, sB) - 0.75, s1 = Math.max(sA, sB) + 0.75;
    for (const c of seg.coins || []) {
      if (c.taken || c.s < s0 || c.s > s1) continue;
      if (Math.abs(c.x - x) < 0.85 && Math.abs(c.y - cy) < 1.05) { c.taken = true; c.tt = 0; n++; }
    }
    return n;
  }

  updateCoins(dt, focus) {
    let n = 0;
    const max = 700;
    const spin = this.time * 3.2;
    tmpQ.setFromAxisAngle(UP, spin);
    for (const seg of this.built.values()) {
      for (const c of seg.coins) {
        if (n >= max) break;
        let y = c.y + Math.sin(this.time * 3 + c.s) * 0.06;
        let sc = 1;
        if (c.taken) {
          c.tt += dt;
          if (c.tt > 0.3) continue;
          y += c.tt * 7;
          sc = 1 - c.tt / 0.3;
          tmpQ.setFromAxisAngle(UP, spin * 4);
        } else {
          const dx = c.w.x - focus.x, dz = c.w.z - focus.z;
          if (dx * dx + dz * dz > 170 * 170) continue;
          tmpQ.setFromAxisAngle(UP, spin);
        }
        tmpP.set(c.w.x, y, c.w.z);
        tmpS.set(sc, sc, sc);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.coinMesh.setMatrixAt(n++, tmpM);
      }
    }
    this.coinMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Build a TRS matrix for a local position with yaw + non-uniform scale. */
function mat(x, y, z, ry, sx, sy, sz) {
  const m = new THREE.Matrix4();
  tmpQ.setFromAxisAngle(UP, ry);
  return m.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(sx, sy, sz));
}
