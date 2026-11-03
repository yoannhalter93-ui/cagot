import { test } from "node:test";
import assert from "node:assert/strict";
import { couleurDominante, nettoyerLogo } from "../public/logo.js";

// Image 40×20 : bandes noires en haut/bas, fond gris clair, logo orange au centre.
function image() {
  const w = 40, h = 20, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = y < 3 || y >= 17 ? [0, 0, 0] : x >= 15 && x < 25 && y >= 8 && y < 12 ? [236, 115, 80] : [244, 243, 240];
    data.set([...c, 255], i);
  }
  return { data, width: w, height: h };
}

test("le fond relié aux bords est retiré et le logo recadré", () => {
  const img = image();
  const cadre = nettoyerLogo(img);
  assert.equal(img.data[3], 0); // coin noir transparent
  assert.equal(img.data[(5 * 40 + 5) * 4 + 3], 0); // fond gris transparent
  assert.equal(img.data[(10 * 40 + 20) * 4 + 3], 255); // logo conservé
  assert.deepEqual(cadre, { x: 15, y: 8, w: 10, h: 4 });
});

test("la couleur du logo est proposée, lisible sur du blanc", () => {
  const img = image();
  nettoyerLogo(img);
  const c = couleurDominante(img);
  assert.match(c, /^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  assert.ok(r > g && g > b, c); // reste orange
});

test("un logo noir et blanc ne propose pas de couleur", () => {
  const w = 4, h = 4, data = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(couleurDominante({ data, width: w, height: h }), null);
});
