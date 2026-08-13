/**
 * Script de release : bump version + build + tag git.
 *
 * Usage: npm run release            (patch)
 *        npm run release -- minor
 *        npm run release -- 1.2.3
 *
 * Met à jour package.json ET custom_components/owlnest/manifest.json :
 * HACS lit le second pour l'intégration, le premier pour la carte.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const MANIFEST = 'custom_components/owlnest/manifest.json';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const arg = process.argv[2] ?? 'patch';

const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

/** Version la plus élevée déjà publiée, pour éviter de recréer un tag existant. */
function latestTag() {
  try {
    const tags = execSync('git tag --list "v*"', { encoding: 'utf8' })
      .split('\n')
      .map((t) => t.trim().replace(/^v/, ''))
      .filter((t) => /^\d+\.\d+\.\d+$/.test(t));
    return tags.sort(cmp).pop() ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function bump(version, type) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(type)) return type;
  throw new Error(`Type invalide: ${type}. Utilise patch|minor|major ou ex: 1.2.3`);
}

// La base est le max(package.json, dernier tag) : package.json avait dérivé
// derrière les tags publiés, ce qui produisait des tags en collision.
const tag = latestTag();
const base = cmp(pkg.version, tag) >= 0 ? pkg.version : tag;
if (base !== pkg.version) {
  console.log(`⚠️  package.json (${pkg.version}) en retard sur le dernier tag (v${tag}) — on repart de ${base}`);
}

const oldVersion = pkg.version;
const newVersion = bump(base, arg);

if (cmp(newVersion, tag) <= 0) {
  console.error(`\n❌ v${newVersion} existe déjà (dernier tag : v${tag}). Choisis une version supérieure.`);
  process.exit(1);
}

console.log(`\n📦 Version: ${oldVersion} → ${newVersion}`);

// Un type cassé ne doit pas partir en release : Vite ne type-check pas.
console.log('🔎 Typecheck...');
execSync('npm run typecheck', { stdio: 'inherit' });

// Ni une régression : les tests couvrent la géométrie, les règles et l'échelle,
// c'est-à-dire précisément ce qui casse en silence.
console.log('🧪 Tests...');
execSync('npm test', { stdio: 'inherit' });

pkg.version = newVersion;
manifest.version = newVersion;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log('🔨 Build...');
execSync('npm run build', { stdio: 'inherit' });

console.log(`\n🏷️  Tag git: v${newVersion}`);
execSync(`git add package.json ${MANIFEST}`);
execSync(`git commit -m "chore: release v${newVersion}"`);
execSync(`git tag v${newVersion}`);

console.log('\n✅ Fait ! Pour publier la release sur GitHub :');
console.log(`   git push && git push origin v${newVersion}`);
console.log('\nGitHub Actions va builder et créer la release automatiquement.');
