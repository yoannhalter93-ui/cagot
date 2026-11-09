// Factur-X (profil EN 16931) : la facture électronique « mixte » française et européenne.
// Un PDF lisible par l'humain + le fichier XML CII (factur-x.xml) attaché, lisible par les logiciels
// et les plateformes agréées. Ce module fabrique le XML ; l'assemblage PDF/A-3 est dans pdf-devis.js.
import { autoliquidation, estParticulier, ventilationTva } from "/mentions-legales.js";
import { tauxLigne } from "/calcul.js";

const x = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const montant = (n) => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
const qte = (n) => String(Math.round(Number(n || 0) * 10000) / 10000);
const date102 = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};
const chiffres = (t) => String(t ?? "").replace(/\D/g, "");

// Unités du bâtiment → codes UN/ECE Recommandation 20 (obligatoires dans la facture électronique).
const CODES_UNITES = { "m²": "MTK", m2: "MTK", ml: "MTR", m: "MTR", "m³": "MTQ", m3: "MTQ", u: "C62", h: "HUR", heure: "HUR", jour: "DAY", j: "DAY", forfait: "LS", ens: "C62", ensemble: "C62", kg: "KGM", l: "LTR" };
export const codeUnite = (u) => CODES_UNITES[String(u ?? "").trim().toLowerCase()] ?? "C62";

// « 12 rue X\n69000 Lyon » → lignes d'adresse, code postal, ville.
export function adresseDecoupee(texte) {
  const lignes = String(texte ?? "").split(/\n|,(?=\s*\d{5})/).map((l) => l.trim()).filter(Boolean);
  let cp = "";
  let ville = "";
  const i = lignes.findIndex((l) => /\b\d{5}\b/.test(l));
  if (i !== -1) {
    const m = lignes[i].match(/(.*?)(\d{5})\s*(.*)/);
    cp = m[2];
    ville = m[3].trim();
    const avant = m[1].trim();
    lignes.splice(i, 1, ...(avant ? [avant] : []));
  }
  return { ligne1: lignes[0] ?? "", ligne2: lignes.slice(1).join(", "), cp, ville };
}

const xmlAdresse = (texte) => {
  const a = adresseDecoupee(texte);
  return `<ram:PostalTradeAddress>${a.cp ? `<ram:PostcodeCode>${x(a.cp)}</ram:PostcodeCode>` : ""}${a.ligne1 ? `<ram:LineOne>${x(a.ligne1)}</ram:LineOne>` : ""}${a.ligne2 ? `<ram:LineTwo>${x(a.ligne2)}</ram:LineTwo>` : ""}${a.ville ? `<ram:CityName>${x(a.ville)}</ram:CityName>` : ""}<ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>`;
};

// Catégorie de TVA EN 16931 : S (taux normal/réduit), E (exonéré : franchise), AE (autoliquidation).
function categorieTva(c, e) {
  if (e.franchise_tva) return { code: "E", taux: 0, motif: "TVA non applicable, art. 293 B du CGI", codeMotif: "VATEX-FR-FRANCHISE" };
  if (autoliquidation(c)) return { code: "AE", taux: 0, motif: "Autoliquidation", codeMotif: "VATEX-EU-AE" };
  return { code: "S", taux: Number(c.taux_tva ?? 0) };
}

/**
 * XML CII Factur-X EN 16931 d'une facture ou d'un avoir émis.
 * @param {{ d: object, e: object, mentions: string[], echeance: string }} p
 */
