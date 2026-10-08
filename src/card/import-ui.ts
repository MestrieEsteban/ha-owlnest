/**
 * import-ui.ts — la zone de dépôt et l'avancement d'un import de plan.
 *
 * Rien ici ne sait convertir ni envoyer : voir import/drop.ts. Ce module ne
 * fait que montrer où lâcher les fichiers, puis ce qui se passe ensuite, pour
 * qu'une conversion de quelques secondes ne ressemble jamais à un plantage.
 */

import { t } from '../i18n';
import { droppedEntries, type ImportStage } from '../import/drop';

const FONT = 'font-family:var(--primary-font-family,sans-serif)';

/** Ce qu'accepte le sélecteur : l'export Sweet Home 3D en vrac, un zip ou un GLB. */
const ACCEPT = '.glb,.obj,.mtl,.zip,.jpg,.jpeg,.png';

/**
 * Accepte les fichiers glissés sur la carte.
 *
 * `enabled` est relu à chaque survol : les droits ou le mode de la carte
 * peuvent changer sans qu'on réinstalle la zone. Retourne de quoi la retirer.
 */
export function attachDropZone(
  card: HTMLElement,
  container: HTMLElement,
  enabled: () => boolean,
  onDrop: (source: FileSystemEntry[] | File[]) => void,
): () => void {
  let veil: HTMLDivElement | null = null;
  // dragenter/dragleave se déclenchent à chaque enfant traversé : on compte.
  let depth = 0;

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  const show = () => {
    if (veil) return;
    veil = document.createElement('div');
    veil.style.cssText = [
      'position:absolute', 'inset:10px', 'z-index:300', 'pointer-events:none',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:8px',
      'border:2px dashed rgba(125,211,252,0.7)', 'border-radius:14px',
      'background:rgba(6,10,20,0.78)', 'backdrop-filter:blur(6px)',
      'color:#e0f2fe', 'text-align:center', 'padding:16px', FONT,
    ].join(';');
    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:700;color:#7dd3fc;';
    title.textContent = t('importDropTitle');
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:11.5px;color:#94a3b8;max-width:340px;line-height:1.45;';
    sub.textContent = t('importDropHint');
    veil.append(title, sub);
    container.appendChild(veil);
  };
  const hide = () => { veil?.remove(); veil = null; depth = 0; };

  const onEnter = (e: DragEvent) => {
    if (!hasFiles(e) || !enabled()) return;
    e.preventDefault();
    depth++;
    show();
  };
  const onOver = (e: DragEvent) => {
    if (!hasFiles(e) || !enabled()) return;
    // Sans cela le navigateur ouvrirait le fichier à la place de la page.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onLeave = (e: DragEvent) => {
    if (!veil) return;
    if (--depth <= 0 || !card.contains(e.relatedTarget as Node | null)) hide();
  };
  const onDropEvt = (e: DragEvent) => {
    if (!hasFiles(e) || !enabled() || !e.dataTransfer) return;
    e.preventDefault();
    hide();
    const source = droppedEntries(e.dataTransfer) ?? Array.from(e.dataTransfer.files);
    if (source.length) onDrop(source);
  };

  card.addEventListener('dragenter', onEnter);
  card.addEventListener('dragover', onOver);
  card.addEventListener('dragleave', onLeave);
  card.addEventListener('drop', onDropEvt);
  return () => {
    hide();
    card.removeEventListener('dragenter', onEnter);
    card.removeEventListener('dragover', onOver);
    card.removeEventListener('dragleave', onLeave);
    card.removeEventListener('drop', onDropEvt);
  };
}

/** Ouvre le sélecteur de fichiers ; plusieurs à la fois, pour un export en vrac. */
export function pickFiles(onPick: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (files.length) onPick(files);
  });
  document.body.appendChild(input);
  input.click();
}

