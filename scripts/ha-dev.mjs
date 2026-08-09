/**
 * ha-dev.mjs — bascule la ressource Lovelace Owlnest vers le serveur Vite local.
 *
 * Principe : une ressource Lovelace peut pointer vers n'importe quelle URL.
 * Plutôt que de recopier un bundle dans `config/www`, on fait charger le module
 * par HA directement depuis le serveur de dev. Sauvegarde → Ctrl+R → code à jour.
 *
 * Usage :
 *   npm run dev:ha              bascule HA en mode dev
 *   npm run dev:ha -- --restore remet l'URL de production
 *   npm run dev:ha -- --status  liste les ressources Lovelace
 *
 * Requiert Node 20.6+ (--env-file) et --experimental-websocket : voir package.json.
 */

import { networkInterfaces } from 'node:os';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

// ── Config ───────────────────────────────────────────────────────────────────

const HA_URL = process.env.HA_URL?.replace(/\/+$/, '');
const HA_TOKEN = process.env.HA_TOKEN;
const DEV_PORT = process.env.DEV_PORT || '5173';
const PROD_URL = process.env.PROD_RESOURCE_URL || '/hacsfiles/ha-owlnest/ha-3d-floorplan.js';

/** Chemin servi par Vite. Le marqueur permet de reconnaître nos ressources. */
const DEV_PATH = '/src/dev-entry.ts';
const DEV_MARKER = 'owlnest-dev';

/** Tag enregistré par la carte : c'est lui qui fait autorité, pas le nom du fichier. */
const TAG = 'ha-3d-floorplan';

/**
 * Mémorise quelle ressource a été détournée et son URL d'origine, pour que
 * --restore soit exact plutôt que de deviner.
 */
const STATE_FILE = '.ha-dev-state.json';

const mode = process.argv.includes('--restore')
  ? 'restore'
  : process.argv.includes('--status')
    ? 'status'
    : process.argv.includes('--clean')
      ? 'clean'
      : 'dev';

// ── Sorties ──────────────────────────────────────────────────────────────────

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Un jeton ne doit jamais apparaître en clair, même dans un log local. */
function maskToken(token) {
  if (!token || token.length < 12) return '(invalide)';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function die(msg, hint) {
  console.error(`\n${c.red('✗')} ${msg}`);
  if (hint) console.error(`  ${c.dim(hint)}`);
  process.exit(1);
}

// ── Détection de l'IP locale ─────────────────────────────────────────────────

/**
 * IP de cette machine telle que HA et la tablette la voient.
 * `localhost` ne convient pas : la requête part du navigateur, pas de HA.
 */
function detectHost() {
  if (process.env.DEV_HOST) return process.env.DEV_HOST;

  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Écarte les interfaces virtuelles, qui ne sont pas routables depuis le LAN.
      const virtual = /^(vEthernet|WSL|Loopback|Docker|VirtualBox|VMware)/i.test(name);
      candidates.push({ name, address: a.address, virtual });
    }
  }
  if (!candidates.length) {
    die(
      'Aucune IPv4 externe trouvée sur cette machine.',
      'Renseigne DEV_HOST dans .env avec l\'IP visible depuis HA.',
    );
  }

  const real = candidates.filter((x) => !x.virtual);
  const chosen = (real.length ? real : candidates)[0];

  if (real.length > 1) {
    console.log(c.yellow(`⚠ Plusieurs interfaces réseau détectées :`));
    real.forEach((x) => console.log(`    ${x.address}  ${c.dim(x.name)}`));
    console.log(c.dim(`  Choix : ${chosen.address}. Force avec DEV_HOST dans .env si c'est la mauvaise.\n`));
  }
  return chosen.address;
}

// ── Client WebSocket ─────────────────────────────────────────────────────────

/**
 * Les réponses HA arrivent dans le désordre : chaque commande porte un id
 * croissant, et on résout la promesse correspondante par cet id — jamais en
 * prenant le message suivant.
 */
class HaClient {
  #ws = null;
  #id = 1;
  #pending = new Map();

  connect(url, token) {
    const wsUrl = `${url.replace(/^http/, 'ws')}/api/websocket`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.#ws = ws;

      const failFast = () =>
        reject(
          new Error(
            `Connexion impossible à ${wsUrl}.\n` +
              `  Vérifie HA_URL, et utilise l'IP plutôt que homeassistant.local.`,
          ),
        );
      ws.addEventListener('error', failFast, { once: true });

      ws.addEventListener('close', () => {
        for (const { reject: rj } of this.#pending.values()) {
          rj(new Error('Connexion WebSocket fermée avant réponse.'));
        }
        this.#pending.clear();
      });

      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: token }));
          return;
        }
        if (msg.type === 'auth_invalid') {
          reject(new Error(`Jeton refusé (${maskToken(token)}) : ${msg.message ?? 'auth_invalid'}`));
          ws.close();
          return;
        }
        if (msg.type === 'auth_ok') {
          ws.removeEventListener('error', failFast);
          resolve(msg.ha_version);
          return;
        }

        if (msg.type === 'result') {
          const p = this.#pending.get(msg.id);
          if (!p) return;
          this.#pending.delete(msg.id);
          if (msg.success) p.resolve(msg.result);
          else p.reject(new Error(`${msg.error?.code ?? 'error'} — ${msg.error?.message ?? ''}`));
        }
      });
    });
  }

  send(payload) {
    const id = this.#id++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ ...payload, id }));
    });
  }

  close() {
    this.#ws?.close();
  }
}

