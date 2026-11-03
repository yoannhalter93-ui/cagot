// Service worker de Cagot : reçoit ce qui est partagé depuis les autres applis du téléphone
// (« Partager → Cagot » : texte de l'appli Notes, Keep, photos de la galerie…).
// Il ne met rien d'autre en cache : l'appli se charge toujours depuis le réseau.
const CACHE_PARTAGE = "cagot-partage";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname === "/partage") {
    e.respondWith(recevoirPartage(e.request));
  }
  // Toutes les autres requêtes passent normalement par le réseau.
});

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