/** Panneau d'avancement, au centre de la carte, le temps de l'import. */
export class ImportProgress {
  private el: HTMLDivElement;
  private label: HTMLDivElement;
  private bar: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:300', 'width:min(320px,calc(100% - 32px))', 'box-sizing:border-box',
      'padding:16px 18px', 'border-radius:12px', 'pointer-events:auto',
      'background:rgba(8,13,26,0.92)', 'backdrop-filter:blur(10px)',
      'border:1px solid rgba(125,211,252,0.3)', 'color:#e2e8f0', FONT,
    ].join(';');
    this.label = document.createElement('div');
    this.label.style.cssText = 'font-size:12.5px;margin-bottom:10px;';
    const track = document.createElement('div');
    track.style.cssText = 'height:4px;border-radius:2px;background:rgba(255,255,255,0.1);overflow:hidden;';
    this.bar = document.createElement('div');
    this.bar.style.cssText = 'height:100%;width:0;background:#7dd3fc;transition:width .2s ease;';
    track.appendChild(this.bar);
    this.el.append(this.label, track);
    container.appendChild(this.el);
  }

  /** Une étape sans fraction connue montre une barre pleine qui pulse. */
  stage(stage: ImportStage | 'loading', fraction?: number): void {
    const key = {
      reading: 'importReading',
      converting: 'importConverting',
      uploading: 'importUploading',
      loading: 'importLoading',
    } as const;
    const pct = fraction === undefined ? '' : ` ${Math.round(fraction * 100)} %`;
    this.label.textContent = t(key[stage]) + pct;
    this.bar.style.width = fraction === undefined ? '100%' : `${Math.round(fraction * 100)}%`;
    this.bar.style.opacity = fraction === undefined ? '0.45' : '1';
  }

  /** Garde l'erreur affichée jusqu'à ce qu'on la ferme : on doit pouvoir la lire. */
  fail(message: string): void {
    this.label.style.color = '#fca5a5';
    this.label.textContent = `⚠ ${message}`;
    this.bar.parentElement?.remove();
    const close = document.createElement('button');
    close.textContent = t('importClose');
    close.style.cssText = 'margin-top:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:7px;color:#cbd5e1;padding:6px 12px;font-size:11px;font-family:inherit;cursor:pointer;';
    close.addEventListener('click', () => this.done());
    this.el.appendChild(close);
  }

  done(): void {
    this.el.remove();
  }
}

/**
 * Propose d'ajouter les ouvrants reconnus, juste après l'import.
 *
 * Le moment où l'on vient de déposer sa maison est celui où l'on a envie de la
 * voir s'animer : on demande là, une fois, sans rien imposer.
 */
export function askOpenings(
  container: HTMLElement,
  doors: number,
  windows: number,
  onAccept: () => void,
): void {
  const box = document.createElement('div');
  box.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)',
    'z-index:300', 'width:min(360px,calc(100% - 32px))', 'box-sizing:border-box',
    'padding:14px 16px', 'border-radius:12px', 'pointer-events:auto',
    'background:rgba(8,13,26,0.94)', 'backdrop-filter:blur(10px)',
    'border:1px solid rgba(125,211,252,0.35)', 'color:#e2e8f0', FONT,
  ].join(';');
  const title = document.createElement('div');
  title.style.cssText = 'font-size:12.5px;font-weight:700;color:#7dd3fc;margin-bottom:6px;';
  title.textContent = t('sh3dFoundTitle')
    .replace('{doors}', String(doors))
    .replace('{windows}', String(windows));
  const body = document.createElement('div');
  body.style.cssText = 'font-size:11.5px;color:#94a3b8;line-height:1.5;margin-bottom:12px;';
  body.textContent = t('sh3dFoundHint');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const later = document.createElement('button');
  later.textContent = t('sh3dLater');
  later.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:7px;color:#cbd5e1;padding:6px 12px;font-size:11px;font-family:inherit;cursor:pointer;';
  later.addEventListener('click', () => box.remove());
  const add = document.createElement('button');
  add.textContent = t('sh3dAdd');
  add.style.cssText = 'background:rgba(125,209,252,0.2);border:1px solid rgba(125,209,252,0.45);border-radius:7px;color:#7dd3fc;padding:6px 12px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;';
  add.addEventListener('click', () => { box.remove(); onAccept(); });
  row.append(later, add);
  box.append(title, body, row);
  container.appendChild(box);
}
