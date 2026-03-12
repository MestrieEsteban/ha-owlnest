import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CardConfig, Hass, CameraView, OwlnestScene } from '../types';
import { saveScene, captureCameraView, normalizeViews } from '../scene';

export class ViewManager {
  private _panel: HTMLDivElement | null = null;
  private _saving = false;

  constructor(
    private overlayContainer: HTMLElement,
    private hudLeft: HTMLDivElement,
    private hudSep: HTMLDivElement,
    private getCamera: () => THREE.PerspectiveCamera | null,
    private getControls: () => OrbitControls | null,
    private getEffectiveConfig: () => CardConfig,
    private getHass: () => Hass | null,
    private getSceneId: () => string | undefined,
    private getScene: () => OwlnestScene | null,
    private onSceneUpdated: (scene: OwlnestScene) => void,
    private showToast: (msg: string, err?: boolean) => void,
    private setAnimTarget: (pos: THREE.Vector3, target: THREE.Vector3) => void,
    private getHudRight: () => HTMLDivElement | null,
  ) {}

  toggle() {
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
    } else {
      this._show();
    }
  }

  private _show() {
    this._panel?.remove();

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px',
      'width:260px', 'max-height:calc(100% - 80px)',
      'background:rgba(6,10,20,0.93)',
      'backdrop-filter:blur(18px)', '-webkit-backdrop-filter:blur(18px)',
      'border:1px solid rgba(255,255,255,0.09)',
      'border-radius:14px', 'overflow:hidden',
      'display:flex', 'flex-direction:column',
      'z-index:15', 'pointer-events:auto',
      'font-family:var(--primary-font-family,sans-serif)',
      'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    // Stop typing from triggering editor shortcuts
    panel.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) e.stopPropagation();
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;gap:6px;';
    const headerTitle = document.createElement('span');
    headerTitle.style.cssText = 'font-size:11px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.08em;flex:1;';
    headerTitle.textContent = '📷 Vues caméra';
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => { panel.remove(); this._panel = null; });
    header.appendChild(headerTitle);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Capture button
    const captureBar = document.createElement('div');
    captureBar.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    const captureBtn = document.createElement('button');
    captureBtn.style.cssText = [
      'width:100%', 'background:rgba(59,130,246,0.15)',
      'border:1px solid rgba(59,130,246,0.35)', 'border-radius:8px',
      'color:#93c5fd', 'padding:7px 10px', 'cursor:pointer',
      'font-size:11px', 'font-family:inherit', 'text-align:left',
      'transition:all .15s',
    ].join(';');
    captureBtn.textContent = '＋  Sauvegarder la vue actuelle';
    captureBtn.addEventListener('mouseenter', () => { captureBtn.style.background = 'rgba(59,130,246,0.28)'; captureBtn.style.borderColor = 'rgba(59,130,246,0.6)'; });
    captureBtn.addEventListener('mouseleave', () => { captureBtn.style.background = 'rgba(59,130,246,0.15)'; captureBtn.style.borderColor = 'rgba(59,130,246,0.35)'; });
    captureBtn.addEventListener('click', () => this._capturePrompt(listBody));
    captureBar.appendChild(captureBtn);
    panel.appendChild(captureBar);

    // List body
    const listBody = document.createElement('div');
    listBody.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:4px 0;';
    panel.appendChild(listBody);

    // No scene_id warning
    const sceneId = this.getSceneId();
    if (!sceneId) {
      const warn = document.createElement('div');
      warn.style.cssText = 'padding:10px 12px;font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.08);border-top:1px solid rgba(245,158,11,0.15);flex-shrink:0;';
      warn.textContent = '⚠ Pas de scene_id configuré — les vues ne seront pas persistées.';
      panel.appendChild(warn);
    }

    this._panel = panel;
    this.overlayContainer.appendChild(panel);
    this._rebuildList(listBody);
  }

  private _rebuildList(listBody: HTMLDivElement) {
    listBody.innerHTML = '';
    const views = normalizeViews(this.getEffectiveConfig().camera_views ?? []);

    if (views.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:18px 12px;font-size:11px;color:rgba(255,255,255,0.28);text-align:center;line-height:1.7;';
      empty.textContent = 'Aucune vue sauvegardée';
      listBody.appendChild(empty);
      return;
    }

    views.forEach((v) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 10px;transition:background .1s;';
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      // Label (click = fly to)
      const lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1;font-size:12px;color:#e2e8f0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;padding:2px 4px;transition:color .12s;';
      lbl.textContent = v.label;
      lbl.title = 'Aller à cette vue';
      lbl.addEventListener('mouseenter', () => { lbl.style.color = '#7dd3fc'; });
      lbl.addEventListener('mouseleave', () => { lbl.style.color = '#e2e8f0'; });
      lbl.addEventListener('click', () => { this.flyTo(v); this.highlightBtn(v.id); });
      row.appendChild(lbl);

      const iconBtnStyle = 'background:none;border:none;cursor:pointer;padding:3px 5px;font-size:12px;color:rgba(255,255,255,0.3);border-radius:4px;transition:all .12s;line-height:1;flex-shrink:0;';

      // Fly-to button
      const flyBtn = document.createElement('button');
      flyBtn.style.cssText = iconBtnStyle;
      flyBtn.textContent = '→';
      flyBtn.title = 'Aller à cette vue';
      flyBtn.addEventListener('mouseenter', () => { flyBtn.style.color = '#7dd3fc'; flyBtn.style.background = 'rgba(125,211,252,0.1)'; });
      flyBtn.addEventListener('mouseleave', () => { flyBtn.style.color = 'rgba(255,255,255,0.3)'; flyBtn.style.background = 'none'; });
      flyBtn.addEventListener('click', () => { this.flyTo(v); this.highlightBtn(v.id); });
      row.appendChild(flyBtn);

      // Update (overwrite with current camera)
      const updateBtn = document.createElement('button');
      updateBtn.style.cssText = iconBtnStyle;
      updateBtn.textContent = '⟳';
      updateBtn.title = 'Écraser avec la vue actuelle';
      updateBtn.addEventListener('mouseenter', () => { if (!updateBtn.dataset.confirm) { updateBtn.style.color = '#4ade80'; updateBtn.style.background = 'rgba(74,222,128,0.1)'; } });
      updateBtn.addEventListener('mouseleave', () => { if (!updateBtn.dataset.confirm) { updateBtn.style.color = 'rgba(255,255,255,0.3)'; updateBtn.style.background = 'none'; } });
      updateBtn.addEventListener('click', () => {
        if (updateBtn.dataset.confirm === '1') {
          updateBtn.dataset.confirm = '';
          updateBtn.textContent = '⟳';
          updateBtn.style.color = 'rgba(255,255,255,0.3)';
          updateBtn.style.background = 'none';
          this._updateView(v.id!, listBody);
        } else {
          updateBtn.dataset.confirm = '1';
          updateBtn.textContent = '✓?';
          updateBtn.style.color = '#4ade80';
          updateBtn.style.background = 'rgba(74,222,128,0.18)';
          setTimeout(() => {
            if (updateBtn.dataset.confirm === '1') {
              updateBtn.dataset.confirm = '';
              updateBtn.textContent = '⟳';
              updateBtn.style.color = 'rgba(255,255,255,0.3)';
              updateBtn.style.background = 'none';
            }
          }, 3000);
        }
      });
      row.appendChild(updateBtn);

      // Rename
      const renameBtn = document.createElement('button');
      renameBtn.style.cssText = iconBtnStyle;
      renameBtn.textContent = '✎';
      renameBtn.title = 'Renommer';
      renameBtn.addEventListener('mouseenter', () => { renameBtn.style.color = '#fbbf24'; renameBtn.style.background = 'rgba(251,191,36,0.1)'; });
      renameBtn.addEventListener('mouseleave', () => { renameBtn.style.color = 'rgba(255,255,255,0.3)'; renameBtn.style.background = 'none'; });
      renameBtn.addEventListener('click', () => this._renameInline(lbl, v.id!, listBody));
      row.appendChild(renameBtn);

      // Delete
      const delBtn = document.createElement('button');
      delBtn.style.cssText = iconBtnStyle;
      delBtn.textContent = '✕';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('mouseenter', () => { if (!delBtn.dataset.confirm) { delBtn.style.color = '#f87171'; delBtn.style.background = 'rgba(248,113,113,0.1)'; } });
      delBtn.addEventListener('mouseleave', () => { if (!delBtn.dataset.confirm) { delBtn.style.color = 'rgba(255,255,255,0.3)'; delBtn.style.background = 'none'; } });
      delBtn.addEventListener('click', () => {
        if (delBtn.dataset.confirm === '1') {
          this._deleteView(v.id!, listBody);
        } else {
          delBtn.dataset.confirm = '1';
          delBtn.textContent = '⚠';
          delBtn.title = 'Cliquer à nouveau pour confirmer';
          delBtn.style.color = '#f87171';
          delBtn.style.background = 'rgba(248,113,113,0.2)';
          setTimeout(() => {
            if (delBtn.dataset.confirm === '1') {
              delBtn.dataset.confirm = '';
              delBtn.textContent = '✕';
              delBtn.title = 'Supprimer';
              delBtn.style.color = 'rgba(255,255,255,0.3)';
              delBtn.style.background = 'none';
            }
          }, 3000);
        }
      });
      row.appendChild(delBtn);

      listBody.appendChild(row);
    });
  }

  private _capturePrompt(listBody: HTMLDivElement) {
    const camera = this.getCamera();
    const controls = this.getControls();
    if (!camera || !controls) return;

    // Replace capture button temporarily with an inline input
    const captureBar = listBody.previousElementSibling as HTMLDivElement;
    captureBar.innerHTML = '';

    const inputStyle = 'flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(125,211,252,0.4);border-radius:7px;color:#e2e8f0;padding:5px 8px;font-size:11px;font-family:inherit;outline:none;';
    const inp = document.createElement('input');
    inp.placeholder = 'Nom de la vue (ex: Salon)…';
    inp.style.cssText = inputStyle;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;';

    const okBtn = document.createElement('button');
    okBtn.textContent = '✓';
    okBtn.style.cssText = 'background:rgba(59,130,246,0.8);border:none;border-radius:7px;color:#fff;padding:5px 10px;cursor:pointer;font-size:12px;font-family:inherit;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.15);border-radius:7px;color:rgba(255,255,255,0.4);padding:5px 8px;cursor:pointer;font-size:12px;';

    const restore = () => {
      captureBar.innerHTML = '';
      const btn = document.createElement('button');
      btn.style.cssText = 'width:100%;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);border-radius:8px;color:#93c5fd;padding:7px 10px;cursor:pointer;font-size:11px;font-family:inherit;text-align:left;transition:all .15s;';
      btn.textContent = '＋  Sauvegarder la vue actuelle';
      btn.addEventListener('click', () => this._capturePrompt(listBody));
      captureBar.appendChild(btn);
    };

    const confirm = async () => {
      const label = inp.value.trim() || 'Vue sans nom';
      const pos = camera.position.toArray() as [number, number, number];
      const tgt = controls.target.toArray() as [number, number, number];
      const newView = captureCameraView(pos, tgt, label);
      const views = normalizeViews([...(this.getEffectiveConfig().camera_views ?? []), newView]);
      restore();
      await this.saveViews(views, listBody);
    };

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', restore);
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') restore();
    });

    row.appendChild(inp); row.appendChild(okBtn); row.appendChild(cancelBtn);
    captureBar.appendChild(row);
    setTimeout(() => inp.focus(), 30);
  }

  private async _updateView(id: string, listBody: HTMLDivElement) {
    const camera = this.getCamera();
    const controls = this.getControls();
    if (!camera || !controls) return;
    const pos = camera.position.toArray() as [number, number, number];
    const tgt = controls.target.toArray() as [number, number, number];
    const views = normalizeViews(this.getEffectiveConfig().camera_views ?? []).map((v) =>
      v.id === id ? { ...v, position: pos.map((x) => +x.toFixed(4)) as [number, number, number], target: tgt.map((x) => +x.toFixed(4)) as [number, number, number] } : v,
    );
    await this.saveViews(views, listBody);
  }

  private _renameInline(lbl: HTMLSpanElement, id: string, listBody: HTMLDivElement) {
    const current = lbl.textContent ?? '';
    const inp = document.createElement('input');
    inp.value = current;
    inp.style.cssText = 'flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(251,191,36,0.4);border-radius:4px;color:#e2e8f0;padding:1px 5px;font-size:12px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;';

    const commit = async () => {
      const label = inp.value.trim() || current;
      const views = normalizeViews(this.getEffectiveConfig().camera_views ?? []).map((v) =>
        v.id === id ? { ...v, label } : v,
      );
      await this.saveViews(views, listBody);
    };

    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { lbl.style.display = ''; inp.remove(); }
    });
    inp.addEventListener('blur', commit);

    lbl.style.display = 'none';
    lbl.parentElement!.insertBefore(inp, lbl);
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
  }

  private async _deleteView(id: string, listBody: HTMLDivElement) {
    const views = normalizeViews(this.getEffectiveConfig().camera_views ?? []).filter((v) => v.id !== id);
    await this.saveViews(views, listBody);
  }

  async saveViews(views: CameraView[], listBody?: HTMLDivElement) {
    const sceneId = this.getSceneId();
    const hass = this.getHass();
    if (!sceneId || !hass) {
      // No backend — update in-memory scene and refresh UI only
      const scene = this.getScene();
      if (scene) this.onSceneUpdated({ ...scene, camera_views: views });
      if (listBody) this._rebuildList(listBody);
      this.buildHUDBar();
      return;
    }
    if (this._saving) return;
    this._saving = true;
    try {
      const scene = this.getScene();
      // Build a scene object that preserves anchors but replaces camera_views
      const base: OwlnestScene = scene ?? {
        version: 1, scene_id: sceneId,
        model_url: this.getEffectiveConfig().model_url ?? '',
        anchors: [], camera_views: [], cards: [], rules: [],
      };
      const updated: OwlnestScene = { ...base, camera_views: views };
      await saveScene(hass, sceneId, updated);
      this.onSceneUpdated(updated);
    } catch (err) {
      console.error('[Owlnest] Failed to save views:', err);
      this.showToast('✗ Erreur lors de la sauvegarde des vues', true);
    } finally {
      this._saving = false;
    }
    if (listBody) this._rebuildList(listBody);
    this.buildHUDBar();
  }

  highlightBtn(id?: string) {
    if (!id) return;
    const views = normalizeViews(this.getEffectiveConfig().camera_views ?? []);
    const idx = views.findIndex((v) => v.id === id);
    const btn = this.hudLeft.children[idx] as HTMLButtonElement | undefined;
    if (!btn) return;
    const prev = btn.style.background;
    btn.style.background = 'rgba(125,211,252,0.25)';
    btn.style.color = '#fff';
    setTimeout(() => { btn.style.background = prev; btn.style.color = 'rgba(255,255,255,0.72)'; }, 600);
  }

  buildHUDBar() {
    this.hudLeft.innerHTML = '';

    const views = this.getEffectiveConfig().camera_views;
    const hasViews = !!(views?.length);
    const hudRight = this.getHudRight();
    const hasActions = !!(hudRight && hudRight.children.length > 0);
    this.hudSep.style.display = (hasViews && hasActions) ? 'block' : 'none';
    if (!hasViews) return;

    views!.forEach((v) => {
      const btn = document.createElement('button');
      btn.textContent = v.label;
      btn.style.cssText = [
        'background:transparent', 'border:none',
        'color:rgba(255,255,255,0.72)', 'cursor:pointer',
        'padding:3px 9px', 'font-size:12px',
        'font-family:var(--primary-font-family,sans-serif)',
        'border-radius:14px',
        'transition:background .15s, color .15s',
        'white-space:nowrap',
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,255,255,0.12)';
        btn.style.color = '#fff';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = 'rgba(255,255,255,0.72)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.flyTo(v);
      });
      this.hudLeft.appendChild(btn);
    });
  }

  flyTo(v: CameraView) {
    this.setAnimTarget(
      new THREE.Vector3(...v.position),
      new THREE.Vector3(...(v.target ?? [0, 0, 0])),
    );
  }
}
