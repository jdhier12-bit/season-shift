import * as THREE from 'three';

/** Cobbled path texture (grayscale, tinted per season by material color). */
export function makeRoadTexture(renderer) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#b8b2a8';
  g.fillRect(0, 0, size, size);
  // irregular flagstones laid in rows
  let y = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (y < size) {
    const h = 34 + rnd() * 22;
    let x = -rnd() * 30;
    while (x < size) {
      const w = 40 + rnd() * 40;
      const shade = 225 + Math.floor(rnd() * 30);
      g.fillStyle = `rgb(${shade},${shade - 3},${shade - 8})`;
      const r = 9;
      roundRect(g, x + 2.5, y + 2.5, w - 5, Math.min(h, size - y) - 5, r);
      g.fill();
      // wrap horizontally so the texture tiles
      if (x + w > size) { roundRect(g, x - size + 2.5, y + 2.5, w - 5, Math.min(h, size - y) - 5, r); g.fill(); }
      x += w;
    }
    y += h;
  }
  // grain
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Soft round sprite for particles (petals, leaves, snow, pollen). */
export function makeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft blob shadow under the panda (cheap contact shadow). */
export function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
