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
