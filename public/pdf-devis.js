// Fabrication du PDF d'un devis / d'une facture (format A4), avec jsPDF + jspdf-autotable
// chargés à la demande (window.jspdf). Les montants et mentions viennent de l'appli.

import { autoliquidation, estParticulier, formulaireRetractation, horsEtablissement, ventilationTva } from "/mentions-legales.js";
import { tauxLigne } from "/calcul.js";
import { labelsDe, modeleDe, piedDePage, textesDocument } from "/personnalisation.js";

// Polices intégrées au PDF (Liberation Sans, licence SIL OFL) : indispensables pour la facture
// électronique PDF/A-3, et elles affichent correctement €, accents et espaces fines.
let polices = null;
const enBase64 = (buf) => {
  const o = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
  return btoa(s);
};
export async function preparerPolices() {
  if (polices) return polices;
  try {
    const [r, g] = await Promise.all(["/polices/LiberationSans-Regular.ttf", "/polices/LiberationSans-Bold.ttf"].map((u) => fetch(u).then((x) => (x.ok ? x.arrayBuffer() : Promise.reject()))));
    polices = { normal: enBase64(r), bold: enBase64(g) };
  } catch {
    polices = null; // hors ligne : polices standard du PDF
  }
  return polices;
}

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
  let POLICE = "helvetica";
  if (polices) {
    pdf.addFileToVFS("LiberationSans-Regular.ttf", polices.normal);
    pdf.addFileToVFS("LiberationSans-Bold.ttf", polices.bold);
    pdf.addFont("LiberationSans-Regular.ttf", "Liberation", "normal");
    pdf.addFont("LiberationSans-Bold.ttf", "Liberation", "bold");
    POLICE = "Liberation";
    pdf.setFont(POLICE, "normal");
  }
  const v = d.contenu;
  const L = 210;
  const M = 15;
  const facture = d.type === "facture";
  const modele = modeleDe(e);
  const { intro, fin } = textesDocument(e, d.type);
  const pied = pdf.splitTextToSize(propre(piedDePage(e)), L - 2 * M).slice(0, 3);
  const basPage = 18 + pied.length * 3.2; // place réservée en bas de chaque page
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
  pdf.setFont(POLICE, "bold").setFontSize(15).setTextColor(...BLEU);
  pdf.text(propre(e.nom || "Mon entreprise"), M, yNom);
  pdf.setFont(POLICE, "normal").setFontSize(9).setTextColor(...TEXTE);
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
    ...(!estParticulier(v) && v.client_siren ? [propre(`SIREN ${v.client_siren}`)] : []),
    ...(v.adresse_chantier ? pdf.splitTextToSize(propre(`Chantier : ${v.adresse_chantier}`), largeurC - 6) : []),
  ];
  const hauteurC = 9 + Math.max(lignesClient.length, 2) * 4.4;
  pdf.setDrawColor(215, 221, 228).roundedRect(xC, y - 5, largeurC, hauteurC, 2, 2);
  pdf.setFont(POLICE, "bold").setFontSize(9).text("Client", xC + 3, y);
  pdf.setFont(POLICE, "normal");
  lignesClient.forEach((l, i) => pdf.text(l, xC + 3, y + 5 + i * 4.4));

  // --- Titre, date, objet, description
  y = Math.max(yE, y - 5 + hauteurC) + 9;
  if (modele === "moderne") {
    pdf.setFillColor(...BLEU).roundedRect(M, y - 6.5, L - 2 * M, 10, 1.5, 1.5, "F");
    pdf.setFont(POLICE, "bold").setFontSize(14).setTextColor(255, 255, 255);
    pdf.text(propre(elements.titre), M + 4, y + 0.6);
    y += 9;
  } else {
    pdf.setFont(POLICE, "bold").setFontSize(16).setTextColor(...(modele === "epure" ? TEXTE : BLEU));
    pdf.text(propre(elements.titre), M, y);
    if (modele === "epure") pdf.setDrawColor(...BLEU).setLineWidth(0.6).line(M, y + 2, M + 30, y + 2).setLineWidth(0.2);
    y += modele === "epure" ? 7 : 6;
  }
  pdf.setFont(POLICE, "normal").setFontSize(9).setTextColor(...GRIS);
  const meta = pdf.splitTextToSize(propre(`Date : ${dateFr(d.date_document)}  ·  Objet : ${v.titre}`), L - 2 * M);
  pdf.text(meta, M, y);
  y += meta.length * 4.2 + 2;
  if (v.description) {
    pdf.setTextColor(...TEXTE);
    const desc = pdf.splitTextToSize(propre(v.description), L - 2 * M);
    pdf.text(desc, M, y);
    y += desc.length * 4.2 + 2;
  }
  if (intro) {
    pdf.setTextColor(...TEXTE);
    const t = pdf.splitTextToSize(propre(intro), L - 2 * M);
    pdf.text(t, M, y + 1);
    y += t.length * 4.2 + 3;
  }

  // --- Tableau des lignes, par section
  const corps = [];
  for (const s of v.sections ?? []) {
    corps.push([{ content: propre(s.titre), colSpan: 5, styles: modele === "epure" ? { fontStyle: "bold", textColor: BLEU } : { fillColor: BLEU_CLAIR, fontStyle: "bold" } }]);
    for (const l of s.lignes ?? []) {
      const option = l.option ? (l.option_retenue ? "[Option incluse] " : "[Option non incluse] ") : "";
      const tvaParticuliere = !elements.franchise && !autoliquidation(v) && tauxLigne(l, v) !== Number(v.taux_tva) ? ` (TVA ${nombre(tauxLigne(l, v))} %)` : "";
      corps.push([
        propre(`${option}${l.designation}${tvaParticuliere}${l.detail ? `\n${l.detail}` : ""}`),
        { content: propre(nombre(l.quantite)), styles: { halign: "right" } },
        propre(l.unite),
        { content: propre(euros(l.prix_unitaire_ht)), styles: { halign: "right" } },
        { content: propre(euros(l.total_ht)), styles: { halign: "right" } },
      ]);
    }
  }
  pdf.autoTable({
    startY: y + 1,
    margin: { left: M, right: M, bottom: basPage },
    head: [["Désignation", "Qté", "Unité", "P.U. HT", "Total HT"]],
    body: corps,
    theme: modele === "epure" ? "plain" : "grid",
    rowPageBreak: "avoid",
    styles: { font: POLICE, fontSize: 8.5, textColor: TEXTE, lineColor: [215, 221, 228], lineWidth: modele === "epure" ? { bottom: 0.2 } : 0.2, cellPadding: 1.8, valign: "top" },
    headStyles: modele === "epure" ? { textColor: BLEU, fontStyle: "bold", lineColor: BLEU, lineWidth: { bottom: 0.5 } } : { fillColor: BLEU, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 16 }, 2: { cellWidth: 16 }, 3: { cellWidth: 24 }, 4: { cellWidth: 27 } },
  });
  y = pdf.lastAutoTable.finalY + 4;

  // --- Totaux
  const totaux = [["Total HT", euros(v.total_ht)]];
  if (autoliquidation(v)) totaux.push(["TVA autoliquidée", euros(0)]);
  else if (!elements.franchise) {
    const vent = ventilationTva(v);
    if (vent.length > 1) for (const t of vent) totaux.push([`TVA ${nombre(t.taux)} % (base ${euros(t.base_ht)})`, euros(t.montant_tva)]);
    else totaux.push([`TVA ${nombre(elements.tauxTva)} %`, euros(elements.tva)]);
  }
  totaux.push([elements.franchise ? "Net à payer" : "Total TTC", euros(elements.ttc)]);
  pdf.autoTable({
    startY: y,
    margin: { left: L - M - 75, right: M, bottom: basPage },
    body: totaux.map(([a, b]) => [propre(a), { content: propre(b), styles: { halign: "right" } }]),
    theme: "plain",
    styles: { font: POLICE, fontSize: 9.5, textColor: TEXTE, cellPadding: 1.4 },
    didParseCell: (c) => {
      if (c.row.index !== totaux.length - 1) return;
      Object.assign(c.cell.styles, { fontStyle: "bold", fontSize: 11.5 }, modele === "moderne" ? { fillColor: BLEU, textColor: 255 } : modele === "epure" ? { textColor: BLEU, lineColor: BLEU, lineWidth: { top: 0.5 } } : { fillColor: BLEU_CLAIR });
    },
  });
  y = pdf.lastAutoTable.finalY + 6;

  const hauteurPage = pdf.internal.pageSize.getHeight();
  // --- Texte de fin (remerciements…)
  if (fin) {
    pdf.setFont(POLICE, "normal").setFontSize(9).setTextColor(...TEXTE);
    const t = pdf.splitTextToSize(propre(fin), L - 2 * M);
    if (y + t.length * 4.2 > hauteurPage - basPage) {
      pdf.addPage();
      y = 18;
    }
    pdf.text(t, M, y);
    y += t.length * 4.2 + 3;
  }

  // --- Mentions légales
  pdf.setFont(POLICE, "normal").setFontSize(7.8).setTextColor(...GRIS);
  for (const m of elements.mentions) {
    const lignes = pdf.splitTextToSize(propre(m), L - 2 * M);
    if (y + lignes.length * 3.6 > hauteurPage - basPage) {
      pdf.addPage();
      y = 18;
    }
    pdf.text(lignes, M, y);
    y += lignes.length * 3.6 + 1.5;
  }

  // --- Signatures (devis)
  if (!facture) {
    if (y + 34 > hauteurPage - basPage) {
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
    y += 34;
  }

  // --- Labels et certifications (RGE, Qualibat…)
  const labels = labelsDe(e);
  if (labels.length) {
    const h = 14;
    if (y + h + 4 > hauteurPage - basPage) {
      pdf.addPage();
      y = 18;
    }
    let x = M;
    for (const l of labels) {
      try {
        const { width, height } = pdf.getImageProperties(l);
        const w = Math.min(36, (width / height) * h);
        if (x + w > L - M) break;
        pdf.addImage(l, l.startsWith("data:image/png") ? "PNG" : "JPEG", x, y + 2, w, (height / width) * w > h ? h : (height / width) * w);
        x += w + 5;
      } catch {
        /* label illisible : ignoré */
      }
    }
  }

  // --- Formulaire de rétractation (devis signé chez un particulier)
  if (!facture && horsEtablissement(v)) {
    const f = formulaireRetractation(e, d);
    pdf.addPage();
    y = 22;
    pdf.setDrawColor(...GRIS).setLineDashPattern([2, 1.5], 0).line(M, 14, L - M, 14).setLineDashPattern([], 0);
    pdf.setFontSize(7).setTextColor(...GRIS).text(propre("À découper ou à recopier"), M, 12);
    pdf.setFont(POLICE, "bold").setFontSize(14).setTextColor(...TEXTE).text(propre(f.titre), M, y);
    y += 9;
    pdf.setFont(POLICE, "normal").setFontSize(10);
    for (const l of f.lignes) {
      const t = pdf.splitTextToSize(propre(l), L - 2 * M);
      pdf.text(t, M, y);
      y += t.length * 5 + 4;
    }
  }

  // --- Pied de page
  const nb = pdf.getNumberOfPages();
  for (let i = 1; i <= nb; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7.5).setTextColor(...GRIS);
    if (pied.length) pdf.setFontSize(6.8).text(pied, L / 2, hauteurPage - 10 - pied.length * 3.2, { align: "center" }).setFontSize(7.5);
    pdf.text(propre(`${e.nom || ""}${e.siret ? ` – SIRET ${e.siret}` : ""}`), M, hauteurPage - 8);
    pdf.text(`${propre(d.numero || "brouillon")} – page ${i}/${nb}`, L - M, hauteurPage - 8, { align: "right" });
  }
  return pdf.output("blob");
}

