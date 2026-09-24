// Plateforme « serveur » : comptes et données dans Supabase, IA via notre API.
// La version d'essai sur claude.ai remplace ce fichier par scripts/essai/plateforme-essai.js.

export async function demarrerPlateforme() {
  const config = await fetch("/api/config").then((r) => r.json());
  return {
    demo: config.demo,
    essai: false,
    sb: window.supabase.createClient(config.supabaseUrl, config.supabaseKey),
    dictee: !!(window.SpeechRecognition || window.webkitSpeechRecognition),

    async appelerIA(requete, jeton) {
      const rep = await fetch("/api/discuter", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
        body: JSON.stringify(requete),
      });
      const data = await rep.json().catch(() => ({}));
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
