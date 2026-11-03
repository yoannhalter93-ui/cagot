// Nettoyage d'un logo importé (photo, capture d'écran…) : on retire le fond qui touche
// les bords (bandes noires, carré gris, fond blanc), on recadre au plus près et on
// trouve la couleur principale du logo. Fonctions pures sur des ImageData (testables).

const distance = (d, i, c) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));

// Couleurs de fond : les teintes les plus fréquentes sur le pourtour de l'image.
function couleursDuBord(img) {
  const { data: d, width: w, height: h } = img;
  const comptes = new Map();
  let total = 0;
  const ajouter = (x, y) => {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 128) return;
    const cle = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
    const c = comptes.get(cle) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += d[i];
    c.g += d[i + 1];
    c.b += d[i + 2];
    comptes.set(cle, c);
    total++;
  };
  for (let x = 0; x < w; x++) {
    ajouter(x, 0);
    ajouter(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    ajouter(0, y);
    ajouter(w - 1, y);
  }
  const tri = [...comptes.values()].sort((a, b) => b.n - a.n);
  const fonds = [];
  let couvert = 0;
  for (const c of tri) {
    if (c.n / total < 0.03 || fonds.length >= 4) break;
    fonds.push([c.r / c.n, c.g / c.n, c.b / c.n]);
    couvert += c.n;
  }
  return { fonds, couvert: total ? couvert / total : 1 };
}

// Rend transparent le fond relié aux bords ; renvoie le cadre utile {x, y, w, h}.
export function nettoyerLogo(img, { tolerance = 34, fondu = 46 } = {}) {
  const { data: d, width: w, height: h } = img;
  const { fonds, couvert } = couleursDuBord(img);
  // Bord trop varié (photo de chantier…) : on ne touche pas au fond.
  if (fonds.length && couvert >= 0.85) {
    // Distance au fond : à chaque couleur de fond, et aux mélanges de deux fonds
    // (la ligne de transition entre une bande noire et un fond gris, par exemple).
    const paires = [];
    for (let a = 0; a < fonds.length; a++) for (let b = a + 1; b < fonds.length; b++) paires.push([fonds[a], fonds[b]]);
    const proche = (i) => {
      let m = Math.min(...fonds.map((c) => distance(d, i, c)));
      for (const [a, b] of paires) {
        const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((d[i] - a[0]) * v[0] + (d[i + 1] - a[1]) * v[1] + (d[i + 2] - a[2]) * v[2]) / l2));
        m = Math.min(m, distance(d, i, [a[0] + t * v[0], a[1] + t * v[1], a[2] + t * v[2]]));
      }
      return m;
    };
    const vu = new Uint8Array(w * h);
    const pile = [];
    const pousser = (p) => {
      if (!vu[p]) {
        vu[p] = 1;
        pile.push(p);
      }
    };
    for (let x = 0; x < w; x++) {
      pousser(x);
      pousser((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      pousser(y * w);
      pousser(y * w + w - 1);
    }
    while (pile.length) {
      const p = pile.pop();
      const i = p * 4;
      const ecart = d[i + 3] < 20 ? 0 : proche(i);
      if (ecart > tolerance + fondu) continue; // le logo commence ici
      if (ecart <= tolerance) d[i + 3] = 0;
      else {
        // Bord adouci du logo : transparence progressive, sans propager plus loin.
        d[i + 3] = Math.min(d[i + 3], Math.round((255 * (ecart - tolerance)) / fondu));
        continue;
      }
      const x = p % w;
      if (x > 0) pousser(p - 1);
      if (x < w - 1) pousser(p + 1);
      if (p >= w) pousser(p - w);
      if (p < w * (h - 1)) pousser(p + w);
    }
  }
  // Recadrage sur les pixels visibles
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  const marge = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  x0 = Math.max(0, x0 - marge);
  y0 = Math.max(0, y0 - marge);
  x1 = Math.min(w - 1, x1 + marge);
  y1 = Math.min(h - 1, y1 + marge);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const hex = (r, g, b) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const lineaire = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (r, g, b) => 0.2126 * lineaire(r) + 0.7152 * lineaire(g) + 0.0722 * lineaire(b);

// Couleur la plus présente parmi les pixels colorés du logo (null si logo noir/gris).
// Assombrie si besoin pour rester lisible avec du texte blanc dessus.
export function couleurDominante(img) {
  const d = img.data;
  const groupes = new Map();
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 200) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40 || max - min < 50) continue; // gris, noir, blanc
    const cle = `${r >> 5},${g >> 5},${b >> 5}`;
    const c = groupes.get(cle) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n += max - min; // les teintes franches comptent plus
    c.r += r * (max - min);
    c.g += g * (max - min);
    c.b += b * (max - min);
    groupes.set(cle, c);
  }
  const top = [...groupes.values()].sort((a, b) => b.n - a.n)[0];
  if (!top) return null;
  let [r, g, b] = [top.r / top.n, top.g / top.n, top.b / top.n];
  // Contraste avec le blanc ≥ 3 (titres et en-têtes de tableau en blanc)
  for (let k = 0; k < 20 && 1.05 / (luminance(r, g, b) + 0.05) < 3; k++) {
    r *= 0.93;
    g *= 0.93;
    b *= 0.93;
  }
  return hex(r, g, b);
}