// ── Ressources Lovelace ──────────────────────────────────────────────────────

async function listResources(ha) {
  try {
    return await ha.send({ type: 'lovelace/resources' });
  } catch (err) {
    if (String(err.message).includes('not_found') || String(err.message).includes('unknown_command')) {
      die(
        'La commande `lovelace/resources` est indisponible.',
        'Elle exige Lovelace en mode storage (interface graphique).\n' +
          '  Si ton lovelace est en mode YAML, les ressources sont déclarées dans\n' +
          '  configuration.yaml et doivent être modifiées à la main.',
      );
    }
    throw err;
  }
}

const isDevResource = (r) => r.url.includes(DEV_MARKER);

/** État persisté entre deux exécutions. */
function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}
const writeState = (s) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
const clearState = () => {
  try {
    unlinkSync(STATE_FILE);
  } catch {
    /* déjà absent */
  }
};

/**
 * Le nom du fichier ne dit rien : une ancienne installation manuelle peut
 * s'appeler `floorplan.js`. La seule preuve fiable est le contenu — on
 * télécharge le bundle et on regarde s'il enregistre notre tag.
 */
async function definesOurTag(url) {
  const abs = url.startsWith('http') ? url : `${HA_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  try {
    const res = await fetch(abs, { headers: { Authorization: `Bearer ${HA_TOKEN}` } });
    if (!res.ok) return false;
    const body = await res.text();
    return new RegExp(String.raw`customElements\.define\(\s*["'\`]${TAG}["'\`]`).test(body);
  } catch {
    return false;
  }
}

/**
 * Cherche la ressource qui sert réellement Owlnest en production.
 * On ne sonde que les candidats plausibles : inspecter tous les bundles HACS
 * ferait télécharger plusieurs mégaoctets pour rien.
 */
async function findProdResource(resources) {
  const candidates = resources.filter(
    (r) => !isDevResource(r) && /floorplan|owlnest|3d/i.test(r.url),
  );
  for (const r of candidates) {
    if (await definesOurTag(r.url)) return r;
  }
  return null;
}

// ── Programme principal ──────────────────────────────────────────────────────

async function main() {
  if (!HA_URL || !HA_TOKEN) {
    die(
      'HA_URL ou HA_TOKEN manquant.',
      'Copie .env.example en .env et remplis-le.',
    );
  }
  if (typeof WebSocket === 'undefined') {
    die(
      'WebSocket global indisponible.',
      'Node 20 exige le flag --experimental-websocket (déjà présent dans le script npm).',
    );
  }

  const ha = new HaClient();
  console.log(`\n${c.cyan('→')} Connexion à ${c.bold(HA_URL)} ${c.dim(`(jeton ${maskToken(HA_TOKEN)})`)}`);

  let version;
  try {
    version = await ha.connect(HA_URL, HA_TOKEN);
  } catch (err) {
    die(err.message);
  }
  console.log(`${c.green('✓')} Home Assistant ${version}`);

  const before = await listResources(ha);

  if (mode === 'status') {
    console.log(`\n${c.bold('Ressources Lovelace :')}`);
    if (!before.length) console.log(c.dim('  (aucune)'));
    for (const r of before) {
      const tag = r.url.includes(DEV_MARKER) ? c.yellow(' ← DEV') : '';
      console.log(`  ${c.dim(`#${r.id}`)} ${r.url}${tag}`);
    }
    console.log();
    ha.close();
    return;
  }

  const state = readState();

  // ── Doublons de dev ─────────────────────────────────────────────────────
  // Une ressource de dev créée par erreur en plus de la vraie : elle se charge
  // en second, le tag est déjà pris, et le code de dev est ignoré en silence.
  const strays = before.filter((r) => isDevResource(r) && r.id !== state?.resource_id);

  if (mode === 'clean') {
    if (!strays.length) {
      console.log(`\n${c.green('✓')} Aucune ressource de dev en double.\n`);
      ha.close();
      return;
    }
    for (const r of strays) {
      await ha.send({ type: 'lovelace/resources/delete', resource_id: r.id });
      console.log(`${c.green('✓')} Supprimée : ${r.url}`);
    }
    ha.close();
    console.log();
    return;
  }

  // ── Choix de la ressource à détourner ───────────────────────────────────
  let target = state?.resource_id ? before.find((r) => r.id === state.resource_id) : null;
  let prodUrl = state?.prod_url ?? null;

  if (!target) {
    console.log(c.dim('  Recherche du bundle Owlnest servi par HA…'));
    const found = await findProdResource(before);
    if (found) {
      target = found;
      prodUrl = found.url;
      console.log(`  ${c.green('✓')} Trouvé : ${c.bold(found.url)} ${c.dim(`(#${found.id})`)}`);
    }
  }

  if (mode === 'restore') {
    const url = prodUrl ?? PROD_URL;
    if (target) await ha.send({ type: 'lovelace/resources/update', resource_id: target.id, url });
    else die('Rien à restaurer : aucune ressource Owlnest connue.', 'Vérifie avec --status.');

    const back = (await listResources(ha)).find((r) => r.id === target.id);
    ha.close();
    if (back?.url !== url) die('Relecture : la restauration n\'a pas pris.', `Trouvé : ${back?.url}`);
    clearState();
    console.log(`\n${c.green('✓')} Ressource restaurée : ${c.bold(url)}`);
    console.log(c.dim('  Recharge le dashboard (Ctrl+Shift+R) pour repasser sur le bundle de prod.\n'));
    return;
  }

  const targetUrl = `http://${detectHost()}:${DEV_PORT}${DEV_PATH}?${DEV_MARKER}`;

  if (target) {
    if (target.url !== targetUrl) {
      await ha.send({ type: 'lovelace/resources/update', resource_id: target.id, url: targetUrl });
    }
  } else {
    console.log(c.dim('  Aucun bundle Owlnest servi par HA — création d\'une ressource.'));
    const created = await ha.send({ type: 'lovelace/resources/create', res_type: 'module', url: targetUrl });
    target = { id: created.id, url: targetUrl };
    prodUrl = null;
  }

  writeState({ resource_id: target.id, prod_url: prodUrl });

  // Un `success: true` ne prouve pas que le contenu est celui qu'on croit :
  // on relit systématiquement après écriture.
  const after = await listResources(ha);
  const live = after.find((r) => r.id === target.id);
  if (live?.url !== targetUrl) {
    ha.close();
    die(
      'Relecture : la ressource ne porte pas l\'URL attendue.',
      `Attendu : ${targetUrl}\nTrouvé  : ${live?.url ?? '(disparue)'}`,
    );
  }

  // Toute autre ressource qui enregistre le même tag gagnera si elle est
  // chargée avant : c'est un échec silencieux, il faut le signaler fort.
  const rivals = after.filter((r) => r.id !== target.id && isDevResource(r));
  ha.close();

  if (rivals.length) {
    console.log(`\n${c.yellow('⚠ Conflit :')} ${rivals.length} autre(s) ressource(s) de dev enregistrent ${c.bold(TAG)} :`);
    rivals.forEach((r) => console.log(`    ${c.dim(`#${r.id}`)} ${r.url}`));
    console.log(c.yellow('  Tant qu\'elles existent, le code chargé est imprévisible.'));
    console.log(`  Nettoyage : ${c.cyan('npm run dev:ha -- --clean')}\n`);
  }

  if (mode === 'restore') {
    console.log(`\n${c.green('✓')} Ressource restaurée : ${c.bold(targetUrl)}`);
    console.log(c.dim('  Recharge le dashboard (Ctrl+Shift+R) pour repasser sur le bundle de prod.\n'));
    return;
  }

  console.log(`\n${c.green('✓')} HA charge maintenant Owlnest depuis ${c.bold(targetUrl)}\n`);
  console.log(`  ${c.bold('1.')} Lance le serveur de dev  ${c.cyan('npm run dev')}`);
  console.log(`  ${c.bold('2.')} Recharge le dashboard    ${c.cyan('Ctrl+Shift+R')}`);
  console.log(`  ${c.bold('3.')} Chaque sauvegarde recharge la page automatiquement.`);
  console.log(`\n  ${c.dim('Retour en prod :')} ${c.cyan('npm run dev:ha -- --restore')}\n`);
  console.log(c.yellow('  ⚠ Tant que le serveur Vite est éteint, le dashboard affiche une carte vide.'));
  console.log(c.dim('    Si HA est servi en HTTPS, le navigateur bloquera ce module HTTP'));
  console.log(c.dim('    (contenu mixte) : accède à HA en HTTP pendant le dev.\n'));
}

main().catch((err) => {
  console.error(`\n${c.red('✗')} ${err.stack ?? err.message}\n`);
  process.exit(1);
});
