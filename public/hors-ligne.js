// Mode chantier sans connexion.
// Cette couche se place entre l'appli et Supabase (option `fetch` du client) :
//  - lectures (/rest, /storage) : réseau d'abord, copie gardée sur le téléphone, servie hors réseau ;
//  - écritures sur les notes, photos, chantiers et clients : si le réseau manque, elles sont mises
//    en file d'attente sur le téléphone, l'appli continue comme si c'était enregistré, et tout
//    part au serveur dès le retour du réseau (dans l'ordre).
// Les devis et factures (numérotation, verrouillage légal) ne se modifient qu'en ligne.

const CACHE_LECTURES = "cagot-lectures-v1";
const CACHE_ENVOIS = "cagot-envois-v1";
const CLE_FILE = "cagot.file-envois";
const TABLES_HORS_LIGNE = ["notes", "chantiers", "clients"];
const SEAU_PHOTOS = "/storage/v1/object/photos-notes/";
const DELAI_LECTURE = 7000;

const lireFile = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE_FILE) || "[]");
  } catch {
    return [];
  }
};
const ecrireFile = (file) => {
  try {
    localStorage.setItem(CLE_FILE, JSON.stringify(file));
  } catch {
    /* plein : on garde au moins en mémoire */
  }
  window.dispatchEvent(new CustomEvent("cagot-sync", { detail: { attente: file.length } }));
};

