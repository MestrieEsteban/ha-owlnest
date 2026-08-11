import test from 'node:test';
import assert from 'node:assert/strict';
import { lightScale, intensityScale, LIGHT_REFERENCE_SPAN } from './lights.mjs';

/** Envergures relevées sur de vrais modèles. */
const METRES = 12;      // une maison exprimée en mètres
const CENTIMETRES = 618; // le même logement exporté par Sweet Home 3D

test('un modèle à l’échelle de référence n’est pas retouché', () => {
  assert.equal(lightScale(LIGHT_REFERENCE_SPAN), 1);
  assert.equal(intensityScale(LIGHT_REFERENCE_SPAN), 1);
});

test('une envergure absente ou nulle laisse les réglages d’origine', () => {
  // Avant que le modèle ne soit chargé, l'envergure est inconnue : mieux vaut
  // le comportement historique qu'une valeur inventée.
  for (const v of [undefined, 0, -5, NaN]) {
    assert.equal(lightScale(v), 1, `span=${v}`);
    assert.equal(intensityScale(v), 1, `span=${v}`);
  }
});

test('un modèle en centimètres étire la portée d’un facteur cent', () => {
  const k = lightScale(CENTIMETRES) / lightScale(METRES);
  assert.ok(Math.abs(k - 51.5) < 0.1, `facteur obtenu : ${k}`);

  // Portée par défaut : 8 unités à la référence, plusieurs mètres ici.
  const portee = 8 * lightScale(CENTIMETRES);
  assert.ok(portee > 300 && portee < 500,
    `une lampe doit éclairer quelques mètres, pas ${portee.toFixed(0)} cm`);
});

test('l’intensité suit le carré, pas la distance', () => {
  // `decay: 2` fait décroître l'éclairement en 1/d². Éloigner d'un facteur k
  // demande k² d'intensité, sans quoi la lampe disparaît — c'est exactement le
  // symptôme « on ne voit même pas la lumière ».
  const k = lightScale(CENTIMETRES);
  assert.ok(Math.abs(intensityScale(CENTIMETRES) - k * k) < 1e-9);
  assert.ok(intensityScale(CENTIMETRES) > 2000,
    'un modèle en centimètres demande des milliers de candelas');
});

test('l’éclairement reçu est conservé d’une échelle à l’autre', () => {
  // Le vrai invariant : à position *relative* égale, un mur reçoit la même
  // lumière quelle que soit l'unité du modèle.
  const eclairement = (span) => {
    const intensite = 3 * intensityScale(span);
    const distance = span * 0.1;          // un dixième de l'envergure
    return intensite / (distance * distance);
  };
  const a = eclairement(METRES);
  const b = eclairement(CENTIMETRES);
  assert.ok(Math.abs(a - b) / a < 1e-9,
    `écart relatif ${(Math.abs(a - b) / a).toExponential(1)}`);
});

test('la mise à l’échelle est monotone', () => {
  let prev = 0;
  for (const span of [1, 12, 100, 618, 5000]) {
    const k = lightScale(span);
    assert.ok(k > prev, `${span} devrait donner plus que ${prev}`);
    prev = k;
  }
});
