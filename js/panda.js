import * as THREE from 'three';

// A chubby giant panda built from primitives. It faces -Z, so the camera (behind, +Z) only ever
// sees its back: white head with black ears, black shoulder saddle, white back + tail, black limbs.
// No face is modelled at all.

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function createPanda() {
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f3ec });
  const black = new THREE.MeshLambertMaterial({ color: 0x232329 });
  const pad = new THREE.MeshLambertMaterial({ color: 0x4a3f44 });

  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const add = (parent, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const sphere = new THREE.SphereGeometry(1, 22, 16);
  const lowSphere = new THREE.SphereGeometry(1, 14, 10);

  // body
  add(rig, sphere, white, 0, 0.86, 0, 0.47, 0.52, 0.44);
  add(rig, sphere, black, 0, 1.1, 0.0, 0.5, 0.25, 0.47); // shoulder saddle band
  add(rig, lowSphere, white, 0, 0.64, 0.4, 0.1, 0.1, 0.09); // tail
  // head
  const head = new THREE.Group();
  head.position.set(0, 1.5, -0.04);
  rig.add(head);
  add(head, sphere, white, 0, 0.02, 0, 0.38, 0.35, 0.36);
  add(head, lowSphere, black, -0.25, 0.3, 0.02, 0.13, 0.13, 0.08);
  add(head, lowSphere, black, 0.25, 0.3, 0.02, 0.13, 0.13, 0.08);

  // limbs
  const capsuleArm = new THREE.CapsuleGeometry(0.125, 0.34, 6, 12);
  const capsuleLeg = new THREE.CapsuleGeometry(0.155, 0.2, 6, 12);
  const makeArm = (side) => {
    const p = new THREE.Group();
    p.position.set(0.41 * side, 1.13, 0);
    rig.add(p);
    add(p, capsuleArm, black, 0, -0.25, 0);
    return p;
  };
  const makeLeg = (side) => {
    const p = new THREE.Group();
    p.position.set(0.21 * side, 0.46, 0);
    rig.add(p);
    add(p, capsuleLeg, black, 0, -0.18, 0);
    add(p, lowSphere, black, 0, -0.37, -0.04, 0.16, 0.11, 0.2); // foot
    add(p, lowSphere, pad, 0, -0.4, 0.11, 0.09, 0.07, 0.05); // paw pad (visible from behind mid-stride)
    return p;
  };
  const armL = makeArm(-1), armR = makeArm(1);
  const legL = makeLeg(-1), legR = makeLeg(1);

  const s = {
    phase: 0, t: 0,
    rigY: 0, rigZ: 0, pitch: 0, roll: 0, squash: 1,
    aL: 0, aR: 0, aLz: 0, aRz: 0, lL: 0, lR: 0, tumble: 0,
  };

  /**
   * @param {number} dt
   * @param {{mode:string, speed:number}} st  mode: idle | run | jump | slide | crash | fall
   */
  function animate(dt, st) {
    s.t += dt;
    const k = 16;
    let tgt;
    if (st.mode === 'run') {
      s.phase += dt * (6 + st.speed * 0.62);
      const sn = Math.sin(s.phase);
      tgt = {
        rigY: Math.abs(Math.cos(s.phase)) * 0.09, rigZ: 0, pitch: -0.14, roll: sn * 0.07, squash: 1,
        aL: -sn * 0.95, aR: sn * 0.95, aLz: -0.2, aRz: 0.2, lL: sn * 1.0, lR: -sn * 1.0,
      };
    } else if (st.mode === 'jump') {
      tgt = { rigY: 0, rigZ: 0, pitch: -0.05, roll: 0, squash: 1, aL: 2.6, aR: 2.6, aLz: -0.45, aRz: 0.45, lL: 1.05, lR: 0.45 };
    } else if (st.mode === 'slide') {
      s.phase += dt * 10;
      tgt = {
        rigY: 0.26, rigZ: 0.75, pitch: -1.32, roll: Math.sin(s.phase) * 0.04, squash: 1,
        aL: 2.9, aR: 2.9, aLz: -0.15, aRz: 0.15, lL: -0.15, lR: -0.15,
      };
    } else if (st.mode === 'crash') {
      tgt = { rigY: 0, rigZ: 0.1, pitch: 0.32, roll: 0.12, squash: 0.9, aL: 1.2, aR: 1.2, aLz: -1.5, aRz: 1.5, lL: 0.6, lR: -0.3 };
    } else if (st.mode === 'fall') {
      s.tumble -= dt * 4.5;
      tgt = { rigY: 0.4, rigZ: 0, pitch: s.tumble, roll: 0, squash: 1, aL: 2.8 + Math.sin(s.t * 25) * 0.4, aR: 2.8 - Math.sin(s.t * 25) * 0.4, aLz: -0.6, aRz: 0.6, lL: 0.8, lR: -0.4 };
    } else {
      // idle: gentle breathing + sway
      const b = Math.sin(s.t * 2.2);
      tgt = { rigY: 0, rigZ: 0, pitch: -0.03, roll: Math.sin(s.t * 0.9) * 0.03, squash: 1 + b * 0.015, aL: 0.08 + b * 0.04, aR: -0.08 - b * 0.04, aLz: -0.12, aRz: 0.12, lL: 0, lR: 0 };
    }
    if (st.mode !== 'fall') s.tumble = s.pitch;
    const kk = st.mode === 'crash' ? 30 : k;
    for (const key in tgt) {
      if (key === 'pitch' && st.mode === 'fall') { s.pitch = tgt.pitch; continue; }
      s[key] = damp(s[key], tgt[key], kk, dt);
    }

    rig.position.set(0, s.rigY, s.rigZ);
    rig.rotation.set(s.pitch, 0, s.roll);
    rig.scale.set(1 / Math.sqrt(s.squash), s.squash, 1 / Math.sqrt(s.squash));
    armL.rotation.set(s.aL, 0, s.aLz);
    armR.rotation.set(s.aR, 0, s.aRz);
    legL.rotation.set(s.lL, 0, 0);
    legR.rotation.set(s.lR, 0, 0);
    head.rotation.z = -s.roll * 0.6;
  }

  function reset() {
    Object.assign(s, { rigY: 0, rigZ: 0, pitch: 0, roll: 0, squash: 1, aL: 0, aR: 0, aLz: 0, aRz: 0, lL: 0, lR: 0, tumble: 0 });
  }

  return { root, animate, reset };
}
