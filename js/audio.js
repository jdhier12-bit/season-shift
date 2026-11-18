// Season Shift — WebAudio engine: original recorded music (by Bok II) + synthesized SFX.
// Music: five seamless loops (home theme + one per season) decoded into AudioBuffers and
// looped sample-accurately. Season tracks share tempo (126 BPM) and length, so a season change
// crossfades into the next track at the SAME playback position and bars stay aligned.

const MUSIC_DIR = './music/';
const TRACKS = {
  // loopSec = exact musical loop length (from music/loops.json)
  home: { name: 'home-theme', loopSec: 3225600 / 44100, bar: 4 * 60 / 105 },
  spring: { name: 'spring', loopSec: 3360000 / 44100, bar: 4 * 60 / 126 },
  summer: { name: 'summer', loopSec: 3360000 / 44100, bar: 4 * 60 / 126 },
  autumn: { name: 'autumn', loopSec: 3360000 / 44100, bar: 4 * 60 / 126 },
  winter: { name: 'winter', loopSec: 3360000 / 44100, bar: 4 * 60 / 126 },
};
const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];
const MP3_PRIMING = 1105 / 44100; // LAME encoder delay, if the decoder doesn't trim it
// Optional: [startBar, endBar) ranges per track where a crossfade should not begin.
// loops.json doesn't list any yet; add here if it ever does.
const AVOID_FADE_BARS = {};

// Volumes (music is mastered to ~-14 LUFS, so it sits well under the loud SFX)
const MUSIC_VOL = { menu: 0.55, game: 0.6, paused: 0.16, over: 0.5 };
const XFADE = 2.5; // seconds, season-to-season

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

