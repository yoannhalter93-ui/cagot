// Plateforme « essai » : l'appli tourne comme une page claude.ai.
// - l'IA passe par le compte Claude de la personne (capacité `sample`, pas de clé API) ;
// - les données vont dans la base de la page, sous data/users/<id>/ : privées, même pour le propriétaire ;
// - `sb` imite le sous-ensemble du client Supabase utilisé par app.js.
import { calculerTotaux } from "../../src/calcul.js";
import { CONSIGNES, FORMAT_JSON, promptArtisan } from "../../src/prompt.js";

function dataUrlVersBlob(dataUrl) {
  const [entete, base64] = dataUrl.split(",");
  const type = entete.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type });
}

const nouvelId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function creerBaseEssai(db, uid) {
  const racine = `data/users/${uid}`;
  const collection = (table) => db.collection(`${racine}/${table}`);
  const maintenant = () => new Date().toISOString();

  async function prochainNumero(type) {
    const annee = new Date().getFullYear();
    const ref = db.doc(`${racine}/compteurs/${type}-${annee}`);
    const snap = await ref.get();
    const valeur = (snap.exists ? snap.data().valeur : 0) + 1;
    await ref.set({ valeur });
    return `${type === "devis" ? "DEV" : "FAC"}-${annee}-${String(valeur).padStart(3, "0")}`;
  }

  // Mêmes règles que les déclencheurs SQL de la version en ligne.
  function verifierModification(ancien, nouveau) {
    if (ancien.type !== "facture" || ancien.statut === "brouillon") return;
    const contenuChange = JSON.stringify(nouveau.contenu) !== JSON.stringify(ancien.contenu);
    if (contenuChange || !["emise", "payee"].includes(nouveau.statut)) {
      throw new Error("une facture émise ne peut plus être modifiée");
    }
  }

  class Requete {
    constructor(table) {
      Object.assign(this, { table, op: "select", filtres: [], tris: [], max: null, mode: "liste", retour: false });
    }
    select() {
      if (this.op !== "select") this.retour = true;
      return this;
    }
    order(champ, { ascending = true } = {}) {
      this.tris.push([champ, ascending]);
      return this;
    }
    limit(n) {
      this.max = n;
      return this;
    }
    eq(champ, valeur) {
      this.filtres.push([champ, valeur]);
      return this;
    }
    insert(corps) {
      return Object.assign(this, { op: "insert", corps });
    }
    upsert(corps) {
      return Object.assign(this, { op: "upsert", corps });
    }
    update(corps) {
      return Object.assign(this, { op: "update", corps });
    }
    delete() {
      return Object.assign(this, { op: "delete" });
    }
    single() {
      return Object.assign(this, { mode: "single" });
    }
    maybeSingle() {
      return Object.assign(this, { mode: "maybe" });
    }
    then(ok, ko) {
      return this.executer().then(ok, ko);
    }
    async executer() {
      try {
        return { data: await this.lancer(), error: null };
      } catch (e) {
        return { data: null, error: { message: e?.message ?? String(e) } };
      }
    }
    async lignes() {
      const snap = await collection(this.table).get();
      let lignes = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      lignes = lignes.filter((l) => this.filtres.every(([k, v]) => l[k] === v));
      for (const [champ, asc] of [...this.tris].reverse()) {
        lignes.sort((a, b) => String(a[champ] ?? "").localeCompare(String(b[champ] ?? ""), "fr") * (asc ? 1 : -1));
      }
      return this.max ? lignes.slice(0, this.max) : lignes;
    }
    formater(lignes) {
      if (this.mode === "liste") return lignes;
      if (lignes.length === 1) return lignes[0];
      if (this.mode === "maybe" && lignes.length === 0) return null;
      throw new Error("document introuvable");
    }
    async enregistrer(ligne) {
      const { id, ...corps } = ligne;
      await collection(this.table).doc(id).set(corps);
    }
    async lancer() {
      if (this.op === "select") return this.formater(await this.lignes());

      if (this.op === "insert" || this.op === "upsert") {
        const id = this.table === "entreprises" ? "profil" : nouvelId();
        let ligne = { created_at: maintenant(), ...this.corps, id };
        if (this.op === "upsert") {
          const existant = await collection(this.table).doc(id).get();
          if (existant.exists) ligne = { ...existant.data(), ...ligne };
        }
        if (this.table === "documents") {
          ligne = { statut: "brouillon", date_document: maintenant(), conversation: [], ...ligne, updated_at: maintenant() };
          if (ligne.type === "devis") ligne.numero = await prochainNumero("devis");
          if (ligne.type === "facture") Object.assign(ligne, { numero: null, statut: "brouillon" });
        }
        await this.enregistrer(ligne);
        return this.retour ? this.formater([ligne]) : null;
      }

      const lignes = await this.lignes();
      if (this.op === "update") {
        const resultats = [];
        for (const ancien of lignes) {
          const nouveau = { ...ancien, ...this.corps, id: ancien.id, updated_at: maintenant() };
          if (this.table === "documents") verifierModification(ancien, nouveau);
          await this.enregistrer(nouveau);
          resultats.push(nouveau);
        }
        return this.retour ? this.formater(resultats) : null;
      }

      if (this.op === "delete") {
        for (const l of lignes) {
          if (l.type === "facture" && l.statut !== "brouillon") throw new Error("une facture émise ne peut pas être supprimée");
          await collection(this.table).doc(l.id).delete();
        }
        return null;
      }
      throw new Error(`opération inconnue ${this.op}`);
    }
  }

  const session = { access_token: null, user: { id: uid, email: "ton compte Claude" } };
  return {
    from: (table) => new Requete(table),
    async rpc(nom, { p_id }) {
      if (nom !== "emettre_facture") return { data: null, error: { message: "fonction inconnue" } };
      try {
        const ref = collection("documents").doc(p_id);
        const snap = await ref.get();
        if (!snap.exists || snap.data().type !== "facture") throw new Error("facture introuvable");
        if (snap.data().statut !== "brouillon") throw new Error("facture déjà émise");
        const ligne = { ...snap.data(), numero: await prochainNumero("facture"), statut: "emise", date_document: maintenant(), updated_at: maintenant() };
        await ref.set(ligne);
        return { data: { ...ligne, id: p_id }, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    auth: {
      onAuthStateChange(rappel) {
        setTimeout(() => rappel("INITIAL_SESSION", session), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
  };
}

function baseIndisponible(message) {
  const echec = { data: null, error: { message } };
  const requete = new Proxy({}, { get: (_c, prop) => (prop === "then" ? (ok) => ok(echec) : () => requete) });
  const session = { access_token: null, user: { id: "absent", email: "" } };
  return {
    from: () => requete,
    rpc: async () => echec,
    auth: {
      onAuthStateChange(rappel) {
        setTimeout(() => rappel("INITIAL_SESSION", session), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session } }),
      signOut: async () => ({ error: null }),
    },
  };
}

function lireReponseIA(sortie) {
  if (!sortie || !["questions", "devis"].includes(sortie.statut) || typeof sortie.message !== "string") {
    throw new Error("Réponse de l'IA incomplète, réessaie.");
  }
  const propre = {
    statut: sortie.statut,
    message: sortie.message,
    questions: Array.isArray(sortie.questions) ? sortie.questions.map(String) : [],
    devis: null,
  };
  if (sortie.statut === "devis") {
    const d = sortie.devis;
    if (!d || !Array.isArray(d.sections)) throw new Error("Réponse de l'IA incomplète, réessaie.");
    propre.devis = {
      titre: String(d.titre ?? "Devis"),
      client_nom: String(d.client_nom ?? ""),
      client_adresse: String(d.client_adresse ?? ""),
      adresse_chantier: String(d.adresse_chantier ?? ""),
      description: String(d.description ?? ""),
      sections: d.sections.map((s) => ({
        titre: String(s.titre ?? ""),
        lignes: (s.lignes ?? []).map((l) => ({
          designation: String(l.designation ?? ""),
          detail: String(l.detail ?? ""),
          quantite: Number(l.quantite) || 0,
          unite: String(l.unite ?? "u"),
          prix_unitaire_ht: Number(l.prix_unitaire_ht) || 0,
          prix_source: l.prix_source === "grille" ? "grille" : "estime",
          calcul: String(l.calcul ?? ""),
        })),
      })),
      taux_tva: Number(d.taux_tva ?? 10),
      duree_estimee: String(d.duree_estimee ?? ""),
      hypotheses: Array.isArray(d.hypotheses) ? d.hypotheses.map(String) : [],
    };
  }
  return propre;
}

export async function demarrerPlateforme() {
  const [db, utilisateur, sample, telechargements] = await Promise.all(
    ["db", "user", "sample", "downloads"].map((nom) => window.claude?.use(nom) ?? Promise.resolve(null)),
  );
  const uid = utilisateur ? await utilisateur.id() : null;
  const limites = sample ? await sample.limits().catch(() => null) : null;

  const sb = db && uid ? creerBaseEssai(db, uid) : baseIndisponible("Ouvre cette page depuis claude.ai, connecté à ton compte.");

  return {
    demo: false,
    essai: true,
    sb,
    dictee: false, // micro refusé dans les pages claude.ai : on utilise le micro du clavier
    photos: !!limites?.images,

    async appelerIA({ historique, entreprise, tarifs }) {
      if (!sample) throw new Error("L'IA n'est pas disponible sur cette page.");
      const cadre = `${CONSIGNES}\n\n${promptArtisan({ entreprise, tarifs })}\n\n${FORMAT_JSON}\n\n---\nNotes de l'artisan :\n`;
      const tours = historique.map((m, i) => ({
        role: m.role,
        content: m.role === "assistant" ? m.brut ?? m.texte : `${i === 0 ? cadre : ""}${m.texte || "Voici mes notes de chantier (photo)."}`,
      }));
      const dernier = historique.at(-1);
      const images = limites?.images && dernier.images?.length ? dernier.images.map(dataUrlVersBlob) : undefined;
      let sortie;
      try {
        sortie = await sample.json(tours, { images, modelTier: "complex", cache: false });
      } catch (err) {
        if (err?.code === "rate_limited") throw new Error("Trop de demandes, attends un peu avant de réessayer.");
        if (err?.code === "not_granted") throw new Error("Autorise la page à utiliser Claude pour rédiger les devis.");
        throw new Error("Réponse de l'IA incomplète, réessaie.");
      }
      const propre = lireReponseIA(sortie);
      return { ...propre, devis: propre.devis ? calculerTotaux(propre.devis) : null, brut: JSON.stringify(propre) };
    },

    // Pas d'impression dans une page claude.ai : on télécharge le document, à ouvrir puis
    // « Imprimer → Enregistrer en PDF » depuis le navigateur du téléphone.
    libelleExport: "Télécharger",
    async exporterPdf({ titre, document: element }) {
      if (!telechargements) throw new Error("Téléchargement indisponible");
      const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titre.replace(/[<&]/g, "")}</title><style>${css}</style></head><body><main class="vue">${element.outerHTML}</main></body></html>`;
      await telechargements.save({ filename: `${titre.replace(/[^\w-]+/g, "_") || "document"}.html`, data: html });
    },

    async partager({ texte, notifier }) {
      try {
        await navigator.clipboard.writeText(texte);
        notifier("Message copié : colle-le dans ton e-mail ou SMS avec le document téléchargé.");
        return true;
      } catch {
        notifier("Copie impossible sur cet appareil.", "erreur");
        return false;
      }
    },
  };
}