export function xmlFacturX({ d, e, mentions = [], echeance }) {
  const c = d.contenu;
  const avoir = !!c.avoir;
  const tva = categorieTva(c, e);
  const signe = avoir ? -1 : 1; // l'avoir porte des montants positifs avec le type 381
  const lignes = (c.sections ?? []).flatMap((s) => (s.lignes ?? []).filter((l) => !l.option || l.option_retenue === true).map((l) => ({ ...l, section: s.titre })));
  const ht = signe * Number(c.total_ht || 0);
  const montantTva = tva.code === "S" ? signe * Number(c.montant_tva || 0) : 0;
  const ttc = Math.round((ht + montantTva) * 100) / 100;
  const pro = !estParticulier(c);
  const siren = chiffres(e.siret).slice(0, 9);
  const sirenClient = chiffres(c.client_siren).slice(0, 9);

  const xmlLignes = lignes
    .map((l, i) => {
      const q = signe * Number(l.quantite || 0);
      const totalLigne = Math.round(q * Number(l.prix_unitaire_ht || 0) * 100) / 100;
      const tauxL = tva.code === "S" ? tauxLigne(l, c) : 0;
      const catL = tva.code === "S" ? (tauxL > 0 ? "S" : "E") : tva.code;
      return `<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct><ram:Name>${x(l.designation)}</ram:Name>${l.detail ? `<ram:Description>${x(l.detail)}</ram:Description>` : ""}</ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${montant(l.prix_unitaire_ht)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${codeUnite(l.unite)}">${qte(q)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement>
<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${catL}</ram:CategoryCode><ram:RateApplicablePercent>${montant(tauxL)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${montant(totalLigne)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
</ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join("\n");

  // Mentions obligatoires codées (règles françaises BR-FR-05) + autres mentions en texte libre.
  const note = (t, code) => `<ram:IncludedNote><ram:Content>${x(t)}</ram:Content>${code ? `<ram:SubjectCode>${code}</ram:SubjectCode>` : ""}</ram:IncludedNote>`;
  const codees = [
        note("En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal (art. L441-10 du Code de commerce).", "PMD"),
        note("Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (art. D441-5 du Code de commerce).", "PMT"),
        note("Pas d'escompte pour paiement anticipé.", "AAB"),
  ];
  // TVA par taux (S), ou une seule ligne exonérée (E : franchise) / autoliquidée (AE).
  const taxe = ({ montantT, base, cat, taux, motif, codeMotif }) => `<ram:ApplicableTradeTax>
<ram:CalculatedAmount>${montant(montantT)}</ram:CalculatedAmount>
<ram:TypeCode>VAT</ram:TypeCode>
${motif ? `<ram:ExemptionReason>${x(motif)}</ram:ExemptionReason>` : ""}
<ram:BasisAmount>${montant(base)}</ram:BasisAmount>
<ram:CategoryCode>${cat}</ram:CategoryCode>
${codeMotif ? `<ram:ExemptionReasonCode>${codeMotif}</ram:ExemptionReasonCode>` : ""}
${cat === "S" && !e.tva_debits && c.nature !== "biens" ? "<ram:DueDateTypeCode>72</ram:DueDateTypeCode>" : ""}
<ram:RateApplicablePercent>${montant(taux)}</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>`;
  const taxesEntete =
    tva.code === "S"
      ? ventilationTva(c)
          .map((v) => taxe({ montantT: signe * v.montant_tva, base: signe * v.base_ht, cat: Number(v.taux) > 0 ? "S" : "E", taux: v.taux, motif: Number(v.taux) > 0 ? "" : "Exonération de TVA" }))
          .join("\n")
      : taxe({ montantT: 0, base: ht, cat: tva.code, taux: 0, motif: tva.motif, codeMotif: tva.codeMotif });
  const notes = [...codees, ...mentions.filter((m) => !/pénalités|escompte|recouvrement/i.test(m)).map((m) => note(m))].join("");
  const iban = String(e.iban ?? "").replace(/\s+/g, "").toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${x(d.numero)}</ram:ID>
<ram:TypeCode>${avoir ? 381 : 380}</ram:TypeCode>
<ram:IssueDateTime><udt:DateTimeString format="102">${date102(d.date_document)}</udt:DateTimeString></ram:IssueDateTime>
${notes}
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${xmlLignes}
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty>
<ram:Name>${x(e.nom || "")}</ram:Name>
${siren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${siren}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}
${xmlAdresse(e.adresse)}
${siren ? `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${siren}</ram:URIID></ram:URIUniversalCommunication>` : e.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(e.email)}</ram:URIID></ram:URIUniversalCommunication>` : ""}
${e.tva_intra && !e.franchise_tva ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(String(e.tva_intra).replace(/\s+/g, ""))}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
${siren && e.franchise_tva ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${siren}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
</ram:SellerTradeParty>
<ram:BuyerTradeParty>
<ram:Name>${x(c.client_nom || "Client")}</ram:Name>
${pro && sirenClient ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${sirenClient}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}
${xmlAdresse(c.client_adresse)}
${pro && sirenClient ? `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${sirenClient}</ram:URIID></ram:URIUniversalCommunication>` : c.client_email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(c.client_email)}</ram:URIID></ram:URIUniversalCommunication>` : ""}
</ram:BuyerTradeParty>
${c.devis_numero ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(c.devis_numero)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ""}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>
${c.adresse_chantier ? `<ram:ShipToTradeParty><ram:Name>${x(c.client_nom || "Chantier")}</ram:Name>${xmlAdresse(c.adresse_chantier)}</ram:ShipToTradeParty>` : ""}
<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(d.date_document)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${iban && !avoir ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ""}
${taxesEntete}
${echeance && !avoir ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${date102(echeance)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ""}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${montant(ht)}</ram:LineTotalAmount>
<ram:TaxBasisTotalAmount>${montant(ht)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="EUR">${montant(montantTva)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${montant(ttc)}</ram:GrandTotalAmount>
<ram:DuePayableAmount>${montant(ttc)}</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${avoir && c.facture_origine ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(c.facture_origine)}</ram:IssuerAssignedID>${c.facture_origine_date ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${date102(c.facture_origine_date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ""}</ram:InvoiceReferencedDocument>` : ""}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/\n{2,}/g, "\n");
}