function pickFormat() {
  // Ogg Vorbis decodes gaplessly everywhere it's supported; Safari/iOS gets MP3 (+ priming detection).
  try {
    const a = document.createElement('audio');
    if (a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"')) return 'ogg';
  } catch (e) { /* ignore */ }
  return 'mp3';
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = lsGet('ss_sound') !== 'off'; // master (home mute button)
    this.musicOn = lsGet('ss_music') !== 'off';
    this.sfxOn = lsGet('ss_sfx') !== 'off';
    this.mode = 'menu';
    this.season = 0;
    this.transpose = 2; // season chime is played in D to match the music
    this.intensity = 0;
    this.buffers = {}; // key -> { buffer, offset }
    this.cur = null; // { key, src, gain, t0 } ; t0 = ctx time at which loop position 0 played
    this.pendingFade = null;
    this.format = pickFormat();
    // start downloading right away (no AudioContext needed yet)
    this.raw = {};
    for (const key of Object.keys(TRACKS)) this.raw[key] = this._fetch(key);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (this._unlocked) this.ctx.resume().catch(() => {});
    });
  }

  _fetch(key, fmt = this.format) {
    return fetch(MUSIC_DIR + TRACKS[key].name + '.' + fmt)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => ({ ab, fmt }));
  }

  /** Create/resume the context. Safe to call repeatedly; must be called from a gesture on iOS. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._build();
      this._loadAll();
      this.ctx.onstatechange = () => { if (this.ctx.state === 'running') this._sync(); };
    }
    if (this.ctx.state !== 'running' && !document.hidden) {
      const p = this.ctx.resume();
      if (p && p.then) p.then(() => { this._unlocked = this.ctx.state === 'running'; this._sync(); }).catch(() => {});
    } else if (this.ctx.state === 'running') this._unlocked = true;
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  _build() {
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(c.destination);
    this.comp.connect(this.master);
    // SFX: synthesized, loud, through the compressor
    this.sfx = c.createGain();
    this.sfx.gain.value = 1.0;
    this.sfx.connect(this.comp);
    // Music: tracks -> mix -> tone (lowpass + high shelf, opens with speed) -> mode vol -> duck -> user toggle -> master
    this.musicMix = c.createGain();
    this.musicLP = c.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 20000;
    this.musicLP.Q.value = 0.5;
    this.musicShelf = c.createBiquadFilter();
    this.musicShelf.type = 'highshelf';
    this.musicShelf.frequency.value = 3500;
    this.musicShelf.gain.value = 0;
    this.music = c.createGain(); // mode volume
    this.music.gain.value = MUSIC_VOL.menu;
    this.duckGain = c.createGain();
    this.musicUser = c.createGain();
    this.musicUser.gain.value = this.musicOn ? 1 : 0;
    this.musicMix.connect(this.musicLP).connect(this.musicShelf).connect(this.music)
      .connect(this.duckGain).connect(this.musicUser).connect(this.master);
    // shared noise buffer
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _decode(ab) {
    // callback form for older Safari (webkitAudioContext has no promise version)
    return new Promise((res, rej) => {
      try {
        const p = this.ctx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      } catch (e) { rej(e); }
    });
  }

  _loadAll() {
    // home first so it can start as soon as possible
    const keys = ['home', ...SEASON_KEYS];
    let chain = Promise.resolve();
    for (const key of keys) {
      chain = chain.then(() => this._loadOne(key)).catch((e) => console.warn('[music]', key, e && e.message));
    }
    this.ready = chain;
  }

  async _loadOne(key) {
    let got;
    try {
      const { ab, fmt } = await this.raw[key];
      got = { buffer: await this._decode(ab), fmt };
    } catch (e) {
      if (this.format === 'mp3') throw e;
      // ogg failed to decode (some WebKit builds) -> fall back to mp3
      const { ab, fmt } = await this._fetch(key, 'mp3');
      got = { buffer: await this._decode(ab), fmt };
    }
    const t = TRACKS[key];
    const extra = got.buffer.duration - t.loopSec;
    // An MP3 decoded without honouring the LAME gapless header carries 1105 priming samples
    // (+ end padding). Trimmed decodes are within a few samples of the loop length.
    const offset = got.fmt === 'mp3' && extra > 0.012 && got.buffer.duration >= MP3_PRIMING + t.loopSec ? MP3_PRIMING : 0;
    this.buffers[key] = { buffer: got.buffer, offset, fmt: got.fmt, extra };
    this._sync();
  }

  // ---------------- music control ----------------
  /** The track that should be playing right now. */
  _wanted() {
    if (this.mode === 'game' || this.mode === 'paused' || this.mode === 'dying') return SEASON_KEYS[this.season] || 'spring';
    return 'home';
  }

  _pos(track, t) {
    const L = TRACKS[track.key].loopSec;
    return (((t - track.t0) % L) + L) % L;
  }

  _startTrack(key, when, pos, fadeIn) {
    const c = this.ctx;
    const b = this.buffers[key];
    const L = TRACKS[key].loopSec;
    const src = c.createBufferSource();
    src.buffer = b.buffer;
    src.loop = true;
    src.loopStart = b.offset;
    src.loopEnd = b.offset + L;
    const g = c.createGain();
    src.connect(g).connect(this.musicMix);
    if (fadeIn > 0) {
      g.gain.setValueAtTime(0, when);
      // equal-power-ish rise
      for (let i = 1; i <= 8; i++) g.gain.linearRampToValueAtTime(Math.sin((i / 8) * Math.PI / 2), when + (fadeIn * i) / 8);
    } else g.gain.setValueAtTime(1, when);
    src.start(when, b.offset + pos);
    return { key, src, gain: g, t0: when - pos };
  }

  _stopTrack(track, when, fadeOut) {
    if (!track) return;
    const g = track.gain.gain;
    try { g.cancelScheduledValues(when); } catch (e) { /* ignore */ }
    const from = Math.max(0, Math.min(1, g.value));
    g.setValueAtTime(from, when);
    if (fadeOut > 0) {
      for (let i = 1; i <= 8; i++) g.linearRampToValueAtTime(from * Math.cos((i / 8) * Math.PI / 2), when + (fadeOut * i) / 8);
    } else g.setValueAtTime(0, when);
    try { track.src.stop(when + fadeOut + 0.05); } catch (e) { /* ignore */ }
    if (this.fading) this.fading = this.fading.filter((f) => f !== track);
    (this.fading = this.fading || []).push(track);
    track.src.onended = () => { try { track.gain.disconnect(); } catch (e) { /* ignore */ } this.fading = this.fading.filter((f) => f !== track); };
  }

  /** Make the playing music match mode/season. */
  _sync() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const want = this._wanted();
    if (!this.buffers[want]) return; // still loading; we'll be called again when it decodes
    const now = this.ctx.currentTime;
    if (this.cur && this.cur.key === want) return;
    clearTimeout(this.pendingFade);
    this.pendingFade = null;
    const old = this.cur;
    const bothSeasons = old && old.key !== 'home' && want !== 'home';
    if (bothSeasons) {
      // season change mid-run: fade in at the same playback position, on the next bar line
      const bar = TRACKS[want].bar;
      let tStart = now + 0.05;
      let pos = this._pos(old, tStart);
      const toBar = (bar - (pos % bar)) % bar;
      if (toBar > 0.02) { tStart += toBar; pos = this._pos(old, tStart); }
      const avoid = AVOID_FADE_BARS[old.key] || AVOID_FADE_BARS[want];
      if (avoid) {
        for (const [a, b] of avoid) {
          const barNo = Math.round(pos / bar) % Math.round(TRACKS[want].loopSec / bar);
          if (barNo >= a && barNo < b) { tStart += (b - barNo) * bar; pos = this._pos(old, tStart); }
        }
      }
      this.cur = this._startTrack(want, tStart, pos, XFADE);
      this._stopTrack(old, tStart, XFADE);
      this.lastFade = { from: old.key, to: want, at: tStart, pos };
    } else {
      // home <-> run: new track from its top, quick fade of the old one
      const tStart = now + 0.03;
      this.cur = this._startTrack(want, tStart, 0, old ? 0.6 : 0.25);
      if (old) this._stopTrack(old, tStart, 0.7);
      this.lastFade = { from: old ? old.key : null, to: want, at: tStart, pos: 0 };
    }
  }

  setEnabled(on) {
    this.enabled = on;
    lsSet('ss_sound', on ? 'on' : 'off');
    if (this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusicEnabled(on) {
    this.musicOn = on;
    lsSet('ss_music', on ? 'on' : 'off');
    if (this.musicUser) this.musicUser.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.08);
  }

  setSfxEnabled(on) {
    this.sfxOn = on;
    lsSet('ss_sfx', on ? 'on' : 'off');
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = MUSIC_VOL[mode] != null ? MUSIC_VOL[mode] : MUSIC_VOL.menu;
    this.music.gain.setTargetAtTime(vol, t, mode === 'paused' ? 0.12 : 0.25);
    // paused: muffle as well as lower
    this.musicLP.frequency.setTargetAtTime(mode === 'paused' ? 900 : mode === 'game' ? this._lpFor(this.intensity) : 20000, t, 0.1);
    if (mode !== 'game' && mode !== 'paused') {
      this.intensity = 0;
      this.musicShelf.gain.setTargetAtTime(0, t, 0.3);
      this.musicMix.gain.setTargetAtTime(1, t, 0.3);
    }
    if (mode === 'menu') this.duckGain.gain.setTargetAtTime(1, t, 0.3);
    this._sync();
  }

  setSeason(i) {
    this.season = i;
    this._sync();
  }

  /** 0..1 run intensity (speed). Gentle: the filter opens and the top end lifts a little. */
  _lpFor(k) { return 11000 * Math.pow(20000 / 11000, k); }
  setIntensity(k) {
    k = Math.max(0, Math.min(1, k));
    if (!this.ctx || Math.abs(k - this.intensity) < 0.02) return;
    this.intensity = k;
    const t = this.ctx.currentTime;
    if (this.mode === 'game') this.musicLP.frequency.setTargetAtTime(this._lpFor(k), t, 0.5);
    this.musicShelf.gain.setTargetAtTime(2.5 * k, t, 0.5);
    this.musicMix.gain.setTargetAtTime(1 + 0.18 * k, t, 0.5); // about +1.4 dB at top speed
  }

  /** Brief dip of the music under the crash. */
  duck() {
    if (!this.ctx) return;
    const g = this.duckGain.gain;
    const t = this.ctx.currentTime;
    try { g.cancelScheduledValues(t); } catch (e) { /* ignore */ }
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.18, t + 0.06);
    g.setTargetAtTime(1, t + 0.9, 0.35);
  }

  _noise(t, dur, vol, type, freq, q = 1, dest = this.music, endFreq = null) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  _kick(t, vol, dest = this.music) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  // ---------------- SFX ----------------
  _sfxOsc(type, f0, f1, t, dur, vol, curve = 'exp') {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _ok() { return this.ctx && this.ctx.state === 'running' && this.enabled && this.sfxOn; }

  coin() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const v = 0.32;
    this._sfxOsc('square', 988, 990, t, 0.07, v, 'lin');
    this._sfxOsc('square', 1319, 1320, t + 0.06, 0.22, v, 'lin');
    this._sfxOsc('sine', 2637, 2640, t + 0.06, 0.18, v * 0.5, 'lin');
  }

  jump() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._sfxOsc('square', 260, 920, t, 0.18, 0.3);
    this._sfxOsc('sine', 520, 1500, t, 0.16, 0.35);
    this._noise(t, 0.12, 0.25, 'highpass', 3000, 0.7, this.sfx);
  }

  slide() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.38, 0.9, 'bandpass', 2600, 1.2, this.sfx, 380);
    this._sfxOsc('sawtooth', 420, 120, t, 0.25, 0.18);
  }

  turn() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.22, 0.8, 'bandpass', 900, 1.5, this.sfx, 4200);
    this._sfxOsc('triangle', 700, 1100, t, 0.1, 0.4);
    this._kick(t, 0.5, this.sfx);
  }

  crash() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._kick(t, 1.4, this.sfx);
    this._noise(t, 0.6, 1.2, 'lowpass', 3000, 0.7, this.sfx, 200);
    this._sfxOsc('square', 300, 40, t, 0.55, 0.4);
    this._sfxOsc('sawtooth', 180, 30, t + 0.05, 0.6, 0.35);
  }

  fall() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._sfxOsc('square', 900, 80, t, 0.9, 0.3);
    this._sfxOsc('sine', 600, 60, t, 0.9, 0.4);
    this._noise(t + 0.6, 0.5, 1.0, 'lowpass', 1500, 0.7, this.sfx, 150);
    this._kick(t + 0.6, 1.3, this.sfx);
  }

  click() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._sfxOsc('square', 660, 880, t, 0.07, 0.22, 'lin');
  }

  powerup() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16].forEach((n, i) => this._sfxOsc('square', mtof(76 + n), mtof(76 + n), t + i * 0.045, 0.14, 0.24, 'lin'));
    this._sfxOsc('sine', 600, 2400, t, 0.3, 0.3);
  }

  shieldBreak() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.45, 1.0, 'highpass', 2500, 0.8, this.sfx, 6000);
    this._sfxOsc('triangle', 1800, 300, t, 0.35, 0.4);
    this._kick(t, 0.8, this.sfx);
  }

  buy() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._sfxOsc('square', 1319, 1320, t, 0.08, 0.28, 'lin');
    this._sfxOsc('square', 1760, 1761, t + 0.07, 0.1, 0.28, 'lin');
    this._sfxOsc('square', 2637, 2638, t + 0.14, 0.3, 0.24, 'lin');
    this._sfxOsc('sine', 3520, 3521, t + 0.14, 0.3, 0.14, 'lin');
  }

  denied() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._sfxOsc('square', 220, 200, t, 0.12, 0.25, 'lin');
    this._sfxOsc('square', 165, 150, t + 0.12, 0.18, 0.25, 'lin');
  }

  revive() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this._sfxOsc('triangle', mtof(n), mtof(n), t + i * 0.05, 0.3, 0.3, 'lin'));
  }

  // (was season(), which the `season` index property shadowed -> TypeError on every season change)
  seasonChime() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this._sfxOsc('triangle', mtof(n + this.transpose), mtof(n + this.transpose), t + i * 0.07, 0.3, 0.25, 'lin'));
  }
}
