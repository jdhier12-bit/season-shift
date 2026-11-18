import * as THREE from 'three';
import { World, HALF, PLAY_HALF, dirVec, rightVec } from './world.js';
import { createPanda } from './panda.js';
import { AudioEngine } from './audio.js';
import { SEASONS, SEASON_NAMES } from './seasons.js';
import { makeBlobTexture } from './textures.js';

// ------------------------------------------------------------------ tuning
const START_SPEED = 12;
const MAX_SPEED = 31;
const ACCEL = 0.16; // units/s per second
const GRAVITY = 30;
const JUMP_V = 10;
const SLIDE_TIME = 0.8;
const STAND_H = 1.65;
const SLIDE_H = 0.72;
const TURN_BUFFER = 0.35; // seconds a swipe stays queued before reaching a corner

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ------------------------------------------------------------------ renderer / scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 520);
const world = new World(scene, renderer, isTouch ? 'low' : 'high');
const panda = createPanda();
scene.add(panda.root);
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(1.3, 1.1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false })
);
scene.add(blob);
const audio = new AudioEngine();

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  // keep ~50° of horizontal view so the road is framed on tall phones, without fisheye on desktop
  const hHalf = THREE.MathUtils.degToRad(25);
  camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / camera.aspect)), 52, 80);
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
onResize();

// ------------------------------------------------------------------ persistent stats
let best = +localStorage.getItem('ss_best') || 0;
let bank = +localStorage.getItem('ss_coins') || 0;
let runsPlayed = +localStorage.getItem('ss_runs') || 0;
let selectedSeason = clamp(+localStorage.getItem('ss_season') || 0, 0, 3);

// ------------------------------------------------------------------ game state
let state = 'home'; // home | playing | paused | dying | falling | over
const P = {
  seg: 0, s: 4, x: 0, targetX: 0, feet: 0, vy: 0, jumping: false, sliding: false, slideT: 0,
  speed: START_SPEED, time: 0, dist: 0, coins: 0, score: 0, yaw: 0, yawTarget: 0, camYaw: 0,
  visOff: new THREE.Vector3(), season: 0, corners: 0, deadT: 0, latV: 0,
};
let turnQueue = null; // { dir, t }
let worldFresh = false;
const focus = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 3, 8);
const camLook = new THREE.Vector3();
let shake = 0;
let snapCam = true;

function resetPlayer() {
  Object.assign(P, {
    seg: 0, s: 4, x: 0, targetX: 0, feet: 0, vy: 0, jumping: false, sliding: false, slideT: 0,
    speed: START_SPEED, time: 0, dist: 0, coins: 0, score: 0, yaw: 0, yawTarget: 0, camYaw: 0,
    season: selectedSeason, corners: 0, deadT: 0, latV: 0, fell: false,
  });
  P.visOff.set(0, 0, 0);
  turnQueue = null;
  panda.reset();
}

function buildWorld(season) {
  world.genSpeed = START_SPEED + 1.5;
  world.reset(season);
  world.ensure(0, 0, 99);
  audio.setSeason(season);
  worldFresh = true;
  snapCam = true;
}

// ------------------------------------------------------------------ controls
let tilt = { available: false, value: 0, base: null, raw: 0, listening: false };
function readTilt(e) {
  if (e.gamma == null) return;
  const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  let v = e.gamma;
  if (ang === 90) v = e.beta;
  else if (ang === -90 || ang === 270) v = -e.beta;
  else if (ang === 180) v = -e.gamma;
  tilt.raw = v;
  tilt.available = true;
  if (tilt.base === null) tilt.base = v;
}
function listenTilt() {
  if (tilt.listening) return;
  tilt.listening = true;
  addEventListener('deviceorientation', readTilt);
}
async function requestTilt() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission();
      if (res === 'granted') listenTilt();
    } catch (e) { /* denied or not in gesture: swipe fallback */ }
  } else if (DOE) listenTilt();
}
if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function' && isTouch) listenTilt();

