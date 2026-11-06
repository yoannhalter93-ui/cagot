// Fabrication du PDF d'un devis / d'une facture (format A4), avec jsPDF + jspdf-autotable
// chargés à la demande (window.jspdf). Les montants et mentions viennent de l'appli.

const BLEU_DEFAUT = [31, 78, 121];
const GRIS = [107, 118, 132];
const TEXTE = [28, 36, 48];

// Les polices standard des PDF ne connaissent pas les espaces fines insécables
// utilisées par toLocaleString("fr-FR") : on les remplace par des espaces simples.
const propre = (t) => String(t ?? "").replace(/[  ]/g, " ");

// Couleur de l'artisan (#rrggbb) et sa version très claire pour les fonds.
function couleurs(hex) {
  const base = /^#[0-9a-f]{6}$/i.test(hex || "") ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : BLEU_DEFAUT;
  return [base, base.map((c) => Math.round(c + (255 - c) * 0.88))];
}

export function genererPdf({ d, entreprise: e, elements, euros, nombre, dateFr }) {
  const { jsPDF } = window.jspdf;
  const [BLEU, BLEU_CLAIR] = couleurs(e.couleur);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const v = d.contenu;
  const L = 210;
  const M = 15;
  const facture = d.type === "facture";
  pdf.setProperties({ title: propre(`${elements.titre} – ${v.titre}`), creator: "Cagot" });

  // --- En-tête : entreprise (gauche) et client (droite)
  let y = 18;
  let yNom = y;
  const logo = /^data:image\/(png|jpeg);base64,/.exec(e.logo || "");
  if (logo) {
    try {
      const { width, height } = pdf.getImageProperties(e.logo);
      const echelle = Math.min(55 / width, 22 / height);
      const h = height * echelle;
      pdf.addImage(e.logo, logo[1] === "png" ? "PNG" : "JPEG", M, 10, width * echelle, h);
      yNom = 10 + h + 6;
    } catch {
      // logo illisible : on continue sans
    }
  }
  pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(...BLEU);
  pdf.text(propre(e.nom || "Mon entreprise"), M, yNom);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(...TEXTE);
  const lignesEntreprise = [
    ...String(e.adresse || "").split("\n"),
    e.telephone ? `Tél. ${e.telephone}` : "",
    e.email || "",
    e.siret ? `SIRET ${e.siret}` : "",
    e.tva_intra && !elements.franchise ? `TVA ${e.tva_intra}` : "",
  ].filter((l) => l.trim());
  let yE = yNom + 5;
  for (const l of lignesEntreprise) {
    pdf.text(propre(l), M, yE);
    yE += 4.2;
  }

  const xC = 115;
  const largeurC = L - M - xC;
  const lignesClient = [
    ...pdf.splitTextToSize(propre(v.client_nom || ""), largeurC - 6),
    ...pdf.splitTextToSize(propre(v.client_adresse || ""), largeurC - 6),
    ...(v.client_telephone ? [propre(`Tél. ${v.client_telephone}`)] : []),
    ...(v.client_email ? pdf.splitTextToSize(propre(v.client_email), largeurC - 6) : []),
    ...(v.adresse_chantier ? pdf.splitTextToSize(propre(`Chantier : ${v.adresse_chantier}`), largeurC - 6) : []),
  ];
  const hauteurC = 9 + Math.max(lignesClient.length, 2) * 4.4;
  pdf.setDrawColor(215, 221, 228).roundedRect(xC, y - 5, largeurC, hauteurC, 2, 2);
  pdf.setFont("helvetica", "bold").setFontSize(9).text("Client", xC + 3, y);
  pdf.setFont("helvetica", "normal");
  lignesClient.forEach((l, i) => pdf.text(l, xC + 3, y + 5 + i * 4.4));

  // --- Titre, date, objet, description
  y = Math.max(yE, y - 5 + hauteurC) + 9;
  pdf.setFont("helvetica", "bold").setFontSize(16).setTextColor(...BLEU);
  pdf.text(propre(elements.titre), M, y);
  y += 6;
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(...GRIS);
  const meta = pdf.splitTextToSize(propre(`Date : ${dateFr(d.date_document)}  ·  Objet : ${v.titre}`), L - 2 * M);
  pdf.text(meta, M, y);
  y += meta.length * 4.2 + 2;
  if (v.description) {
    pdf.setTextColor(...TEXTE);
    const desc = pdf.splitTextToSize(propre(v.description), L - 2 * M);
    pdf.text(desc, M, y);
    y += desc.length * 4.2 + 2;
  }

  // --- Tableau des lignes, par section
  const corps = [];
  for (const s of v.sections ?? []) {
    corps.push([{ content: propre(s.titre), colSpan: 5, styles: { fillColor: BLEU_CLAIR, fontStyle: "bold" } }]);
    for (const l of s.lignes ?? []) {
      const option = l.option ? (l.option_retenue ? "[Option retenue] " : "[Option non retenue] ") : "";
      corps.push([
        propre(`${option}${l.detail ? `${l.designation}\n${l.detail}` : l.designation}`),
        { content: propre(nombre(l.quantite)), styles: { halign: "right" } },
        propre(l.unite),
        { content: propre(euros(l.prix_unitaire_ht)), styles: { halign: "right" } },
        { content: propre(euros(l.total_ht)), styles: { halign: "right" } },
      ]);
    }
  }
  pdf.autoTable({
    startY: y + 1,
    margin: { left: M, right: M, bottom: 18 },
    head: [["Désignation", "Qté", "Unité", "P.U. HT", "Total HT"]],
    body: corps,
    theme: "grid",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 8.5, textColor: TEXTE, lineColor: [215, 221, 228], lineWidth: 0.2, cellPadding: 1.8, valign: "top" },
    headStyles: { fillColor: BLEU, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 16 }, 2: { cellWidth: 16 }, 3: { cellWidth: 24 }, 4: { cellWidth: 27 } },
  });
  y = pdf.lastAutoTable.finalY + 4;

  // --- Totaux
  const totaux = [["Total HT", euros(v.total_ht)]];
  if (!elements.franchise) totaux.push([`TVA ${nombre(elements.tauxTva)} %`, euros(elements.tva)]);
  totaux.push([elements.franchise ? "Net à payer" : "Total TTC", euros(elements.ttc)]);
  pdf.autoTable({
    startY: y,
    margin: { left: L - M - 75, right: M, bottom: 18 },
    body: totaux.map(([a, b]) => [propre(a), { content: propre(b), styles: { halign: "right" } }]),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9.5, textColor: TEXTE, cellPadding: 1.4 },
    didParseCell: (c) => {
      if (c.row.index === totaux.length - 1) Object.assign(c.cell.styles, { fontStyle: "bold", fontSize: 11.5, fillColor: BLEU_CLAIR });
    },
  });
  y = pdf.lastAutoTable.finalY + 6;

  // --- Mentions légales
  const hauteurPage = pdf.internal.pageSize.getHeight();
  pdf.setFont("helvetica", "normal").setFontSize(7.8).setTextColor(...GRIS);
  for (const m of elements.mentions) {
    const lignes = pdf.splitTextToSize(propre(m), L - 2 * M);
    if (y + lignes.length * 3.6 > hauteurPage - 18) {
      pdf.addPage();
      y = 18;
    }
    pdf.text(lignes, M, y);
    y += lignes.length * 3.6 + 1.5;
  }

  // --- Signatures (devis)
  if (!facture) {
    if (y + 34 > hauteurPage - 18) {
      pdf.addPage();
      y = 18;
    }
    y += 3;
    const larg = (L - 2 * M - 8) / 2;
    pdf.setDrawColor(215, 221, 228).setTextColor(...TEXTE).setFontSize(9);
    pdf.roundedRect(M, y, larg, 30, 2, 2);
    pdf.roundedRect(M + larg + 8, y, larg, 30, 2, 2);
    pdf.text("L'entreprise", M + 3, y + 5);
    pdf.text("Le client", M + larg + 11, y + 5);
    const sig = elements.signature;
    if (sig?.image) {
      pdf.setFontSize(7.5).setTextColor(...GRIS).text(propre(`Bon pour accord – signé en ligne par ${sig.nom} le ${sig.date}`), M + larg + 11, y + 9.5, { maxWidth: larg - 6 });
      try {
        pdf.addImage(sig.image, "PNG", M + larg + 11, y + 12, Math.min(larg - 6, 50), 16);
      } catch {
        /* image de signature illisible */
      }
    } else pdf.setFontSize(7.5).setTextColor(...GRIS).text(propre("Date, signature et mention « Bon pour accord »"), M + larg + 11, y + 9.5);
  }

  // --- Pied de page
  const nb = pdf.getNumberOfPages();
  for (let i = 1; i <= nb; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7.5).setTextColor(...GRIS);
    pdf.text(propre(`${e.nom || ""}${e.siret ? ` – SIRET ${e.siret}` : ""}`), M, hauteurPage - 8);
    pdf.text(`${propre(d.numero || "brouillon")} – page ${i}/${nb}`, L - M, hauteurPage - 8, { align: "right" });
  }
  return pdf.output("blob");
}
