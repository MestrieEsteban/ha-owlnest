import test from 'node:test';
import assert from 'node:assert/strict';
import { httpStatus, modelErrorKey, bustCache, shouldRetryUncached } from './model-errors.mjs';

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

test('la cause se traduit en cle', () => {
  const of = (s) => modelErrorKey(new Error(`fetch for "u" responded with ${s}: x`));
  assert.equal(of(404), 'modelErrNotFound');
  assert.equal(of(403), 'modelErrDenied');
  assert.equal(of(401), 'modelErrDenied');
  assert.equal(of(500), 'modelErrServer');
  assert.equal(of(503), 'modelErrServer');
  // Un echec sans code HTTP retombe sur le message general.
  assert.equal(modelErrorKey(new Error('boom')), 'modelErrLoad');
});

test('un code inattendu ne casse rien', () => {
  // 418 n'a pas de cas dedie : il ne doit ni jeter ni produire une cle vide.
  assert.equal(modelErrorKey(new Error('fetch for "u" responded with 418: x')), 'modelErrLoad');
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