const nouvelId = () => crypto.randomUUID?.() ?? "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16));
const json = (corps, status = 200) => new Response(corps === null ? null : JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

function sujetJeton(entetes) {
  try {
    const jeton = (entetes.get("Authorization") || "").replace(/^Bearer /, "");
    return JSON.parse(atob(jeton.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || "anonyme";
  } catch {
    return "anonyme";
  }
}

// Filtres « colonne=eq.valeur » d'une requête PostgREST
function filtres(url) {
  const f = [];
  for (const [k, v] of url.searchParams) if (v.startsWith("eq.")) f.push([k, decodeURIComponent(v.slice(3))]);
  return f;
}
const correspond = (ligne, f) => f.every(([k, v]) => String(ligne?.[k] ?? "") === v);
const tableDe = (url) => url.pathname.match(/\/rest\/v1\/([a-z_]+)$/)?.[1] ?? null;

// Applique les écritures en attente à une lecture (pour voir ses modifications hors réseau).
function superposer(url, donnees, unObjet) {
  const table = tableDe(url);
  const file = lireFile().filter((op) => op.table === table);
  if (!table || !file.length) return donnees;
  const f = filtres(url);
  let lignes = unObjet ? (donnees ? [donnees] : []) : Array.isArray(donnees) ? [...donnees] : [];
  for (const op of file) {
    if (op.methode === "POST" && op.ligne && correspond(op.ligne, f) && !lignes.some((l) => l.id === op.ligne.id)) lignes.unshift(op.ligne);
    if (op.methode === "PATCH") lignes = lignes.map((l) => (correspond(l, op.filtres) ? { ...l, ...op.corps } : l));
    if (op.methode === "DELETE") lignes = lignes.filter((l) => !correspond(l, op.filtres));
  }
  return unObjet ? lignes[0] ?? null : lignes;
}

async function cleCache(url, entetes) {
  return `https://cache.cagot.invalid/${sujetJeton(entetes)}/${encodeURIComponent(url.href)}/${encodeURIComponent(entetes.get("Accept") || "")}`;
}

export function creerHorsLigne() {
  const fetchReseau = window.fetch.bind(window);
  let jetonActuel = null;
  let vidage = null;

  async function lecture(url, init, entetes) {
    const cle = await cleCache(url, entetes);
    const unObjet = (entetes.get("Accept") || "").includes("vnd.pgrst.object");
    const estRest = url.pathname.startsWith("/rest/v1/");
    try {
      const ctrl = new AbortController();
      const minuterie = setTimeout(() => ctrl.abort(), DELAI_LECTURE);
      const rep = await fetchReseau(url.href, { ...init, signal: init.signal ?? ctrl.signal });
      clearTimeout(minuterie);
      if (rep.ok) {
        { const copie = rep.clone(); caches.open(CACHE_LECTURES).then((c) => c.put(cle, copie)).catch((e) => console.warn("[hors-ligne] copie non gardée", e)); }
        if (estRest && lireFile().length) return json(superposer(url, await rep.json(), unObjet));
      }
      return rep;
    } catch (err) {
      if (init.signal?.aborted) throw err;
      // Hors réseau : la photo est peut-être encore en attente d'envoi
      if (url.pathname.startsWith(SEAU_PHOTOS)) {
        const fichier = await fichierEnAttente(url.pathname);
        if (fichier) return new Response(fichier, { status: 200, headers: { "Content-Type": fichier.type || "image/jpeg" } });
      }
      const copie = await caches.open(CACHE_LECTURES).then((c) => c.match(cle)).catch(() => null);
      if (copie) return estRest ? json(superposer(url, await copie.json(), unObjet)) : copie;
      if (estRest && lireFile().some((op) => op.table === tableDe(url))) return json(superposer(url, unObjet ? null : [], unObjet), unObjet ? 200 : 200);
      throw err;
    }
  }

  async function fichierEnAttente(chemin) {
    const op = lireFile().find((o) => o.methode === "POST" && o.chemin === chemin && o.corpsCache);
    if (!op) return null;
    const rep = await caches.open(CACHE_ENVOIS).then((c) => c.match(op.corpsCache)).catch(() => null);
    if (!rep) return null;
    const blob = await rep.blob();
    if (!op.typeCorps?.startsWith("multipart/")) return blob;
    const donnees = await new Response(blob, { headers: { "Content-Type": op.typeCorps } }).formData().catch(() => null);
    const f = donnees && [...donnees.values()].find((v) => v instanceof Blob);
    return f ?? null;
  }

  // Écriture mise de côté : on renvoie à l'appli la même réponse que le serveur aurait donnée.
  async function mettreEnAttente(url, init, entetes) {
    const methode = (init.method || "GET").toUpperCase();
    const table = tableDe(url);
    const op = { id: nouvelId(), url: url.href, methode, table, creee: new Date().toISOString(), entetes: {} };
    for (const [k, v] of entetes) if (!/^(authorization|apikey)$/i.test(k)) op.entetes[k] = v;

    if (table) {
      const corps = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
      op.filtres = filtres(url);
      if (methode === "POST") {
        const maintenant = new Date().toISOString();
        const lignes = (Array.isArray(corps) ? corps : [corps]).map((c) => ({ id: nouvelId(), ...c }));
        op.corpsTexte = JSON.stringify(Array.isArray(corps) ? lignes : lignes[0]);
        const defauts = { notes: { titre: "", contenu: "", photos: [] }, chantiers: { titre: "", historique: [] }, clients: { nom: "", telephone: "", email: "", adresse: "", notes: "" } }[table] ?? {};
        op.ligne = { ...defauts, user_id: sujetJeton(entetes), created_at: maintenant, updated_at: maintenant, ...lignes[0] };
      } else op.corpsTexte = init.body ?? null;
      op.corps = corps;
    } else {
      // Photo : le fichier est rangé tel quel jusqu'à l'envoi
      const req = new Request(url.href, { method: methode, headers: init.headers, body: init.body });
      op.typeCorps = req.headers.get("Content-Type") || "";
      op.corpsCache = `https://envoi.cagot.invalid/${op.id}`;
      op.chemin = url.pathname;
      await (await caches.open(CACHE_ENVOIS)).put(op.corpsCache, new Response(await req.blob()));
    }
    const file = lireFile();
    file.push(op);
    ecrireFile(file);

    const prefer = entetes.get("Prefer") || "";
    const unObjet = (entetes.get("Accept") || "").includes("vnd.pgrst.object");
    if (!table) return json({ Key: url.pathname.replace("/storage/v1/object/", ""), Id: op.id });
    if (!prefer.includes("return=representation")) return new Response(null, { status: methode === "POST" ? 201 : 204 });
    if (methode === "POST") return json(unObjet ? op.ligne : [op.ligne], 201);
    // PATCH / DELETE avec retour : on part de la dernière copie connue
    const lue = await lecture(new URL(url.href), { method: "GET", headers: init.headers }, entetes).then((r) => r.json()).catch(() => (unObjet ? null : []));
    return json(lue, 200);
  }

  async function fetchHorsLigne(entree, init = {}) {
    const url = new URL(typeof entree === "string" ? entree : entree.url, location.href);
    const methode = (init.method || "GET").toUpperCase();
    const entetes = new Headers(init.headers || {});
    if (entetes.get("Authorization")) jetonActuel = entetes.get("Authorization");
    const estDonnee = url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/storage/v1/");
    if (!estDonnee || url.pathname.startsWith("/rest/v1/rpc/")) return fetchReseau(entree, init);
    if (methode === "GET" || methode === "HEAD") return lecture(url, init, entetes);

    const ecrivableHorsLigne = TABLES_HORS_LIGNE.includes(tableDe(url)) || (methode === "POST" && url.pathname.startsWith(SEAU_PHOTOS));
    // Ordre garanti : tant que des envois attendent, les nouvelles écritures passent derrière.
    if (ecrivableHorsLigne && lireFile().length) {
      const rep = await mettreEnAttente(url, init, entetes);
      vider();
      return rep;
    }
    try {
      return await fetchReseau(entree, init);
    } catch (err) {
      if (!ecrivableHorsLigne) throw err;
      return mettreEnAttente(url, init, entetes);
    }
  }

  // Envoie la file au serveur, dans l'ordre. S'arrête au premier souci de réseau.
  function vider() {
    if (vidage) return vidage;
    vidage = (async () => {
      let file = lireFile();
      while (file.length) {
        const op = file[0];
        const entetes = new Headers(op.entetes);
        if (jetonActuel) entetes.set("Authorization", jetonActuel);
        if (window.__cagotCle) entetes.set("apikey", window.__cagotCle);
        let corps = op.corpsTexte ?? null;
        if (op.corpsCache) {
          const rep = await caches.open(CACHE_ENVOIS).then((c) => c.match(op.corpsCache));
          corps = rep ? await rep.blob() : null;
          if (op.typeCorps) entetes.set("Content-Type", op.typeCorps);
        }
        if (op.methode === "POST" && op.table) entetes.set("Prefer", "return=minimal");
        let rep;
        try {
          rep = await fetchReseau(op.url, { method: op.methode, headers: entetes, body: corps });
        } catch {
          break; // toujours pas de réseau
        }
        if (rep.status === 401) break; // session à rafraîchir : on réessaiera
        const texte = rep.ok ? "" : await rep.text().catch(() => "");
        const dejaFait = rep.status === 409 || /duplicate|already exists/i.test(texte);
        if (!rep.ok && !dejaFait && rep.status >= 500) break;
        if (!rep.ok && !dejaFait) console.warn("[hors-ligne] envoi abandonné", op.methode, op.url, rep.status, texte);
        if (op.corpsCache) caches.open(CACHE_ENVOIS).then((c) => c.delete(op.corpsCache)).catch(() => {});
        file = lireFile().filter((o) => o.id !== op.id);
        ecrireFile(file);
      }
      return lireFile().length;
    })().finally(() => {
      vidage = null;
    });
    return vidage;
  }

  window.addEventListener("online", () => setTimeout(vider, 1500));
  setInterval(() => lireFile().length && navigator.onLine && vider(), 30000);

  return {
    fetch: fetchHorsLigne,
    vider,
    enAttente: () => lireFile().length,
    async oublier() {
      // Déconnexion : on efface les copies et la file de ce téléphone
      ecrireFile([]);
      await Promise.all([caches.delete(CACHE_LECTURES), caches.delete(CACHE_ENVOIS)]).catch(() => {});
    },
  };
}
