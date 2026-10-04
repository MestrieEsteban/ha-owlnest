import test from 'node:test';
import assert from 'node:assert/strict';
import { langFromLocale, setLang, getLang, t } from './i18n.mjs';

test('une etiquette regionale mene a sa langue', () => {
  // Home Assistant expose aussi bien « fr » que « fr-FR » selon les versions.
  for (const tag of ['fr', 'fr-FR', 'fr-CA', 'fr-BE']) {
    assert.equal(langFromLocale(tag), 'fr');
  }
});

test('la casse et le separateur ne comptent pas', () => {
  // Certaines integrations renvoient « fr_FR » ou « FR ».
  for (const tag of ['FR', 'Fr-fr', 'fr_FR', '  fr  ']) {
    assert.equal(langFromLocale(tag), 'fr');
  }
});

test('une langue non traduite retombe sur l\'anglais', () => {
  for (const tag of ['de', 'es', 'pt-BR', 'nl', 'zh-Hans']) {
    assert.equal(langFromLocale(tag), 'en');
  }
});

test('une etiquette absente ou vide retombe sur l\'anglais', () => {
  // Les versions anciennes du frontend n'exposent rien du tout.
  for (const tag of [undefined, null, '', '   ']) {
    assert.equal(langFromLocale(tag), 'en');
  }
});

test('« francais » n\'est pas « fr » par prefixe', () => {
  // Le decoupage porte sur la sous-etiquette, pas sur les premieres lettres :
  // « frisian » (fy) ou un libelle libre ne doivent pas passer pour du francais.
  assert.equal(langFromLocale('fy'), 'en');
  assert.equal(langFromLocale('french'), 'en');
});

test('la langue choisie change le texte rendu', () => {
  const before = getLang();
  try {
    setLang('fr');
    const fr = t('viewLock');
    setLang('en');
    const en = t('viewLock');
    assert.notEqual(fr, en);
    assert.equal(en, 'Lock view');
  } finally {
    setLang(before);
  }
});
