// Plateforme « en ligne » : comptes et données dans Supabase, IA via notre API.
// Les adresses viennent de config.json : changer d'hébergeur = changer ce fichier.
// La version d'essai sur claude.ai remplace ce fichier par scripts/essai/plateforme-essai.js.

const nomFichier = (titre) => String(titre || "document").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function demarrerPlateforme() {
  const config = await fetch("config.json", { cache: "no-store" }).then((r) => r.json());
  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  const espacePhotos = () => sb.storage.from("photos-notes");
  return {
    demo: !!config.demo,
    essai: false,
    sb,
    partageTelephone: true, // « Partager → Cagot » depuis les autres applis (service worker)

    // Photos des notes, rangées dans un espace privé (<user_id>/<note_id>/<fichier>).
    stockagePhotos: {
      async televerser(chemin, blob) {
        const { error } = await espacePhotos().upload(chemin, blob, { contentType: blob.type || "image/jpeg", upsert: false });
        if (error) throw error;
      },
      async telecharger(chemin) {
        const { data, error } = await espacePhotos().download(chemin);
        if (error) throw error;
        return data;
      },
      async supprimer(chemins) {
        if (!chemins.length) return;
        const { error } = await espacePhotos().remove(chemins);
        if (error) throw error;
      },
    },
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

    // Bibliothèques PDF servies par le site lui-même (chargées seulement quand on en a besoin).
    scriptsPdf: ["/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js"],
    libelleExport: "Télécharger le PDF",

    async exporterPdf({ titre, pdf }) {
      telecharger(pdf, `${nomFichier(titre)}.pdf`);
    },

    // Partage natif du téléphone (Gmail, WhatsApp, SMS…) avec le PDF en pièce jointe.
    // Renvoie true si le partage a eu lieu.
    // Le partage du téléphone ne permet pas de remplir le destinataire : les adresses sont
    // copiées pour être collées dans « À ». Sans partage de fichier, l'e-mail s'ouvre déjà adressé.
    async partager({ sujet, texte, pdf, titre, destinataires = [], notifier }) {
      const fichier = pdf ? new File([pdf], `${nomFichier(titre)}.pdf`, { type: "application/pdf" }) : null;
      if (fichier && navigator.canShare?.({ files: [fichier] })) {
        if (destinataires.length) {
          try {
            await navigator.clipboard.writeText(destinataires.join(", "));
            notifier?.("Adresse copiée : colle-la dans « À » de ton e-mail.");
          } catch {
            // presse-papiers refusé : on partage quand même
          }
        }
        try {
          await navigator.share({ files: [fichier], title: sujet, text: texte });
          return true;
        } catch (err) {
          if (err.name === "AbortError") return false;
        }
      } else if (navigator.share && !fichier) {
        try {
          await navigator.share({ title: sujet, text: texte });
          return true;
        } catch (err) {
          if (err.name === "AbortError") return false;
        }
      }
      // Pas de partage de fichier possible (ordinateur…) : on télécharge le PDF puis on ouvre l'e-mail.
      if (fichier) {
        telecharger(fichier, fichier.name);
        notifier?.("PDF téléchargé : joins-le à l'e-mail qui s'ouvre.");
      }
      location.href = `mailto:${destinataires.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(texte)}`;
      return false;
    },
  };
}
