/**
 * Script de release : bump version + tag git
 * Usage: npm run release [patch|minor|major]
 *        npm run release 1.2.3
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const arg = process.argv[2] ?? 'patch';

function bump(version, type) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`;
  // explicit version
  if (/^\d+\.\d+\.\d+$/.test(type)) return type;
  throw new Error(`Type invalide: ${type}. Utilise patch|minor|major ou ex: 1.2.3`);
}

const newVersion = bump(pkg.version, arg);
pkg.version = newVersion;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log(`\n📦 Version: ${pkg.version} → ${newVersion}`);
console.log('🔨 Build...');
execSync('npm run build', { stdio: 'inherit' });

console.log(`\n🏷️  Tag git: v${newVersion}`);
execSync(`git add package.json`);
execSync(`git commit -m "chore: release v${newVersion}"`);
execSync(`git tag v${newVersion}`);

console.log('\n✅ Fait ! Pour publier la release sur GitHub :');
console.log(`   git push && git push origin v${newVersion}`);
console.log('\nGitHub Actions va builder et créer la release automatiquement.');