// --- Factur-X : PDF/A-3 avec le XML de la facture attaché (pdf-lib chargé dans window.PDFLib)
const xmp = ({ titre, auteur, date, avoir }) => `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${titre}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${auteur}</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${avoir ? "Avoir" : "Facture"} au format Factur-X</rdf:li></rdf:Alt></dc:description>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Cagot</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>Cagot</xmp:CreatorTool><xmp:CreateDate>${date}</xmp:CreateDate><xmp:ModifyDate>${date}</xmp:ModifyDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
</rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

const xmlTexte = (t) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export async function pdfFacturX(blob, xml, { titre, auteur, avoir }) {
  const { PDFDocument, PDFName, PDFHexString, PDFString, AFRelationship } = window.PDFLib;
  const doc = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
  const maintenant = new Date();
  const dateIso = maintenant.toISOString().replace(/\.\d{3}Z$/, "Z");
  doc.setTitle(titre);
  doc.setAuthor(auteur);
  doc.setCreator("Cagot");
  doc.setProducer("Cagot");
  doc.setCreationDate(maintenant);
  doc.setModificationDate(maintenant);
  await doc.attach(new TextEncoder().encode(xml), "factur-x.xml", {
    mimeType: "text/xml",
    description: "Factur-X",
    creationDate: maintenant,
    modificationDate: maintenant,
    afRelationship: AFRelationship.Data,
  });
  const ctx = doc.context;
  const meta = ctx.stream(new TextEncoder().encode(xmp({ titre: xmlTexte(titre), auteur: xmlTexte(auteur), date: dateIso, avoir })), { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(meta));
  const icc = new Uint8Array(await fetch("/polices/srgb.icc").then((r) => r.arrayBuffer()));
  const profil = ctx.register(ctx.stream(icc, { N: 3 }));
  const intention = ctx.obj({ Type: "OutputIntent", S: "GTS_PDFA1", OutputConditionIdentifier: PDFString.of("sRGB"), Info: PDFString.of("sRGB IEC61966-2.1"), DestOutputProfile: profil });
  doc.catalog.set(PDFName.of("OutputIntents"), ctx.obj([ctx.register(intention)]));
  const id = PDFHexString.of([...crypto.getRandomValues(new Uint8Array(16))].map((o) => o.toString(16).padStart(2, "0")).join(""));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  const octets = await doc.save({ useObjectStreams: false });
  return new Blob([octets], { type: "application/pdf" });
}

// Attestation individuelle de l'éditeur (art. 286 I-3° bis du CGI, modèle BOI-TVA-DECLA-30-10-30) :
// Cagot atteste que le logiciel respecte les conditions d'inaltérabilité, de sécurisation,
// de conservation et d'archivage des données. Délivrée nominativement à chaque artisan.
export function pdfAttestation({ editeur: ed, entreprise: e, version, dateFr }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  let POLICE = "helvetica";
  if (polices) {
    pdf.addFileToVFS("LiberationSans-Regular.ttf", polices.normal);
    pdf.addFileToVFS("LiberationSans-Bold.ttf", polices.bold);
    pdf.addFont("LiberationSans-Regular.ttf", "Liberation", "normal");
    pdf.addFont("LiberationSans-Bold.ttf", "Liberation", "bold");
    POLICE = "Liberation";
  }
  const M = 20;
  const largeur = 210 - 2 * M;
  let y = 25;
  const texte = (t, { gras = false, taille = 10.5, couleur = TEXTE, ecart = 2.5 } = {}) => {
    pdf.setFont(POLICE, gras ? "bold" : "normal");
    pdf.setFontSize(taille);
    pdf.setTextColor(...couleur);
    const lignes = pdf.splitTextToSize(propre(t), largeur);
    pdf.text(lignes, M, y);
    y += lignes.length * taille * 0.42 + ecart;
  };
  const ou = (v, defaut) => (String(v ?? "").trim() ? String(v).trim() : defaut);
  texte("ATTESTATION INDIVIDUELLE", { gras: true, taille: 16, couleur: BLEU_DEFAUT, ecart: 1 });
  texte("relative au respect des conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage des données (article 286, I-3° bis du code général des impôts)", { taille: 10, couleur: GRIS, ecart: 8 });
  texte(`Je soussigné(e), ${ed.representant}, ${ed.qualite} de ${ed.nom}${ed.siren ? ` (SIREN ${ed.siren})` : ""}, ${ed.adresse}, éditeur du logiciel de facturation « ${ed.logiciel} », atteste que ce logiciel, dans sa version ${version}, mis sur le marché le ${ed.mise_sur_le_marche}, satisfait aux conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage des données en vue du contrôle de l'administration fiscale, prévues au 3° bis du I de l'article 286 du code général des impôts.`, { ecart: 5 });
  texte("Ces conditions sont assurées de la manière suivante :", { gras: true, ecart: 3 });
  for (const p of [
    "Inaltérabilité : une facture émise ne peut plus être modifiée ni supprimée ; toute correction passe par un avoir numéroté qui fait référence à la facture d'origine. Les factures sont numérotées de façon continue, sans rupture.",
    "Sécurisation : chaque émission de facture ou d'avoir et chaque encaissement est enregistré dans un journal chaîné ; chaque enregistrement porte une empreinte SHA-256 qui inclut l'empreinte précédente et le contenu exact du document. Toute modification casse la chaîne et est détectée par la vérification intégrée. Le journal ne peut être ni modifié ni supprimé, y compris par l'éditeur.",
    "Clôtures : à la fin de chaque mois et de chaque année, les totaux (factures, avoirs, TVA, encaissements) et le cumul perpétuel depuis la première facture sont calculés et scellés dans le journal chaîné.",
    "Conservation et archivage : les données sont conservées sur des serveurs situés dans l'Union européenne ; l'utilisateur peut à tout moment télécharger une archive complète (factures, paiements, journal), accompagnée de son empreinte SHA-256, à conserver pendant la durée légale (6 ans au titre du LPF, 10 ans au titre du code de commerce).",
  ]) texte(`•  ${p}`, { ecart: 3 });
  y += 3;
  texte(`Je m'engage à ce que les versions ultérieures du logiciel ${ed.logiciel} satisfassent à ces mêmes conditions.`, { ecart: 6 });
  texte("Attestation délivrée à :", { gras: true, ecart: 2 });
  for (const l of [ou(e.nom, "(nom de l'entreprise)"), ...String(e.adresse || "").split("\n").filter((x) => x.trim()), e.siret ? `SIRET : ${e.siret}` : "", e.tva_intra ? `N° TVA : ${e.tva_intra}` : ""].filter(Boolean)) texte(l, { ecart: 0.5 });
  y += 8;
  texte(`Fait à ${ed.ville}, le ${dateFr(new Date().toISOString())}.`, { ecart: 3 });
  texte(`${ed.representant}, ${ed.qualite} de ${ed.nom}`, { gras: true, ecart: 10 });
  texte("Cette attestation est à conserver et à présenter en cas de contrôle de l'administration fiscale. L'utilisateur s'engage à utiliser le logiciel conformément à sa destination et à ne pas chercher à contourner ses mécanismes de sécurisation.", { taille: 8.5, couleur: GRIS });
  return pdf.output("blob");
}
