// Service worker de Cagot : reçoit ce qui est partagé depuis les autres applis du téléphone
// (« Partager → Cagot » : texte de l'appli Notes, Keep, photos de la galerie…).
// Il garde aussi une copie de l'appli elle-même pour qu'elle s'ouvre sans réseau (mode chantier) :
// réseau d'abord (les mises à jour arrivent toujours), copie seulement si le réseau ne répond pas.
const CACHE_PARTAGE = "cagot-partage";
const CACHE_APPLI = "cagot-appli-v1";
const COQUILLE = [
  "/", "/index.html", "/style.css", "/app.js", "/plateforme.js", "/hors-ligne.js", "/calcul.js", "/corps-etat.js",
  "/pdf-devis.js", "/logo.js", "/config.json", "/manifest.webmanifest", "/vendor/supabase.js",
  "/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js", "/icones/icone-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_APPLI)
      .then((c) => Promise.allSettled(COQUILLE.map((u) => c.add(new Request(u, { cache: "no-cache" })))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Supabase, IA : gérés par l'appli
  if (e.request.method === "POST" && url.pathname === "/partage") return e.respondWith(recevoirPartage(e.request));
  if (e.request.method !== "GET" || url.pathname.startsWith("/partage/") || url.pathname === "/sw.js") return;
  e.respondWith(reseauPuisCopie(e.request));
});

async function reseauPuisCopie(requete) {
  const cache = await caches.open(CACHE_APPLI);
  const chemin = new URL(requete.url).pathname;
  const cle = requete.mode === "navigate" && (chemin === "/" || chemin === "/index.html") ? "/" : chemin;
  try {
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), 6000);
    const rep = await fetch(requete, { signal: ctrl.signal });
    clearTimeout(minuterie);
    if (rep.ok) cache.put(cle, rep.clone()).catch(() => {});
    return rep;
  } catch (err) {
    const copie = await cache.match(cle);
    if (copie) return copie;
    throw err;
  }
}

async function recevoirPartage(requete) {
  try {
    const donnees = await requete.formData();
    const cache = await caches.open(CACHE_PARTAGE);
    for (const cle of await cache.keys()) await cache.delete(cle);
    const fichiers = [];
    let i = 0;
    for (const f of donnees.getAll("fichiers")) {
      if (!(f instanceof File) || f.size > 15 * 1024 * 1024 || i >= 20) continue;
      const cle = `/partage/fichier-${i++}`;
      await cache.put(cle, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream" } }));
      fichiers.push({ cle, nom: f.name || "fichier", type: f.type || "" });
    }
    const contenu = {
      titre: String(donnees.get("title") ?? "").slice(0, 200),
      texte: String(donnees.get("text") ?? "").slice(0, 50000),
      url: String(donnees.get("url") ?? "").slice(0, 2000),
      fichiers,
    };
    await cache.put("/partage/contenu.json", new Response(JSON.stringify(contenu), { headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("Partage non reçu", err);
  }
  return Response.redirect("/?partage=1", 303);
}
