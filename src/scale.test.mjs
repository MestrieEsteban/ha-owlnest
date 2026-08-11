import test from 'node:test';
import assert from 'node:assert/strict';
import { modelScale, REFERENCE_SPAN } from './scale.mjs';
import { lightScale, intensityScale } from './lights.mjs';

const METRES = 12;       // une maison exprimée en mètres
const CM = 185;          // l'appartement réel, tel que le charge GLTFLoader

test('la référence ne retouche rien', () => {
  assert.equal(modelScale(REFERENCE_SPAN), 1);
});

test('une envergure inconnue laisse les réglages d’origine', () => {
  // Avant le chargement du modèle, mieux vaut le comportement historique
  // qu'une valeur inventée.
  for (const v of [undefined, 0, -5, NaN]) assert.equal(modelScale(v), 1, `span=${v}`);
});

test('le facteur est proportionnel à l’envergure', () => {
  assert.equal(modelScale(24), 2);
  assert.equal(modelScale(6), 0.5);
  assert.ok(Math.abs(modelScale(CM) - CM / METRES) < 1e-12);
});

test('les lumières partagent la référence commune', () => {
  // Trois constantes de calibrage dupliquées, c'est trois occasions de dériver.
  // `lights.ts` ne doit donc plus avoir la sienne.
  assert.equal(lightScale(REFERENCE_SPAN), 1);
  assert.equal(lightScale(CM), modelScale(CM));
});

test('l’intensité suit le carré du facteur', () => {
  // `decay: 2` fait décroître l'éclairement en 1/d².
  const k = modelScale(CM);
  assert.ok(Math.abs(intensityScale(CM) - k * k) < 1e-9);
});

test('une grandeur de météo redevient visible à l’échelle', () => {
  // Relevé du défaut : des gouttes de 0,12 à 0,44 unité et des chutes de 4,5
  // unités par seconde, écrites pour un modèle en mètres.
  const k = modelScale(CM);
  const goutte = 0.44 * k;
  const chute = 4.5 * k;
  // Sur un logement de 185 unités de large, une goutte de moins d'une unité
  // resterait invisible et une chute de moins de dix unités semblerait figée.
  assert.ok(goutte > 5, `goutte de ${goutte.toFixed(1)} unité(s)`);
  assert.ok(chute > 50, `chute de ${chute.toFixed(0)} unités par seconde`);
});

test('un modèle déjà en mètres n’est pas dénaturé', () => {
  // Garde-fou symétrique : la correction ne doit pas casser le cas d'origine.
  const k = modelScale(METRES);
  assert.equal(0.44 * k, 0.44);
  assert.equal(4.5 * k, 4.5);
});
