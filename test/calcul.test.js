import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerTotaux } from "../src/calcul.js";

test("calcule lignes, sous-totaux, TVA et TTC", () => {
  const d = calculerTotaux({
    taux_tva: 10,
    sections: [
      { titre: "Murs", lignes: [{ quantite: 35, prix_unitaire_ht: 14 }, { quantite: 35.004, prix_unitaire_ht: 8 }] },
      { titre: "Plafond", lignes: [{ quantite: 14.7, prix_unitaire_ht: 17 }] },
    ],
  });
  assert.equal(d.sections[0].lignes[1].quantite, 35);
  assert.equal(d.sections[0].sous_total_ht, 770);
  assert.equal(d.sections[1].sous_total_ht, 249.9);
  assert.equal(d.total_ht, 1019.9);
  assert.equal(d.montant_tva, 101.99);
  assert.equal(d.total_ttc, 1121.89);
});

test("devis vide", () => {
  const d = calculerTotaux({});
  assert.equal(d.total_ttc, 0);
  assert.equal(d.taux_tva, 10);
});

test("une option non retenue ne compte pas dans le total", async () => {
  const { calculerTotaux } = await import("../src/calcul.js");
  const d = calculerTotaux({
    taux_tva: 10,
    sections: [{ titre: "A", lignes: [
      { quantite: 10, prix_unitaire_ht: 10 },
      { quantite: 1, prix_unitaire_ht: 50, option: true },
      { quantite: 1, prix_unitaire_ht: 30, option: true, option_retenue: true },
    ] }],
  });
  assert.equal(d.total_ht, 130);
  assert.equal(d.sections[0].sous_total_ht, 130);
  assert.equal(d.sections[0].lignes[1].total_ht, 50);
});

test("TVA par ligne : isolation à 5,5 % et peinture à 10 % dans le même devis", () => {
  const d = calculerTotaux({
    taux_tva: 10,
    sections: [{ titre: "A", lignes: [
      { quantite: 10, prix_unitaire_ht: 20 },
      { quantite: 20, prix_unitaire_ht: 50, taux_tva: 5.5 },
      { quantite: 1, prix_unitaire_ht: 99, taux_tva: 20, option: true },
    ] }],
  });
  assert.equal(d.total_ht, 1200);
  assert.deepEqual(d.ventilation_tva, [{ taux: 10, base_ht: 200, montant_tva: 20 }, { taux: 5.5, base_ht: 1000, montant_tva: 55 }]);
  assert.equal(d.montant_tva, 75);
  assert.equal(d.total_ttc, 1275);
});

test("autoliquidation : aucune TVA même si une ligne a son taux", () => {
  const d = calculerTotaux({ taux_tva: 0, autoliquidation: true, sections: [{ titre: "A", lignes: [{ quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }] }] });
  assert.equal(d.montant_tva, 0);
  assert.equal(d.total_ttc, 100);
});
