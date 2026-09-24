import { test } from "node:test";
import assert from "node:assert/strict";
import { Requete } from "../src/requete.js";

test("refuse un historique vide sans planter", () => {
  assert.equal(Requete.safeParse({ historique: [] }).success, false);
});

test("l'historique doit finir par un message de l'artisan", () => {
  const h = [{ role: "user", texte: "chambre" }, { role: "assistant", texte: "ok" }];
  assert.equal(Requete.safeParse({ historique: h }).success, false);
  assert.equal(Requete.safeParse({ historique: [...h, { role: "user", texte: "3 x 4" }] }).success, true);
});

test("refuse une image qui n'en est pas une", () => {
  const h = [{ role: "user", texte: "x", images: ["data:text/html;base64,PHNjcmlwdD4="] }];
  assert.equal(Requete.safeParse({ historique: h }).success, false);
});
