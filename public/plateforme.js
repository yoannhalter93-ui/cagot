// Plateforme « en ligne » : comptes et données dans Supabase, IA via notre API.
// Les adresses viennent de config.json : changer d'hébergeur = changer ce fichier.
// La version d'essai sur claude.ai remplace ce fichier par scripts/essai/plateforme-essai.js.

export async function demarrerPlateforme() {
  const config = await fetch("config.json", { cache: "no-store" }).then((r) => r.json());
  return {
    demo: !!config.demo,
    essai: false,
    sb: window.supabase.createClient(config.supabaseUrl, config.supabaseKey),
    dictee: !!(window.SpeechRecognition || window.webkitSpeechRecognition),

    async appelerIA(requete, jeton) {
      let rep;
      try {
        rep = await fetch(config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}`, apikey: config.supabaseKey },
          body: JSON.stringify(requete),
        });
      } catch {
        throw new Error("Pas de connexion internet (ou service indisponible). Réessaie.");
      }
      const data = await rep.json().catch(() => ({}));
      if (rep.status === 504 || rep.status === 546) {
        throw new Error("Le devis est trop long à rédiger d'un coup : découpe le chantier (par pièce ou par lot) et réessaie.");
      }
      if (!rep.ok) throw new Error(data.erreur || "Erreur serveur");
      return data;
    },

    // Le navigateur du téléphone propose « Enregistrer en PDF » dans la fenêtre d'impression.
    async exporterPdf({ titre }) {
      const avant = document.title;
      document.title = titre;
      window.print();
      document.title = avant;
    },
    libelleExport: "PDF / Imprimer",

    // true si le partage natif du téléphone a été utilisé.
    async partager({ sujet, texte }) {
      if (navigator.share) {
        try {
          await navigator.share({ title: sujet, text: texte });
          return true;
        } catch (err) {
          if (err.name === "AbortError") return false;
        }
      }
      location.href = `mailto:?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(`${texte}\n\n(Pense à joindre le PDF via « PDF / Imprimer ».)`)}`;
      return false;
    },
  };
}