const keys = new Set();
let steerSource = isTouch ? 'tilt' : 'mouse';

function inTurnWindow() {
  const seg = world.seg(P.seg);
  const early = 5 + P.speed * 0.12;
  return P.s >= seg.len - HALF - early && P.s <= seg.len + HALF;
}

function inputTurn(dir) {
  if (state !== 'playing') return;
  turnQueue = { dir, t: performance.now() };
  if (!inTurnWindow() && isTouch && !tilt.available) {
    // no tilt sensor: lateral swipes shift the panda across the road instead
    P.targetX = clamp(P.targetX + dir * PLAY_HALF * 0.95, -PLAY_HALF, PLAY_HALF);
  }
}
function inputJump() {
  if (state !== 'playing') return;
  if (P.jumping) return;
  P.sliding = false;
  P.jumping = true;
  P.vy = JUMP_V;
  audio.jump();
}
function inputSlide() {
  if (state !== 'playing') return;
  if (P.jumping) P.vy = Math.min(P.vy, -22); // slam down
  if (!P.sliding) audio.slide();
  P.sliding = true;
  P.slideT = SLIDE_TIME;
}

addEventListener('keydown', (e) => {
  audio.unlock();
  const k = e.key;
  if (state === 'home') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') goPage(selectedSeason - 1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') goPage(selectedSeason + 1);
    else if (k === 'Enter' || k === ' ') startRun();
    return;
  }
  if (state === 'over' && (k === 'Enter' || k === ' ')) { startRun(); return; }
  if (state === 'paused' && (k === 'Escape' || k === 'p' || k === 'P' || k === 'Enter')) { resume(); return; }
  if (state !== 'playing') return;
  if (e.repeat) return;
  keys.add(k.toLowerCase());
  if (k === 'ArrowLeft') inputTurn(-1);
  else if (k === 'ArrowRight') inputTurn(1);
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { inputJump(); e.preventDefault(); }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') { inputSlide(); e.preventDefault(); }
  else if (k === 'Escape' || k === 'p' || k === 'P') pause();
  if (k === 'a' || k === 'A' || k === 'd' || k === 'D') steerSource = 'keys';
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// Swipes (touch or mouse drag) + mouse steering
let swipe = null;
const SWIPE_PX = 26;
addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (state !== 'playing') return;
  if (e.target.closest && e.target.closest('button')) return;
  swipe = { x: e.clientX, y: e.clientY, used: false, id: e.pointerId, type: e.pointerType };
});
addEventListener('pointermove', (e) => {
  if (state === 'playing' && e.pointerType === 'mouse' && !swipe) {
    steerSource = 'mouse';
    const u = (e.clientX / innerWidth - 0.5) * 2;
    P.targetX = clamp(u * 1.35, -1, 1) * PLAY_HALF;
  }
  if (!swipe || swipe.used || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (Math.hypot(dx, dy) < SWIPE_PX) return;
  swipe.used = true;
  if (Math.abs(dx) > Math.abs(dy)) inputTurn(dx > 0 ? 1 : -1);
  else if (dy < 0) inputJump();
  else inputSlide();
});
const endSwipe = (e) => { if (swipe && e.pointerId === swipe.id) swipe = null; };
addEventListener('pointerup', endSwipe);
addEventListener('pointercancel', endSwipe);
document.addEventListener('touchmove', (e) => { if (state !== 'home') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
// first gesture anywhere starts the music (browsers block audio until then)
for (const ev of ['touchend', 'click', 'pointerup']) addEventListener(ev, () => audio.unlock(), { passive: true });

// ------------------------------------------------------------------ run lifecycle
function setScreen(id) {
  for (const s of ['home', 'hud', 'pause', 'over']) $(s).classList.toggle('active', s === id || (id === 'pause' && s === 'hud') || (id === 'over' && s === 'hud'));
}

function startRun() {
  audio.unlock();
  audio.click();
  if (isTouch) requestTilt(); // iOS: must be called from the tap
  clearTimeout(pageTimer);
  if (!worldFresh || world.startSeason !== selectedSeason) buildWorld(selectedSeason);
  worldFresh = false;
  resetPlayer();
  tilt.base = null; // recalibrate "neutral" to how the phone is held right now
  state = 'playing';
  audio.setMode('game');
  audio.setSeason(selectedSeason);
  setScreen('hud');
  updateSeasonBadge(selectedSeason, false);
  $('score').textContent = '0';
  $('coins').textContent = '0';
  runsPlayed++;
  localStorage.setItem('ss_runs', runsPlayed);
  if (runsPlayed <= 2) {
    const msg = isTouch
      ? 'Tilt to steer · Swipe ←/→ at corners · Swipe ↑ jump · ↓ slide'
      : 'A/D or mouse to steer · ←/→ turn at corners · ↑ jump · ↓ slide';
    toast(msg, 4200);
  }
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  audio.setMode('paused');
  setScreen('pause');
}
function resume() {
  if (state !== 'paused') return;
  state = 'playing';
  audio.setMode('game');
  setScreen('hud');
  clock.getDelta();
}
function goHome() {
  state = 'home';
  audio.setMode('menu');
  buildWorld(selectedSeason);
  resetPlayer();
  setScreen('home');
  refreshHome();
}

function crash() {
  state = 'dying';
  P.deadT = 0;
  P.sliding = false;
  shake = 0.5;
  audio.crash();
  audio.duck();
  if (navigator.vibrate) navigator.vibrate(120);
}
function fallOff() {
  state = 'falling';
  P.deadT = 0;
  P.vy = 2;
  audio.fall();
  audio.duck();
}
function gameOver() {
  state = 'over';
  audio.setMode('menu');
  const isBest = P.score > best;
  if (isBest) { best = P.score; localStorage.setItem('ss_best', best); }
  bank += P.coins;
  localStorage.setItem('ss_coins', bank);
  $('overScore').textContent = P.score.toLocaleString();
  $('overBest').textContent = best.toLocaleString();
  $('overCoins').textContent = P.coins;
  $('newBest').classList.toggle('show', isBest && P.score > 0);
  $('overTitle').textContent = state === 'over' && P.fell ? 'Off the edge!' : 'Bonk!';
  setScreen('over');
}

// ------------------------------------------------------------------ HUD helpers
let toastTimer = 0;
function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function updateSeasonBadge(i, flash) {
  const b = $('seasonBadge');
  b.textContent = SEASON_NAMES[i];
  applySeasonCss(i);
  if (flash) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
}
function applySeasonCss(i) {
  const c = SEASONS[i].css;
  const r = document.documentElement.style;
  r.setProperty('--accent', c.accent);
  r.setProperty('--accent-dark', c.dark);
  r.setProperty('--tint-top', c.top);
  r.setProperty('--tint-bottom', c.bottom);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', c.theme);
}
let lastScoreShown = -1;

// ------------------------------------------------------------------ simulation
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();

function doTurn(seg, dir) {
  const next = world.seg(P.seg + 1);
  const oldW = world.localToWorld(seg, P.s, P.x, tmpV);
  const [dx, dz] = dirVec(next.dir);
  const [rx, rz] = rightVec(next.dir);
  const px = oldW.x - next.sx, pz = oldW.z - next.sz;
  P.seg++;
  P.s = px * dx + pz * dz;
  P.x = clamp(px * rx + pz * rz, -PLAY_HALF, PLAY_HALF);
  const newW = world.localToWorld(next, P.s, P.x, tmpW);
  P.visOff.x += oldW.x - newW.x;
  P.visOff.z += oldW.z - newW.z;
  P.yawTarget -= dir * Math.PI / 2;
  P.corners++;
  turnQueue = null;
  audio.turn();
  if (navigator.vibrate) navigator.vibrate(15);
}

function updatePlaying(dt) {
  P.time += dt;
  P.speed = Math.min(MAX_SPEED, START_SPEED + P.time * ACCEL);
  audio.setIntensity((P.speed - START_SPEED) / (MAX_SPEED - START_SPEED));
  world.genSpeed = P.speed + 1.5;
  world.difficulty = clamp(P.time / 140, 0, 1);

  // --- steering target
  if (isTouch && tilt.available) {
    const t = tilt.raw - (tilt.base ?? tilt.raw);
    const dead = 1.5;
    const tv = Math.abs(t) < dead ? 0 : (t - Math.sign(t) * dead);
    tilt.value = damp(tilt.value, tv, 14, dt);
    P.targetX = clamp(tilt.value / 18, -1, 1) * PLAY_HALF;
  } else if (steerSource === 'keys') {
    const dirK = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    P.targetX = clamp(P.targetX + dirK * 7.5 * dt, -PLAY_HALF, PLAY_HALF);
  }
  const prevX = P.x;
  P.x = damp(P.x, clamp(P.targetX, -PLAY_HALF, PLAY_HALF), 11, dt);
  P.latV = (P.x - prevX) / Math.max(dt, 1e-4);

  // --- vertical
  if (P.jumping) {
    P.vy -= GRAVITY * dt;
    P.feet += P.vy * dt;
    if (P.feet <= 0) { P.feet = 0; P.vy = 0; P.jumping = false; }
  }
  if (P.sliding) {
    P.slideT -= dt;
    if (P.slideT <= 0) P.sliding = false;
  }

  // --- forward + corners
  let seg = world.seg(P.seg);
  const sPrev = P.s;
  P.s += P.speed * dt;
  P.dist += P.speed * dt;

  if (turnQueue && performance.now() - turnQueue.t > TURN_BUFFER * 1000 && !inTurnWindow()) turnQueue = null;
  let turned = false;
  if (turnQueue && inTurnWindow()) {
    if (turnQueue.dir === seg.turn) { doTurn(seg, seg.turn); seg = world.seg(P.seg); turned = true; }
    else turnQueue = null;
  }
  if (P.s > seg.len + HALF) { P.fell = true; fallOff(); return; }

  // --- collisions (tight boxes, swept along the frame's motion)
  const height = P.sliding ? SLIDE_H : STAND_H;
  const sA = turned ? P.s : sPrev;
  if (world.hit(seg, sA, P.s, P.x, P.feet, height)) { P.fell = false; crash(); return; }

  // --- coins
  const got = world.collect(seg, sA, P.s, P.x, P.feet + (P.sliding ? 0.4 : 0.8));
  if (got) {
    P.coins += got;
    audio.coin();
    const c = $('coins');
    c.textContent = P.coins;
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }

  // --- season progress
  const season = world.seasonOf(P.seg);
  if (season !== P.season) {
    P.season = season;
    world.setAtmosphere(season);
    audio.setSeason(season);
    audio.seasonChime();
    updateSeasonBadge(season, true);
  }

  P.score = Math.floor(P.dist) + P.coins * 10;
  if (P.score !== lastScoreShown) { $('score').textContent = P.score.toLocaleString(); lastScoreShown = P.score; }

  // first corners of the first runs get an arrow hint
  const hint = $('turnHint');
  const showHint = runsPlayed <= 3 && P.corners < 2 && P.s > seg.len - HALF - 16 && P.s < seg.len + HALF;
  if (showHint) hint.textContent = seg.turn > 0 ? '➜' : '⬅';
  hint.classList.toggle('show', showHint);

  world.ensure(P.seg, P.s, 1);
}

function updateDying(dt) {
  P.deadT += dt;
  if (P.deadT > 1.1 && state === 'dying') gameOver();
}

function updateFalling(dt) {
  P.deadT += dt;
  const seg = world.seg(P.seg);
  P.speed = damp(P.speed, 4, 2, dt);
  P.s += P.speed * dt;
  P.vy -= GRAVITY * 0.8 * dt;
  P.feet += P.vy * dt;
  if (seg && P.feet < -8) P.feet = -8;
  if (P.deadT > 1.3 && state === 'falling') gameOver();
}

// ------------------------------------------------------------------ rendering / camera
const clock = new THREE.Clock();
let frameAcc = 0, frameN = 0;
let homeT = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (state === 'playing') updatePlaying(dt);
  else if (state === 'dying') updateDying(dt);
  else if (state === 'falling') updateFalling(dt);
  if (state === 'home') { homeT += dt; world.ensure(0, 0, 1); }

  // --- panda placement
  const seg = world.seg(P.seg);
  world.localToWorld(seg, P.s, P.x, focus, P.feet);
  P.visOff.multiplyScalar(Math.exp(-dt * 10));
  focus.add(P.visOff);
  panda.root.position.copy(focus);
  P.yaw = damp(P.yaw, P.yawTarget, 22, dt);
  P.camYaw = damp(P.camYaw, P.yawTarget, state === 'playing' ? 7.5 : 4, dt);
  panda.root.rotation.set(0, P.yaw, clamp(-P.latV * 0.025, -0.25, 0.25), 'YXZ');
  const mode = state === 'home' ? 'idle'
    : state === 'dying' || state === 'over' && !P.fell ? 'crash'
    : state === 'falling' || (state === 'over' && P.fell) ? 'fall'
    : state === 'paused' ? 'run-paused'
    : P.sliding ? 'slide' : P.jumping ? 'jump' : 'run';
  if (mode !== 'run-paused') panda.animate(dt, { mode, speed: P.speed });
  blob.position.set(focus.x, 0.02, focus.z);
  const bs = clamp(1 - P.feet * 0.35, 0.3, 1);
  blob.scale.set(bs, 1, bs);
  blob.visible = P.feet > -0.5;

  // --- camera
  const cy = P.camYaw;
  const cos = Math.cos(cy), sin = Math.sin(cy);
  const home = state === 'home';
  const off = home ? [0.0, 2.3 + Math.sin(homeT * 0.5) * 0.1, 4.8] : [0, 3.4, 6.2];
  const look = home ? [0, 1.25, -6] : [0, 1.0, -7.5];
  // follow the panda's lateral position only partly, so the road stays framed
  const [rx, rz] = rightVec(seg.dir);
  const latPull = home ? 0 : P.x * 0.3;
  const camFeet = state === 'falling' || (state === 'over' && P.fell) ? 0 : P.feet * 0.35;
  const fx = focus.x - rx * latPull, fz = focus.z - rz * latPull;
  const desired = tmpV.set(fx + off[0] * cos + off[2] * sin, off[1] + camFeet, fz - off[0] * sin + off[2] * cos);
  const lookAt = tmpW.set(fx + look[0] * cos + look[2] * sin, look[1] + camFeet, fz - look[0] * sin + look[2] * cos);
  if (snapCam) { camPos.copy(desired); camLook.copy(lookAt); snapCam = false; }
  if (state === 'playing' || state === 'home') {
    camPos.x = damp(camPos.x, desired.x, 9, dt);
    camPos.y = damp(camPos.y, desired.y, 6, dt);
    camPos.z = damp(camPos.z, desired.z, 9, dt);
    camLook.x = damp(camLook.x, lookAt.x, 12, dt);
    camLook.y = damp(camLook.y, lookAt.y, 6, dt);
    camLook.z = damp(camLook.z, lookAt.z, 12, dt);
  }
  camera.position.copy(camPos);
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    const a = shake * 0.5;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
  }
  camera.lookAt(camLook);

  world.updateAtmosphere(dt);
  world.follow(focus, camera, state === 'paused' ? 0 : dt);
  world.updateCoins(state === 'paused' ? 0 : dt, focus);
  renderer.render(scene, camera);

  // --- adaptive resolution for a steady 60fps on phones
  if (state === 'playing') {
    frameAcc += dt; frameN++;
    if (frameN >= 90) {
      const avg = frameAcc / frameN;
      if (avg > 0.0205 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
      }
      frameAcc = 0; frameN = 0;
    }
  }
}

// ------------------------------------------------------------------ home screen
const pages = $('pages');
const dots = [...$('dots').children];
let pageTimer = 0;
function goPage(i) {
  i = (i + 4) % 4;
  pages.scrollTo({ left: i * pages.clientWidth, behavior: 'smooth' });
  setSeasonSelection(i);
}
function setSeasonSelection(i) {
  if (i === selectedSeason && worldFresh) return;
  selectedSeason = i;
  localStorage.setItem('ss_season', i);
  dots.forEach((d, k) => d.classList.toggle('on', k === i));
  applySeasonCss(i);
  world.setAtmosphere(i);
  audio.setSeason(i);
  clearTimeout(pageTimer);
  pageTimer = setTimeout(() => { if (state === 'home') { buildWorld(i); } }, 140);
}
pages.addEventListener('scroll', () => {
  const i = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
  if (i !== selectedSeason) setSeasonSelection(clamp(i, 0, 3));
}, { passive: true });
$('prevSeason').onclick = () => { audio.unlock(); audio.click(); goPage(selectedSeason - 1); };
$('nextSeason').onclick = () => { audio.unlock(); audio.click(); goPage(selectedSeason + 1); };
$('playBtn').onclick = startRun;
$('againBtn').onclick = startRun;
$('pauseBtn').onclick = (e) => { e.stopPropagation(); audio.click(); pause(); };
$('resumeBtn').onclick = () => { audio.click(); resume(); };
$('pauseHomeBtn').onclick = () => { audio.click(); goHome(); };
$('overHomeBtn').onclick = () => { audio.click(); goHome(); };
const soundBtn = $('soundBtn');
const paintSound = () => { soundBtn.textContent = audio.enabled ? '🔊' : '🔇'; };
soundBtn.onclick = (e) => { e.stopPropagation(); audio.unlock(); audio.setEnabled(!audio.enabled); paintSound(); };
const musicBtn = $('musicBtn');
const sfxBtn = $('sfxBtn');
const paintAudioToggles = () => {
  musicBtn.textContent = 'Music: ' + (audio.musicOn ? 'On' : 'Off');
  sfxBtn.textContent = 'Sound FX: ' + (audio.sfxOn ? 'On' : 'Off');
  musicBtn.classList.toggle('off', !audio.musicOn);
  sfxBtn.classList.toggle('off', !audio.sfxOn);
};
musicBtn.onclick = () => { audio.unlock(); audio.setMusicEnabled(!audio.musicOn); audio.click(); paintAudioToggles(); };
sfxBtn.onclick = () => { audio.unlock(); audio.setSfxEnabled(!audio.sfxOn); audio.click(); paintAudioToggles(); };
paintAudioToggles();
if (/[?&]debug\b/.test(location.search)) window.__ss = { audio, P, get state() { return state; } };
paintSound();

function refreshHome() {
  $('homeBest').textContent = best.toLocaleString();
  $('homeCoins').textContent = bank.toLocaleString();
  dots.forEach((d, k) => d.classList.toggle('on', k === selectedSeason));
  applySeasonCss(selectedSeason);
  const iosTilt = window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function';
  $('homeHint').textContent = iosTilt ? 'Swipe to pick a season · Play enables tilt steering' : isTouch ? 'Swipe to pick a season' : 'Swipe or ←/→ to pick a season · Enter to play';
  requestAnimationFrame(() => { pages.scrollLeft = selectedSeason * pages.clientWidth; });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ------------------------------------------------------------------ boot
buildWorld(selectedSeason);
resetPlayer();
refreshHome();
audio.unlock(); // starts immediately where autoplay is allowed; otherwise on first touch
frame();
requestAnimationFrame(() => $('loading').classList.add('hide'));
