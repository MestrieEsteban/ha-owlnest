import test from 'node:test';
import assert from 'node:assert/strict';
import { httpStatus, modelErrorMessage, bustCache, shouldRetryUncached } from './model-errors.mjs';

test('le code HTTP se lit dans le message de three.js', () => {
  // Forme exacte rejetée par GLTFLoader.
  const err = new Error('fetch for "http://x/y.glb" responded with 404: Not Found');
  assert.equal(httpStatus(err), 404);
});

test('le code HTTP se lit aussi sur la reponse portee par l\'erreur', () => {
  assert.equal(httpStatus({ response: { status: 503 } }), 503);
});

test('un echec non HTTP ne produit pas de code', () => {
  assert.equal(httpStatus(new Error('Failed to fetch')), null);
  assert.equal(httpStatus(undefined), null);
  // Un nombre a trois chiffres hors contexte ne doit pas passer pour un code.
  assert.equal(httpStatus(new Error('invalid glb: 404 vertices')), null);
});

test('le message distingue les causes', () => {
  const of = (s) => modelErrorMessage(new Error(`fetch for "u" responded with ${s}: x`));
  assert.match(of(404), /introuvable/);
  assert.match(of(403), /Acces refuse|Accès refusé/);
  assert.match(of(500), /serveur/);
  assert.equal(modelErrorMessage(new Error('boom')), 'Échec du chargement du modèle');
});

test('le message porte toujours le code quand il existe', () => {
  for (const s of [404, 401, 403, 500, 502, 418]) {
    assert.match(modelErrorMessage(new Error(`fetch for "u" responded with ${s}: x`)), new RegExp(String(s)));
  }
});

test('le parametre anti-cache respecte une URL deja parametree', () => {
  assert.equal(bustCache('/local/a.glb', '7'), '/local/a.glb?owlnest_cb=7');
  assert.equal(bustCache('/local/a.glb?v=1', '7'), '/local/a.glb?v=1&owlnest_cb=7');
});

test('le fragment est conserve et reste en fin d\'URL', () => {
  // Le fragment n'est pas envoye au serveur, mais le perdre changerait
  // l'adresse demandee par le chargeur.
  assert.equal(bustCache('/local/a.glb#scene', '7'), '/local/a.glb?owlnest_cb=7#scene');
  assert.equal(bustCache('/local/a.glb?v=1#s', '7'), '/local/a.glb?v=1&owlnest_cb=7#s');
});

test('deux appels produisent deux URL differentes', () => {
  // Sans cela la seconde tentative retomberait dans le meme cache.
  assert.notEqual(bustCache('/a.glb', '1'), bustCache('/a.glb', '2'));
});

test('seul un 404 declenche une seconde tentative', () => {
  const of = (s) => new Error(`fetch for "u" responded with ${s}: x`);
  assert.equal(shouldRetryUncached(of(404)), true);
  assert.equal(shouldRetryUncached(of(500)), false);
  assert.equal(shouldRetryUncached(of(403)), false);
  // Une panne reseau se reproduirait a l'identique : ne pas insister.
  assert.equal(shouldRetryUncached(new Error('Failed to fetch')), false);
});
