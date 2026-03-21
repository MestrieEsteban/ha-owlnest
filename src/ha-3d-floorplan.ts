import * as THREE from 'three';


import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Hass, CardConfig, AnchorEntry, SavedView, EditableAnchor, OwlnestScene } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors, buildAnchorsFromEditable, rebuildAnchorLight, lightTargetPos } from './model';
import { AnchorOverlay, SensorOverlay, ClusterOverlay } from './overlay';
import type { ClusterItem } from './overlay';
import { AnchorEditor } from './editor';
import { loadScene, saveScene, listScenes, sceneToEffectiveConfig, buildSceneFromEditor, normalizeViews } from './scene';
import { setLang } from './i18n';
import './card-editor';
import { EnvironmentController } from './card/environment';
import { SimulationPanel } from './card/simulation';
import { ViewManager } from './card/view-manager';
import { EditPanel } from './card/edit-panel';
import { SceneCardRenderer } from './cards/renderer';
import { PanelGizmo } from './panels/gizmo';
import type { SceneCard, SceneCardType } from './cards/types';
import { evalCondition, triggerFired, conditionsMet } from './rules/engine';
import type { OwlnestRule, Action } from './rules/types';

type AnyOverlay = AnchorOverlay | SensorOverlay;

/** Format a sensor state string respecting optional decimal precision. */
function _formatSensorValue(raw: string, precision?: number): string {
  if (precision === undefined) return raw;
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  return num.toFixed(precision);
}

class Ha3dFloorplan extends HTMLElement {
  private _config: CardConfig | null = null;
  private _hass: Hass | null = null;

  // Scene backend
  private _scene: OwlnestScene | null = null;
  private _sceneLoading = false;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lockBtn: HTMLButtonElement | null = null;
  private editBtn: HTMLButtonElement | null = null;
  private _hud: HTMLDivElement | null = null;
  private _hudBar: HTMLDivElement | null = null;
  private _hudLeft: HTMLDivElement | null = null;
  private _hudSep: HTMLDivElement | null = null;
  private _hudRight: HTMLDivElement | null = null;
  private _hudViews: HTMLDivElement | null = null;
  private _lockOpenIcon = '🔓';
  private _lockClosedIcon = '🔒';
  private overlayContainer: HTMLDivElement | null = null;

  private anchors = new Map<string, AnchorEntry>();
  private overlays = new Map<string, AnyOverlay>();
  private _clusters = new Map<string, ClusterOverlay>();

  private rafId = 0;
  private ro: ResizeObserver | null = null;
  private modelLoaded = false;
  private _locked = false;
  private _editMode = false;

  private _dirty = false;
  private _lastTime = 0;

  // Overlay visibility (tap-to-toggle)
  private _overlaysVisible = true;
  private _tapStartTime = 0;
  private _tapStartPos = { x: 0, y: 0 };

  // Controls visibility (hover / touch reveal)
  private _controlsHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Camera animation
  private _camAnimTo: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  // Rules engine — tracks previous states to detect transitions
  private _prevEntityStates = new Map<string, string>();

  // Environment lights
  private _hemiLight: THREE.HemisphereLight | null = null;
  private _sunLight: THREE.DirectionalLight | null = null;
  private _sky: Sky | null = null;

  private _modelBox = new THREE.Box3();


  // Anchor editor
  private _editor: AnchorEditor | null = null;
  private _modelRoot: THREE.Object3D | null = null;
  private _savePending = false;  // true while a callWS is in flight

  // Modules
  private _env: EnvironmentController | null = null;
  private _sim: SimulationPanel | null = null;
  private _viewMgr: ViewManager | null = null;
  private _editPanel: EditPanel | null = null;

  // 3D Scene cards
  private _cardRenderer: SceneCardRenderer | null = null;
  private _cardPlacementMode = false;
  private _cardPlacementType: SceneCardType | null = null;

  // Card selection & grab
  private _selectedCardId: string | null = null;
  private _cardGrabMode = false;
  private _cardGrabOrigin: [number, number, number] | null = null;
  private _cardGrabPlane = new THREE.Plane();
  private _cardGrabRaycaster = new THREE.Raycaster();
  private _cardFocusId: string | null = null;

  // Card gizmo (shared with anchor editing)
  private _panelGizmo: PanelGizmo | null = null;
  private _gizmoDragAxis: 'x' | 'y' | 'z' | null = null;
  private _gizmoDragStartIntersect = new THREE.Vector3();
  private _gizmoDragCardStartPos = new THREE.Vector3();
  private _gizmoDragPlane = new THREE.Plane();
  private _preFocusPos: THREE.Vector3 | null = null;
  private _preFocusTarget: THREE.Vector3 | null = null;
  private _lastClickTime = 0;
  private _lastClickCardId: string | null = null;

  private _requestRender() { this._dirty = true; }

  // ── Persistence ───────────────────────────────────────────────────────

  private get _storageKey() {
    return `ha-3d-floorplan:${this._config?.model_url ?? 'default'}`;
  }

  private _loadView(): SavedView | null {
    try {
      const raw = localStorage.getItem(this._storageKey);
      return raw ? (JSON.parse(raw) as SavedView) : null;
    } catch { return null; }
  }

  private _getActiveSceneId(): string | undefined {
    return localStorage.getItem('owlnest_scene_id') ?? this._config?.scene_id ?? undefined;
  }

  private _saveView() {
    if (!this.camera || !this.controls) return;
    const view: SavedView = {
      pos: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      locked: this._locked,
    };
    localStorage.setItem(this._storageKey, JSON.stringify(view));
  }

  // ── HA lifecycle ──────────────────────────────────────────────────────

  setConfig(config: CardConfig) {
    const sceneChanged = config.scene_id !== this._config?.scene_id;
    this._config = config;
    if (sceneChanged) {
      this._scene = null;
      this._sceneLoading = false;
    }
    this._bootstrap();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    this._editor?.setHass(hass);

    // If scene_id is configured and scene hasn't been fetched yet, do it now.
    // _loadModel() is deferred until scene data is available.
    const activeSceneId = this._getActiveSceneId();
    if (activeSceneId && !this._scene && !this._sceneLoading) {
      this._sceneLoading = true;
      this._fetchAndLoadScene(activeSceneId);
      return;
    }

    if (this.modelLoaded && !this._editMode) {
      syncLights(this.anchors, hass, this._effectiveConfig);
      this._updateOverlayStates();
      // Skip real-entity weather/sun when simulation is overriding
      if (!this._sim?.isActive) this._env?.updateFromHass(hass);
      const cards = this._scene?.cards ?? [];
      if (cards.length > 0) {
        this._cardRenderer?.updateStates(hass);
      }
      this._evaluateRules();
      this._evaluatePassiveConditions();
      this._requestRender();
    }
  }

  static getStubConfig() {
    return { scene_id: 'main' };
  }

  static getConfigElement() {
    return document.createElement('ha-3d-floorplan-editor');
  }

  // ── Scene backend ─────────────────────────────────────────────────────

  /** Merged config: scene data overrides YAML config for model_url / anchors / camera_views */
  private get _effectiveConfig(): CardConfig {
    if (!this._scene) return this._config!;
    return sceneToEffectiveConfig(this._scene, this._config!);
  }

  private _fetchAndLoadScene(sceneId: string) {
    loadScene(this._hass!, sceneId)
      .then((scene) => {
        this._scene = scene;
        this._sceneLoading = false;
        if (scene.settings?.language) setLang(scene.settings.language);
        this._loadModel();
      })
      .catch((err) => {
        console.warn('[Owlnest] Scene load failed:', err);
        this._sceneLoading = false;
        // Fallback: load from Lovelace config if model_url is present
        if (this._config?.model_url) this._loadModel();
      });
  }

  async _saveScene() {
    const sceneId = this._getActiveSceneId();
    if (!sceneId || !this._hass || !this._editor) return;
    if (this._savePending) return;  // don't pile up concurrent saves

    const sceneData = buildSceneFromEditor(
      sceneId,
      this._editor.anchors as Map<string, EditableAnchor>,
      this._scene,
      this._config!,
    );
    // Preserve scene settings (env, rendering, language configured from Config tab)
    sceneData.settings = this._scene?.settings;

    this._savePending = true;
    try {
      await saveScene(this._hass, sceneId, sceneData);
      this._scene = sceneData;
      this._showToast('✓ Scène sauvegardée');
    } catch (err) {
      console.error('[Owlnest] Save failed:', err);
      this._showToast('✗ Erreur lors de la sauvegarde', true);
    } finally {
      this._savePending = false;
    }
  }

  private _showToast(message: string, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:absolute', 'top:12px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:200',
      `background:${isError ? 'rgba(220,38,38,0.9)' : 'rgba(22,163,74,0.9)'}`,
      'backdrop-filter:blur(8px)',
      'color:#fff', 'font-size:12px', 'font-weight:600',
      'padding:6px 16px', 'border-radius:20px',
      'pointer-events:none',
      'font-family:var(--primary-font-family,sans-serif)',
      'transition:opacity .3s ease',
    ].join(';');
    this.overlayContainer?.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    setTimeout(() => toast.remove(), 2400);
  }

  // ── Init ──────────────────────────────────────────────────────────────

  private _bootstrap() {
    if (this.renderer) this._teardown();

    const transparentBg = this._config?.rendering?.transparent_background === true;

    const card = document.createElement('ha-card');
    card.style.cssText = [
      'overflow:hidden',
      'position:relative',
      'display:block',
      transparentBg ? 'background:transparent' : 'background:#050a14',
      transparentBg ? '--ha-card-background:transparent' : '--ha-card-background:#050a14',
      '--ha-card-border-radius:12px',
      'padding:0',
    ].join(';');
    this.innerHTML = '';
    this.appendChild(card);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    card.appendChild(this.canvas);

    this.overlayContainer = document.createElement('div');
    this.overlayContainer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    card.appendChild(this.overlayContainer);

    // Inject custom CSS if configured
    if (this._config?.custom_css) {
      const styleEl = document.createElement('style');
      styleEl.id = 'owlnest-custom-css';
      styleEl.textContent = this._config.custom_css;
      card.appendChild(styleEl);
    }

    // ── Unified HUD ───────────────────────────────────────────────────────
    const ui = this._config?.ui ?? {};
    const uiIcons = ui.icons ?? {};
    this._lockOpenIcon  = uiIcons.lock_open   ?? '🔓';
    this._lockClosedIcon = uiIcons.lock_closed ?? '🔒';

    // Hud: bottom-right corner, holds lock + pencil in normal mode.
    // In edit mode, repositioned to center and bar glassmorphism is restored.
    const hud = document.createElement('div');
    hud.style.cssText = [
      'position:absolute', 'bottom:12px', 'right:12px',
      'z-index:10',
      'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:6px',
      'opacity:0', 'transition:opacity .25s ease',
      'pointer-events:none',
    ].join(';');
    this._hud = hud;
    card.appendChild(hud);

    // Bar — invisible in normal mode, glassmorphism restored in edit mode
    const bar = document.createElement('div');
    bar.style.cssText = [
      'display:flex', 'align-items:center',
      'border-radius:20px',
      'padding:5px 8px', 'gap:2px',
      'pointer-events:auto',
      'white-space:nowrap',
    ].join(';');
    this._hudBar = bar;
    hud.appendChild(bar);

    // Camera views pill — separate bottom-center element (normal mode only)
    const hudViews = document.createElement('div');
    hudViews.style.cssText = [
      'position:absolute', 'bottom:12px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:10', 'display:none',
      'align-items:center', 'gap:2px',
      'background:rgba(8,12,24,0.72)',
      'backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)',
      'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:20px', 'padding:5px 8px',
      'pointer-events:auto',
      'opacity:0', 'transition:opacity .25s ease',
    ].join(';');
    this._hudViews = hudViews;
    card.appendChild(hudViews);

    // Left: camera views (only used in edit mode toolbar)
    const hudLeft = document.createElement('div');
    hudLeft.style.cssText = 'display:flex;align-items:center;gap:2px;';
    this._hudLeft = hudLeft;
    bar.appendChild(hudLeft);

    // Separator (kept for edit-mode compat, hidden in normal mode)
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 4px;flex-shrink:0;display:none;';
    this._hudSep = sep;
    bar.appendChild(sep);

    // Right: lock + pencil only
    const hudRight = document.createElement('div');
    hudRight.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
    this._hudRight = hudRight;
    bar.appendChild(hudRight);

    if (ui.show_lock !== false) {
      this.lockBtn = this._makeLockBtn();
      hudRight.appendChild(this.lockBtn);
    }
    if (ui.show_editor !== false) {
      this.editBtn = this._makeEditBtn(uiIcons.editor ?? '✏️');
      hudRight.appendChild(this.editBtn);
    }

    // Hover (desktop) — show/hide HUD
    card.addEventListener('mouseenter', () => this._showControls());
    card.addEventListener('mouseleave', () => this._hideControls());
    // Any pointer interaction keeps HUD visible (fixes disappearing buttons on click)
    card.addEventListener('pointerdown', () => this._showControls());
    // Touch — show HUD for 4 seconds on tap
    card.addEventListener('touchstart', () => this._showControlsTemporarily(), { passive: true });

    // Canvas tap detection for overlay toggle + panel direct drag in edit mode
    this.canvas!.addEventListener('pointerdown', (e) => {
      this._tapStartTime = e.timeStamp;
      this._tapStartPos = { x: e.clientX, y: e.clientY };

      // Edit mode: start panel drag directly on pointerdown (no G key needed)
      if (this._editMode && e.button === 0 && !this._cardPlacementMode && this.camera && this.canvas) {
        const rect = this.canvas!.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );

        // First: check gizmo handles if a card is selected
        if (this._selectedCardId && this._panelGizmo?.visible) {
          const gizmoRay = new THREE.Raycaster();
          gizmoRay.setFromCamera(ndc, this.camera!);
          const gizmoHits = gizmoRay.intersectObjects(this._panelGizmo.getMeshes(), false);
          if (gizmoHits.length) {
            const axis = this._panelGizmo.getAxis(gizmoHits[0].object as THREE.Mesh);
            if (axis) {
              const card = this._cardRenderer?.getCard(this._selectedCardId)!;
              const cardPos = new THREE.Vector3(...card.position);
              this._editPanel?.pushCardSnapshot();
              this._gizmoDragAxis = axis;
              this._gizmoDragCardStartPos.copy(cardPos);

              // Compute drag plane: perpendicular to the camera's view direction on the chosen axis
              const axisVec = axis === 'x' ? new THREE.Vector3(1, 0, 0)
                : axis === 'y' ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
              const camFwd = new THREE.Vector3();
              this.camera!.getWorldDirection(camFwd);
              let planeNormal = new THREE.Vector3().crossVectors(axisVec, camFwd);
              if (planeNormal.lengthSq() < 0.001) planeNormal.set(0, 1, 0);
              else planeNormal.normalize();
              this._gizmoDragPlane.setFromNormalAndCoplanarPoint(planeNormal, cardPos);

              // Get initial intersection point on the drag plane
              gizmoRay.ray.intersectPlane(this._gizmoDragPlane, this._gizmoDragStartIntersect);

              if (this.controls) this.controls.enabled = false;
              e.stopPropagation();
              return;
            }
          }
        }

        // Then: check card mesh hit
        const hit = this._cardRenderer?.handleClick(ndc);
        if (hit) {
          this._selectedCardId = hit;
          this._cardRenderer?.setSelectedId(hit);
          this._editor?.selectAnchor('');
          this._editPanel?.updateAnchorList();
          const card = this._cardRenderer?.getCard(hit);
          if (card) {
            // Show gizmo at card position
            const cardPos = new THREE.Vector3(...card.position);
            this._panelGizmo?.setPosition(cardPos);
            this._panelGizmo?.setVisible(true);
            this._panelGizmo?.updateScale(this.camera!);

            this._editPanel?.pushCardSnapshot();
            this._cardGrabMode = true;
            this._cardGrabOrigin = [...card.position] as [number, number, number];
            const camFwd = new THREE.Vector3();
            this.camera!.getWorldDirection(camFwd);
            camFwd.negate();
            this._cardGrabPlane.setFromNormalAndCoplanarPoint(camFwd, cardPos);
            if (this.controls) this.controls.enabled = false;
          }
        }
      }
    });

    this.canvas!.addEventListener('pointermove', (e) => {
      if (!this.camera || !this.canvas) return;
      const rect = this.canvas!.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      // Gizmo hover highlight (when not dragging)
      if (this._editMode && this._selectedCardId && this._panelGizmo?.visible && !this._gizmoDragAxis && !this._cardGrabMode) {
        const hoverRay = new THREE.Raycaster();
        hoverRay.setFromCamera(ndc, this.camera!);
        const hoverHits = hoverRay.intersectObjects(this._panelGizmo.getMeshes(), false);
        const hovAxis = hoverHits.length ? this._panelGizmo.getAxis(hoverHits[0].object as THREE.Mesh) : null;
        this._panelGizmo.setHover(hovAxis);
      }

      // Card hover highlight (normal mode)
      if (!this._editMode && this._cardRenderer) {
        const hoveredId = this._cardRenderer.handleHover(ndc);
        this._cardRenderer.setHoveredId(hoveredId);
      }

      // Gizmo axis drag
      if (this._gizmoDragAxis && this._selectedCardId) {
        const dragRay = new THREE.Raycaster();
        dragRay.setFromCamera(ndc, this.camera!);
        const currentIntersect = new THREE.Vector3();
        if (dragRay.ray.intersectPlane(this._gizmoDragPlane, currentIntersect)) {
          const delta = currentIntersect.clone().sub(this._gizmoDragStartIntersect);
          const axisVec = this._gizmoDragAxis === 'x' ? new THREE.Vector3(1, 0, 0)
            : this._gizmoDragAxis === 'y' ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
          const movement = delta.dot(axisVec);
          const newPos = this._gizmoDragCardStartPos.clone().addScaledVector(axisVec, movement);
          this._cardRenderer?.previewPosition(this._selectedCardId, newPos);
          this._panelGizmo?.setPosition(newPos);
          this._requestRender();
        }
        return;
      }

      // Card free drag (grab mode)
      if (this._cardGrabMode && this._selectedCardId) {
        this._cardGrabRaycaster.setFromCamera(ndc, this.camera!);
        const target = new THREE.Vector3();
        if (this._cardGrabRaycaster.ray.intersectPlane(this._cardGrabPlane, target)) {
          this._cardRenderer?.previewPosition(this._selectedCardId, target);
          this._panelGizmo?.setPosition(target);
          this._requestRender();
        }
      }
    });

    this.canvas!.addEventListener('pointerup', (e) => {
      // Gizmo axis drag end — confirm position
      if (this._gizmoDragAxis && e.button === 0) {
        this._gizmoDragAxis = null;
        if (this.controls) this.controls.enabled = !this._locked;
        this._panelGizmo?.setHover(null);

        if (this._selectedCardId) {
          const mesh = this._cardRenderer?.getMeshes().find(m => m.userData.cardId === this._selectedCardId);
          if (mesh) {
            const newPos: [number, number, number] = [
              +mesh.position.x.toFixed(4),
              +mesh.position.y.toFixed(4),
              +mesh.position.z.toFixed(4),
            ];
            const cards = (this._scene?.cards ?? []).map(c =>
              c.id === this._selectedCardId ? { ...c, position: newPos } : c,
            );
            this._saveCardsDirect(cards);
          }
        }
        return;
      }

      // Card grab confirm or cancel (if barely moved = select only)
      if (this._cardGrabMode && e.button === 0) {
        const dx = e.clientX - this._tapStartPos.x;
        const dy = e.clientY - this._tapStartPos.y;
        if (Math.hypot(dx, dy) < 5) {
          // Just a click to select, not a real drag — cancel without saving
          this._cardGrabMode = false;
          this._cardGrabOrigin = null;
          if (this.controls) this.controls.enabled = !this._locked;
          this._editPanel?.hideStatusBar();
        } else {
          this._confirmCardGrab();
        }
        return;
      }

      const dt = e.timeStamp - this._tapStartTime;
      const dx = e.clientX - this._tapStartPos.x;
      const dy = e.clientY - this._tapStartPos.y;
      const isTap = dt < 250 && Math.hypot(dx, dy) < 10;

      // Edit mode
      if (this._editMode && isTap) {
        const rect = this.canvas!.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );

        // Card placement mode takes priority
        if (this._cardPlacementMode && this._cardPlacementType && this.scene && this.camera) {
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(ndc, this.camera!);
          const objects: THREE.Object3D[] = [];
          this.scene!.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.cardId) objects.push(o); });
          const hits = raycaster.intersectObjects(objects, false);
          if (hits.length === 0) {
            // Click outside model — cancel placement
            this._cardPlacementMode = false;
            this._cardPlacementType = null;
            this._editPanel?.hideStatusBar();
            if (this.canvas) this.canvas.style.cursor = '';
            return;
          }
          const pos: [number, number, number] = [
            +hits[0].point.x.toFixed(3),
            +(hits[0].point.y + 0.5).toFixed(3),
            +hits[0].point.z.toFixed(3),
          ];
          this._placeNewCard(this._cardPlacementType, pos);
          return;
        }

        // Deselect if clicked outside a card
        const hit = this._cardRenderer?.handleClick(ndc);
        if (!hit && this._selectedCardId) {
          this._selectedCardId = null;
          this._cardRenderer?.setSelectedId(null);
          this._panelGizmo?.setVisible(false);
          this._editPanel?.updateAnchorList();
        }
        return;
      }

      if (this._editMode) return;

      // Card fly-to double click (normal mode)
      if (isTap) {
        const rect = this.canvas!.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const hitCardId = this._cardRenderer?.handleClick(ndc);
        if (hitCardId) {
          const now = e.timeStamp;
          if (now - this._lastClickTime < 400 && this._lastClickCardId === hitCardId) {
            if (this._cardFocusId === hitCardId) {
              this._exitCardFocus();
            } else {
              this._enterCardFocus(hitCardId);
            }
            this._lastClickTime = 0;
            this._lastClickCardId = null;
          } else {
            this._lastClickTime = now;
            this._lastClickCardId = hitCardId;
          }
          return;
        } else {
          this._lastClickCardId = null;
        }

        // Tap to toggle overlays
        if (this._config?.tap_to_toggle) {
          this._toggleOverlays();
        }
      }
    });

    this._initThree(card);

    this.ro = new ResizeObserver(() => this._onResize());
    this.ro.observe(card);

    // If scene_id is set, defer model loading until hass is available.
    // The hass setter will call _fetchAndLoadScene → _loadModel.
    if (!this._getActiveSceneId() && !this._config?.model_url) {
      this._showSetupOverlay();
    } else if (!this._getActiveSceneId() || this._scene) {
      this._loadModel();
    }
  }

  private _showSetupOverlay() {
    const card = this.querySelector('ha-card') as HTMLElement;
    if (!card) return;

    const overlay = document.createElement('div');
    overlay.id = 'owlnest-setup-overlay';
    overlay.style.cssText = [
      'position:absolute', 'inset:0',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'background:rgba(6,10,20,0.92)',
      'backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)',
      'z-index:50', 'padding:24px', 'box-sizing:border-box',
      'font-family:var(--primary-font-family,sans-serif)',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:700;color:#7dd3fc;letter-spacing:.06em;margin-bottom:6px;';
    title.textContent = 'Owlnest';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:24px;letter-spacing:.04em;';
    subtitle.textContent = '3D Floorplan';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;align-self:flex-start;max-width:280px;width:100%;';
    label.textContent = 'Scene ID';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:6px;width:100%;max-width:280px;margin-bottom:16px;';

    const input = document.createElement('input');
    input.placeholder = 'my_home';
    input.style.cssText = [
      'flex:1', 'background:rgba(255,255,255,0.05)', 'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:8px', 'color:#e2e8f0', 'padding:8px 10px',
      'font-size:12px', 'outline:none', 'font-family:inherit',
    ].join(';');
    input.setAttribute('list', 'owlnest-scenes-dl');

    const dl = document.createElement('datalist');
    dl.id = 'owlnest-scenes-dl';
    if (this._hass) {
      listScenes(this._hass).then((ids) => ids.forEach((id) => {
        const opt = document.createElement('option'); opt.value = id; dl.appendChild(opt);
      })).catch(() => {});
    }

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.style.cssText = [
      'background:rgba(125,209,252,0.15)', 'border:1px solid rgba(125,209,252,0.3)',
      'border-radius:8px', 'color:#7dd3fc', 'padding:8px 14px',
      'font-size:12px', 'font-family:inherit', 'cursor:pointer', 'white-space:nowrap',
    ].join(';');
    loadBtn.addEventListener('click', () => {
      const id = input.value.trim();
      if (!id) return;
      localStorage.setItem('owlnest_scene_id', id);
      overlay.remove();
      this._bootstrap();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBtn.click(); });

    inputRow.appendChild(input);
    inputRow.appendChild(dl);
    inputRow.appendChild(loadBtn);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.25);max-width:280px;width:100%;line-height:1.6;';
    hint.innerHTML = 'Also add to your Lovelace YAML:<br><code style="background:rgba(255,255,255,0.07);border-radius:4px;padding:2px 6px;color:#93c5fd;">model_url: /local/model.glb</code>';

    overlay.appendChild(title);
    overlay.appendChild(subtitle);
    overlay.appendChild(label);
    overlay.appendChild(inputRow);
    overlay.appendChild(hint);
    this.overlayContainer?.appendChild(overlay);
  }

  private _makeLockBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = this._lockOpenIcon;
    btn.title = 'Verrouiller la vue';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleLock(); });
    return btn;
  }

  private _makeEditBtn(icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = this._hudBtnStyle();
    btn.textContent = icon;
    btn.title = 'Editer les ancres';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleEditMode(); });
    return btn;
  }

  private _hudBtnStyle(): string {
    return [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'width:32px', 'height:32px',
      'border:1px solid rgba(255,255,255,0.1)', 'border-radius:50%',
      'background:rgba(8,12,24,0.70)',
      'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)',
      'color:rgba(255,255,255,0.7)', 'cursor:pointer',
      'font-size:15px', 'line-height:1',
      'flex-shrink:0',
      'transition:background .15s, box-shadow .15s, border-color .15s',
    ].join(';');
  }

  // ── Controls visibility ────────────────────────────────────────────────

  private _showControls() {
    if (!this._hud) return;
    this._hud.style.opacity = '1';
    this._hud.style.pointerEvents = 'auto';
    if (this._hudViews) { this._hudViews.style.opacity = '1'; this._hudViews.style.pointerEvents = 'auto'; }
  }

  private _hideControls() {
    if (this._editMode) return;
    if (this._sim?.isOpen) return; // keep visible while sim panel is open
    if (!this._hud) return;
    this._hud.style.opacity = '0';
    this._hud.style.pointerEvents = 'none';
    if (this._hudViews) { this._hudViews.style.opacity = '0'; this._hudViews.style.pointerEvents = 'none'; }
  }

  private _showControlsTemporarily() {
    this._showControls();
    if (this._controlsHideTimer) clearTimeout(this._controlsHideTimer);
    this._controlsHideTimer = setTimeout(() => this._hideControls(), 4000);
  }

  // ── Overlay toggle ─────────────────────────────────────────────────────

  private _overlayHideBadge: HTMLDivElement | null = null;

  private _toggleOverlays() {
    this._overlaysVisible = !this._overlaysVisible;
    this.overlays.forEach((o) => {
      o.el.style.display = this._overlaysVisible ? '' : 'none';
    });
    this._clusters.forEach((c) => {
      if (!this._overlaysVisible) c.hide();
    });
    this._syncOverlayHideBadge();
  }

  private _syncOverlayHideBadge() {
    if (!this.overlayContainer) return;
    if (this._overlaysVisible) {
      if (this._overlayHideBadge) {
        this._overlayHideBadge.style.opacity = '0';
        setTimeout(() => { this._overlayHideBadge?.remove(); this._overlayHideBadge = null; }, 250);
      }
      return;
    }
    if (!this._overlayHideBadge) {
      const badge = document.createElement('div');
      badge.style.cssText = [
        'position:absolute', 'top:10px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(0,0,0,0.72)', 'backdrop-filter:blur(8px)',
        'border:1px solid rgba(255,255,255,0.15)', 'border-radius:20px',
        'color:rgba(255,255,255,0.7)', 'font-size:11px',
        'font-family:var(--primary-font-family,sans-serif)',
        'padding:4px 12px', 'pointer-events:none', 'z-index:20',
        'display:flex', 'align-items:center', 'gap:5px',
        'opacity:0', 'transition:opacity .2s ease',
        'white-space:nowrap',
      ].join(';');
      badge.innerHTML = '<span style="font-size:13px">🙈</span> Overlays masqués — tapez pour afficher';
      this.overlayContainer.appendChild(badge);
      this._overlayHideBadge = badge;
      requestAnimationFrame(() => { badge.style.opacity = '1'; });
    }
  }

  private _toggleLock(force?: boolean) {
    this._locked = force !== undefined ? force : !this._locked;
    if (this.controls) this.controls.enabled = !this._locked && !this._editMode;
    this.lockBtn!.textContent = this._locked ? this._lockClosedIcon : this._lockOpenIcon;
    this.lockBtn!.title = this._locked ? 'Déverrouiller la vue' : 'Verrouiller la vue';
    this.lockBtn!.style.boxShadow = this._locked ? '0 0 0 2px rgba(239,68,68,0.8)' : 'none';
    this._saveView();
  }

  // ── Edit mode ─────────────────────────────────────────────────────────

  private _toggleEditMode() {
    if (!this.modelLoaded || !this._modelRoot) return;
    this._editMode ? this._exitEditMode() : this._enterEditMode();
  }

  private _enterEditMode() {
    this._editMode = true;
    if (this.editBtn) {
      this.editBtn.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.9)';
      this.editBtn.title = 'Quitter le mode édition';
    }
    // Reposition HUD to center + restore bar glassmorphism for edit toolbar
    if (this._hud) {
      this._hud.style.bottom = '12px';
      this._hud.style.right = 'auto';
      this._hud.style.left = '50%';
      this._hud.style.transform = 'translateX(-50%)';
      this._hud.style.alignItems = 'stretch';
    }
    if (this._hudBar) {
      this._hudBar.style.background = 'rgba(8,12,24,0.72)';
      this._hudBar.style.backdropFilter = 'blur(12px)';
      this._hudBar.style.webkitBackdropFilter = 'blur(12px)';
      this._hudBar.style.border = '1px solid rgba(255,255,255,0.1)';
    }
    // Hide view pill; move buttons back to _hudLeft for showToolbar() to use
    if (this._hudViews && this._hudLeft) {
      this._hudLeft.innerHTML = '';
      Array.from(this._hudViews.children).forEach(b => this._hudLeft!.appendChild(b));
      this._hudViews.style.display = 'none';
      this._hudViews.style.opacity = '0';
    }
    this._showControls();

    this.overlays.forEach((o) => { o.el.style.display = 'none'; });
    this._clusters.forEach((c) => c.hide());

    const editable = new Map<string, EditableAnchor>();
    this.anchors.forEach((entry, key) => {
      editable.set(key, {
        entity: entry.entityId,
        position: entry.worldPos.clone(),
        label: entry.label,
        hidden: entry.hidden,
        lightStyle: entry.lightStyle,
        lightIntensity: entry.lightIntensity,
        lightDirection: entry.lightDirection,
        visibleIf: entry.visibleIf,
        precision: entry.precision,
        icon: entry.icon,
      });
    });

    if (!this._editor) {
      this._editor = new AnchorEditor(
        this.scene!,
        this.camera!,
        this.canvas!,
        this._modelRoot!,
        this.overlayContainer!,
      );
    }

    // Close sim panel if open (it lives in Config tab in edit mode)
    if (this._sim?.isOpen) this._sim.toggle();

    // Instantiate EditPanel now (needs editor, hud refs, and card container)
    const card = this.querySelector('ha-card') as HTMLElement;
    this._editPanel = new EditPanel(
      this.overlayContainer!,
      this._hud!,
      this._hudLeft!,
      this._hudRight!,
      this._hudSep!,
      card,
      () => this._editor,
      () => this._hass,
      () => this._config,
      () => this._getActiveSceneId(),
      () => this._saveScene(),
      () => this._exitEditMode(),
      () => this._syncEditorLightsToScene(),
      () => this._requestRender(),
      () => this._rebuildNormalHUD(),
      () => this._scene?.cards ?? [],
      async (cards) => this._saveCardsDirect(cards),
      () => this._selectedCardId,
      (id) => {
        this._selectedCardId = id;
        this._cardRenderer?.setSelectedId(id);
      },
      (type) => this._startCardPlacement(type),
      () => this._scene?.rules ?? [],
      async (rules) => this._saveRulesDirect(rules),
      () => normalizeViews(this._scene?.camera_views ?? []),
      () => this._sim,
      () => this._viewMgr,
      () => this._scene?.settings ?? {},
      (s: import('./types').SceneSettings, reloadScene?: boolean) => {
        if (!this._scene) this._scene = {
          version: 1, scene_id: this._getActiveSceneId() ?? '',
          model_url: this._config?.model_url ?? '',
          anchors: [], camera_views: [], cards: [], rules: [],
        };
        this._scene = { ...this._scene, settings: { ...this._scene.settings, ...s } };
        if (s.language) setLang(s.language);
        if (reloadScene) {
          // scene_id was changed — store in localStorage and reload
          const newId = (s as Record<string, unknown>)['scene_id'] as string | undefined;
          if (newId) {
            localStorage.setItem('owlnest_scene_id', newId);
            this._scene = null;
            this._sceneLoading = false;
            if (this._hass) this._fetchAndLoadScene(newId);
          }
        }
        this._applySettingsLive();
        this._editPanel?.scheduleAutoSave();
        this._requestRender();
      },
      async () => {
        if (!this._hass) return [];
        return listScenes(this._hass).catch(() => []);
      },
    );

    this._editor.onChanged = () => {
      this._syncEditorLightsToScene();
      this._evaluatePassiveConditions();
      this._requestRender();
      if (!this._editPanel?.editorDragging && !this._editPanel?.gizmoDragging) this._editPanel?.updateAnchorList();
      // Don't schedule auto-save in the middle of a gizmo drag — wait for drag end
      if (!this._editPanel?.gizmoDragging) this._editPanel?.scheduleAutoSave();
    };
    this._editor.onDragStart = (type) => {
      if (this._editPanel) this._editPanel.gizmoDragging = true;
      const texts: Record<string, string> = {
        grab:   'Déplacer  ·  X/Y/Z axe  ·  Entrée confirmer  ·  Esc annuler',
        rotate: 'Orienter  ·  Esc quitter',
        gizmo:  'Déplacer sur axe  ·  Relâcher pour confirmer',
      };
      this._editPanel?.showStatusBar(texts[type] ?? '');
    };
    this._editor.onDragEnd = () => {
      if (this._editPanel) this._editPanel.gizmoDragging = false;
      this._editPanel?.hideStatusBar();
      this._editPanel?.updateAnchorList();  // refresh Az/El readout etc.
      this._editPanel?.scheduleAutoSave();  // save once when drag finishes
    };
    this._editor.onSelectionChange = () => this._editPanel?.updateAnchorList();
    this._editor.onToolChange = (_tool) => {
      // Card placement is triggered from the sidebar, not from a tool button
    };
    this._editor.setHass(this._hass);
    this._editor.activate(editable);

    document.addEventListener('keydown', this._onCardKeyDown);

    this._editPanel.showToolbar();
    this._requestRender();

    if (editable.size === 0) {
      const hint = document.createElement('div');
      hint.id = 'ha-editor-hint';
      hint.style.cssText = [
        'position:absolute', 'top:50%', 'left:50%',
        'transform:translate(-50%,-50%)',
        'background:rgba(26,107,255,0.18)',
        'border:1px dashed rgba(26,107,255,0.5)',
        'border-radius:10px',
        'padding:12px 20px',
        'color:rgba(255,255,255,0.7)',
        'font-size:13px',
        'font-family:var(--primary-font-family,sans-serif)',
        'text-align:center',
        'pointer-events:none',
        'z-index:30',
      ].join(';');
      hint.textContent = 'Clique sur le modèle pour placer une ancre';
      this.overlayContainer!.appendChild(hint);
      setTimeout(() => hint.remove(), 4000);
    }
  }

  private _exitEditMode() {
    this._editMode = false;
    if (this.editBtn) {
      this.editBtn.style.boxShadow = 'none';
      this.editBtn.title = 'Editer les ancres';
    }

    document.removeEventListener('keydown', this._onCardKeyDown);
    this._selectedCardId = null;
    this._cardGrabMode = false;
    this._cardPlacementMode = false;
    this._cardPlacementType = null;
    this._gizmoDragAxis = null;
    this._cardRenderer?.setSelectedId(null);
    this._cardRenderer?.setHoveredId(null);
    this._panelGizmo?.setVisible(false);
    this._panelGizmo?.setHover(null);
    if (this.controls) this.controls.enabled = !this._locked;

    // Flush pending auto-save immediately
    if (this._editPanel?.hasPendingSave) {
      this._editPanel.cancelPendingSave();
      this._saveScene();
    }
    this._editPanel?.markSaved();

    const editable = new Map<string, EditableAnchor>(this._editor!.anchors as Map<string, EditableAnchor>);
    this._editor!.deactivate();

    this.anchors.forEach((entry) => {
      if (entry.light) {
        this.scene?.remove(entry.light);
        entry.light.dispose();
      }
      if (entry.lightTarget) this.scene?.remove(entry.lightTarget);
    });

    this.anchors = buildAnchorsFromEditable(editable, this.scene!, this._config!);

    if (this.controls) this.controls.enabled = !this._locked;

    this._createOverlays();
    if (this._hass) {
      syncLights(this.anchors, this._hass, this._config);
      this._updateOverlayStates();
    }

    this._editPanel?.hideToolbar();
    this._editPanel = null;
    this.overlays.forEach((o) => {
      o.el.style.display = this._overlaysVisible ? '' : 'none';
    });
    this._requestRender();
  }

  // ── Real-time light sync from editor ──────────────────────────────────

  private _syncEditorLightsToScene() {
    if (!this._editor || !this.scene) return;
    this._editor.anchors.forEach((ea, key) => {
      const entry = this.anchors.get(key);
      if (!entry) return;

      // Always sync position (gizmo drag)
      entry.worldPos.copy(ea.position);
      entry.visibleIf = ea.visibleIf;
      if (entry.light) entry.light.position.copy(ea.position);
      if (entry.lightTarget) {
        entry.lightTarget.position.copy(lightTargetPos(ea.position, ea.lightDirection));
        entry.lightTarget.updateMatrixWorld();
      }

      const newStyle = ea.lightStyle ?? 'point';
      const oldStyle = entry.lightStyle ?? 'point';

      if (ea.entity.split('.')[0] === 'light' && newStyle !== oldStyle) {
        // Rebuild light with new style
        rebuildAnchorLight(entry, this.scene!, this._config!, newStyle, ea.lightDirection);
        // Restore last intensity
        if (entry.light) {
          entry.light.intensity = entry.targetIntensity;
          entry.light.color.copy(entry.targetColor);
          entry.light.visible = entry.targetIntensity > 0.01;
        }
      } else if ((newStyle === 'spot' || newStyle === 'beam') && entry.lightTarget) {
        // Update direction only
        const newDir = ea.lightDirection;
        const oldDir = entry.lightDirection;
        const dirChanged = !newDir !== !oldDir ||
          (newDir && oldDir && (newDir[0] !== oldDir[0] || newDir[1] !== oldDir[1] || newDir[2] !== oldDir[2]));
        if (dirChanged) {
          entry.lightTarget.position.copy(lightTargetPos(ea.position, ea.lightDirection));
          entry.lightTarget.updateMatrixWorld();
          entry.lightDirection = ea.lightDirection;
        }
      }
    });
  }

  // ── Panel keyboard handler ─────────────────────────────────────────────

  private _onCardKeyDown = (e: KeyboardEvent) => {
    if (!this._editMode) return;
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot) el = el.shadowRoot.activeElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) return;

    // Escape cancels placement mode
    if (e.key === 'Escape' && this._cardPlacementMode) {
      this._cardPlacementMode = false;
      this._cardPlacementType = null;
      this._editPanel?.hideStatusBar();
      if (this.canvas) this.canvas.style.cursor = '';
      this._editPanel?.updateAnchorList();
      e.preventDefault();
      return;
    }

    if (!this._selectedCardId) return;

    if ((e.key === 'g' || e.key === 'G') && !this._cardGrabMode) {
      const card = this._cardRenderer?.getCard(this._selectedCardId);
      if (!card) return;
      this._editPanel?.pushCardSnapshot();
      this._cardGrabMode = true;
      this._cardGrabOrigin = [...card.position] as [number, number, number];
      if (this.camera) {
        const camFwd = new THREE.Vector3();
        this.camera.getWorldDirection(camFwd);
        camFwd.negate();
        this._cardGrabPlane.setFromNormalAndCoplanarPoint(camFwd, new THREE.Vector3(...card.position));
      } else {
        this._cardGrabPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...card.position));
      }
      this._editPanel?.showStatusBar('Déplacer carte  ·  Entrée confirmer  ·  Esc annuler');
      e.preventDefault();
    }
    if (this._cardGrabMode) {
      if (e.key === 'Enter') { this._confirmCardGrab(); e.preventDefault(); }
      if (e.key === 'Escape') { this._cancelCardGrab(); e.preventDefault(); }
    }
    if ((e.key === 'Delete' || e.key === 'x' || e.key === 'X') && !this._cardGrabMode) {
      this._deleteSelectedCard();
      e.preventDefault();
    }
  };

  private _confirmCardGrab() {
    if (!this._cardGrabMode || !this._selectedCardId) return;
    this._cardGrabMode = false;
    this._cardGrabOrigin = null;
    if (this.controls) this.controls.enabled = !this._locked;
    this._editPanel?.hideStatusBar();

    const mesh = this._cardRenderer?.getMeshes().find((m) => m.userData.cardId === this._selectedCardId);
    if (!mesh) return;
    const newPos: [number, number, number] = [
      +mesh.position.x.toFixed(4),
      +mesh.position.y.toFixed(4),
      +mesh.position.z.toFixed(4),
    ];
    this._panelGizmo?.setPosition(mesh.position);
    this._panelGizmo?.setVisible(true);

    const cards = (this._scene?.cards ?? []).map((c) =>
      c.id === this._selectedCardId ? { ...c, position: newPos } : c,
    );
    this._saveCardsDirect(cards);
  }

  private _cancelCardGrab() {
    if (!this._cardGrabMode || !this._selectedCardId || !this._cardGrabOrigin) return;
    this._cardGrabMode = false;
    const origPos = new THREE.Vector3(...this._cardGrabOrigin);
    this._cardRenderer?.previewPosition(this._selectedCardId, origPos);
    this._cardGrabOrigin = null;
    if (this.controls) this.controls.enabled = !this._locked;
    this._editPanel?.hideStatusBar();
    this._panelGizmo?.setPosition(origPos);
    this._panelGizmo?.setVisible(true);
  }

  private _deleteSelectedCard() {
    if (!this._selectedCardId) return;
    const cards = (this._scene?.cards ?? []).filter((c) => c.id !== this._selectedCardId);
    this._selectedCardId = null;
    this._cardRenderer?.setSelectedId(null);
    this._panelGizmo?.setVisible(false);
    this._editPanel?.updateAnchorList();
    this._saveCardsDirect(cards);
  }

  /** Activate placement mode: next scene click places a card of the given type. */
  startCardPlacement(type: SceneCardType) {
    this._cardPlacementMode = true;
    this._cardPlacementType = type;
    this._editPanel?.showStatusBar('🎯 Cliquez sur le modèle pour placer la carte  ·  Esc pour annuler');
    if (this.canvas) this.canvas.style.cursor = 'crosshair';
  }

  private _startCardPlacement(type: SceneCardType) {
    this.startCardPlacement(type);
  }

  private async _placeNewCard(type: SceneCardType, position: [number, number, number]) {
    const defaults: Partial<SceneCard> = type === 'entity' ? { entity_id: '' } : {};
    const newCard = {
      id: `card_${Date.now()}`,
      type,
      name: type === 'room' ? 'Pièce' : type === 'entity' ? 'Entité' : 'Info',
      position,
      visible: true,
      size: 'medium' as const,
      ...defaults,
    } as SceneCard;

    const cards = [...(this._scene?.cards ?? []), newCard];
    this._cardPlacementMode = false;
    this._cardPlacementType = null;
    this._editPanel?.hideStatusBar();
    if (this.canvas) this.canvas.style.cursor = '';

    this._editPanel?.pushCardSnapshot();
    await this._saveCardsDirect(cards);

    this._selectedCardId = newCard.id;
    this._cardRenderer?.setSelectedId(newCard.id);
    const cardPos = new THREE.Vector3(...position);
    this._panelGizmo?.setPosition(cardPos);
    this._panelGizmo?.setVisible(true);
    if (this.camera) this._panelGizmo?.updateScale(this.camera);
    this._editPanel?.updateAnchorList();
  }

  /** Save cards to backend and update local scene. */
  private async _saveCardsDirect(cards: SceneCard[]) {
    const sceneId = this._getActiveSceneId();
    const hass = this._hass;
    const current = this._scene;
    if (!sceneId || !hass) {
      if (current) this._scene = { ...current, cards };
      this._cardRenderer?.syncCards(cards, this._hass);
      this._editPanel?.updateAnchorList();
      return;
    }
    try {
      const base = current ?? {
        version: 1, scene_id: sceneId,
        model_url: this._config?.model_url ?? '',
        anchors: [], camera_views: [], cards: [], rules: [],
      };
      const updated = { ...base, cards };
      await saveScene(hass, sceneId, updated);
      this._scene = updated;
    } catch (err) {
      console.error('[Owlnest] Card save failed:', err);
    }
    this._cardRenderer?.syncCards(cards, this._hass);
    this._editPanel?.updateAnchorList();
  }

  private async _saveRulesDirect(rules: OwlnestRule[]) {
    const sceneId = this._getActiveSceneId();
    const hass = this._hass;
    const current = this._scene;
    if (!sceneId || !hass) {
      if (current) this._scene = { ...current, rules };
      return;
    }
    try {
      const base = current ?? {
        version: 1, scene_id: sceneId,
        model_url: this._config?.model_url ?? '',
        anchors: [], camera_views: [], cards: [], rules: [],
      };
      const updated = { ...base, rules };
      await saveScene(hass, sceneId, updated);
      this._scene = updated;
    } catch (err) {
      console.error('[Owlnest] Rules save failed:', err);
    }
  }

  // ── Card fly-to ────────────────────────────────────────────────────────────

  private _enterCardFocus(cardId: string) {
    if (!this.camera || !this.controls) return;
    const card = this._cardRenderer?.getCard(cardId);
    if (!card) return;

    this._preFocusPos = this.camera.position.clone();
    this._preFocusTarget = this.controls.target.clone();
    this._cardFocusId = cardId;

    const cardPos = new THREE.Vector3(...card.position);
    const dir = cardPos.clone().sub(this.camera.position).normalize();
    const newCamPos = cardPos.clone().sub(dir.multiplyScalar(1.2));
    this._camAnimTo = { pos: newCamPos, target: cardPos };
  }

  private _exitCardFocus() {
    if (!this._preFocusPos || !this._preFocusTarget) return;
    this._camAnimTo = { pos: this._preFocusPos.clone(), target: this._preFocusTarget.clone() };
    this._cardFocusId = null;
    this._preFocusPos = null;
    this._preFocusTarget = null;
  }

  // ── Rebuild normal HUD (called by EditPanel.hideToolbar) ───────────────

  private _rebuildNormalHUD() {
    if (!this._hudRight) return;
    // Restore hud position to bottom-right corner
    if (this._hud) {
      this._hud.style.left = 'auto';
      this._hud.style.right = '12px';
      this._hud.style.transform = 'none';
      this._hud.style.alignItems = 'flex-end';
    }
    // Remove bar glassmorphism (invisible in normal mode)
    if (this._hudBar) {
      this._hudBar.style.background = 'none';
      this._hudBar.style.backdropFilter = 'none';
      this._hudBar.style.webkitBackdropFilter = 'none';
      this._hudBar.style.border = 'none';
    }
    // Restore sep to hidden
    if (this._hudSep) {
      this._hudSep.innerHTML = '';
      this._hudSep.style.cssText = 'width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 4px;flex-shrink:0;display:none;';
    }
    // Restore hudLeft
    if (this._hudLeft) {
      this._hudLeft.innerHTML = '';
      this._hudLeft.style.display = 'flex';
    }
    // Rebuild hudRight: lock + pencil only
    this._hudRight.innerHTML = '';
    const ui = this._config?.ui ?? {};
    if (ui.show_lock !== false && this.lockBtn) {
      this._hudRight.appendChild(this.lockBtn);
    }
    if (ui.show_editor !== false && this.editBtn) {
      this._hudRight.appendChild(this.editBtn);
    }
    // Rebuild camera view buttons in hudLeft for normal mode
    this._viewMgr?.buildHUDBar();
    // Move view buttons from _hudLeft into the separate centered _hudViews pill
    if (this._hudViews && this._hudLeft) {
      this._hudViews.innerHTML = '';
      const children = Array.from(this._hudLeft.children);
      children.forEach(b => this._hudViews!.appendChild(b));
      this._hudViews.style.display = this._hudViews.children.length > 0 ? 'flex' : 'none';
    }
  }

  // ── Three.js init ─────────────────────────────────────────────────────

  private _initThree(container: HTMLElement) {
    const w = container.offsetWidth || 400;
    const h = this._config?.height ?? Math.round(w * 0.75);
    container.style.height = `${h}px`;

    const rl = this._config?.rendering ?? {};
    const useSky = rl.sky !== false && rl.transparent_background !== true;
    const bgHex = rl.background_color ? parseInt(rl.background_color.replace('#', ''), 16) : 0x0d1117;

    this.scene = new THREE.Scene();
    this.scene.background = useSky ? null : (rl.transparent_background ? null : new THREE.Color(bgHex));
    this.scene.fog = rl.transparent_background ? null : new THREE.FogExp2(0x9fc8e8, rl.fog_density ?? 0.018);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);

    this._cardRenderer = new SceneCardRenderer(
      this.scene,
      this.camera,
      () => this._requestRender(),
    );
    this._panelGizmo = new PanelGizmo(this.scene);
    this.camera.position.set(0, 5, 12);
    const shadows = rl.shadows !== false;

    const transparentBg = rl.transparent_background === true;
    // Always alpha:true so transparent_background can be toggled live
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas!, antialias: true, alpha: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = rl.exposure ?? 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (transparentBg) this.renderer.setClearColor(0x000000, 0);

    this.controls = new OrbitControls(this.camera, this.canvas!);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const orb = this._config?.orbit ?? {};
    this.controls.minDistance = orb.min_distance ?? 1;
    this.controls.maxDistance = orb.max_distance ?? 100;
    this.controls.maxPolarAngle =
      orb.max_polar_angle !== undefined
        ? (orb.max_polar_angle * Math.PI) / 180
        : Math.PI * 0.48;

    this.controls.addEventListener('change', () => this._requestRender());
    this.controls.addEventListener('end', () => this._saveView());

    // Hemisphere — warm sky, dark ground so entity point lights stand out
    this._hemiLight = new THREE.HemisphereLight(0xfff4e0, 0x1a1a2e, rl.ambient_intensity ?? 0.7);
    this.scene.add(this._hemiLight);

    // Sun directional — soft shadows
    this._sunLight = new THREE.DirectionalLight(0xfff4c2, rl.sun_intensity ?? 0.8);
    this._sunLight.position.set(5, 10, 5);
    this._sunLight.castShadow = shadows;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.near = 0.1;
    this._sunLight.shadow.camera.far = 60;
    this._sunLight.shadow.camera.left = -15;
    this._sunLight.shadow.camera.right = 15;
    this._sunLight.shadow.camera.top = 15;
    this._sunLight.shadow.camera.bottom = -15;
    this._sunLight.shadow.bias = -0.0005;
    this._sunLight.shadow.normalBias = 0.05;
    this.scene.add(this._sunLight);

    // Procedural sky — visible through windows, updated by sun_entity or default midday
    if (useSky) {
      this._sky = new Sky();
      this._sky.scale.setScalar(1500);
      this.scene.add(this._sky);
      const su = this._sky.material.uniforms;
      su['turbidity'].value = 4;
      su['rayleigh'].value = 1.2;
      su['mieCoefficient'].value = 0.005;
      su['mieDirectionalG'].value = 0.85;
    }

    // Instantiate EnvironmentController
    this._env = new EnvironmentController(
      this.scene,
      this._hemiLight,
      this._sunLight,
      this._sky,
      () => this._modelBox,
      () => this._effectiveConfig,
      () => this._requestRender(),
    );

    // Set initial sky position
    if (useSky) {
      this._env.setSkyPos(rl.sky_elevation ?? 60, 180);
    }

    this._lastTime = performance.now();
    this._loop();
  }

  // ── Render loop ───────────────────────────────────────────────────────

  private _loop = () => {
    this.rafId = requestAnimationFrame(this._loop);

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Camera fly-to animation
    if (this._camAnimTo && this.camera && this.controls) {
      const alpha = 1 - Math.exp(-dt / 0.25);
      this.camera.position.lerp(this._camAnimTo.pos, alpha);
      this.controls.target.lerp(this._camAnimTo.target, alpha);
      if (
        this.camera.position.distanceTo(this._camAnimTo.pos) < 0.005 &&
        this.controls.target.distanceTo(this._camAnimTo.target) < 0.005
      ) {
        this.camera.position.copy(this._camAnimTo.pos);
        this.controls.target.copy(this._camAnimTo.target);
        this._camAnimTo = null;
        this._saveView();
      }
      this._dirty = true;
    }

    const moved = this.controls?.update() ?? false;
    if (moved) this._dirty = true;

    if (this._editMode) this._dirty = true;

    const transitioning = stepTransitions(this.anchors, dt, this._effectiveConfig);
    if (transitioning) this._dirty = true;

    this._cardRenderer?.update();

    // Update gizmo screen-size scale each frame
    if (this._panelGizmo?.visible && this.camera) {
      this._panelGizmo.updateScale(this.camera);
    }

    this._sim?.step(dt);
    // Animate weather particles + lightning every frame regardless of simulation state
    if (this._env?.needsStep) {
      this._env.stepParticles(dt);
      this._dirty = true;
    }

    if ((moved || this._dirty) && this.camera && this.canvas) {
      const w = this.canvas.offsetWidth;
      const h = this.canvas.offsetHeight;
      this._updateOverlayPositions(w, h);
    }

    if (!this._dirty) return;
    this._dirty = false;
    this.renderer?.render(this.scene!, this.camera!);
  };

  // ── Live settings apply ────────────────────────────────────────────────

  private _applySettingsLive() {
    if (!this.renderer || !this.scene || !this.controls) return;
    const ec = this._effectiveConfig;
    const rl = ec.rendering ?? {};

    // Exposure
    if (rl.exposure !== undefined) {
      this.renderer.toneMappingExposure = rl.exposure;
    }
    // Fog density
    if (rl.fog_density !== undefined && this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = rl.fog_density;
    }
    // Shadows
    if (rl.shadows !== undefined) {
      this.renderer.shadowMap.enabled = rl.shadows;
      this.renderer.shadowMap.needsUpdate = true;
      // Propagate shadow cast/receive to all scene meshes
      this.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.castShadow = rl.shadows!;
          obj.receiveShadow = rl.shadows!;
        }
      });
    }
    // Ground color
    if (rl.ground_color !== undefined) {
      this._env?.updateGroundColor(rl.ground_color);
    }
    // Transparent background
    if (rl.transparent_background !== undefined) {
      const transparent = rl.transparent_background;
      const bgHex = rl.background_color ? parseInt(rl.background_color.replace('#', ''), 16) : 0x0d1117;
      if (transparent) {
        this.scene.background = null;
        this.renderer.setClearColor(0x000000, 0);
        this.scene.fog = null;
        // Remove ground when transparent (no surface needed)
        this._env?.removeGround();
      } else {
        const useSky = rl.sky !== false;
        this.scene.background = useSky ? null : new THREE.Color(bgHex);
        this.renderer.setClearColor(bgHex, 1);
        this.scene.fog = new THREE.FogExp2(0x9fc8e8, rl.fog_density ?? 0.018);
        // Re-add ground if it was removed and model is loaded
        if (this._modelRoot && this._env && !this._env.hasGround) {
          const box = new THREE.Box3().setFromObject(this._modelRoot);
          this._env.addGround(box, this._config!);
        }
      }
    }
    // Ambient intensity
    if (rl.ambient_intensity !== undefined && this._hemiLight) {
      this._hemiLight.intensity = rl.ambient_intensity;
    }
    // Sun intensity
    if (rl.sun_intensity !== undefined && this._sunLight) {
      this._sunLight.intensity = rl.sun_intensity;
    }
    // Orbit limits
    const orb = ec.orbit ?? {};
    if (orb.min_distance !== undefined) this.controls.minDistance = orb.min_distance;
    if (orb.max_distance !== undefined) this.controls.maxDistance = orb.max_distance;
    if (orb.max_polar_angle !== undefined) this.controls.maxPolarAngle = orb.max_polar_angle * Math.PI;
    // Env entities — trigger updateFromHass with updated effective config
    if (this._hass && this._env) this._env.updateFromHass(this._hass);
  }

  // ── Model loading ─────────────────────────────────────────────────────

  private async _loadModel() {
    const ec = this._effectiveConfig;
    if (!ec.model_url || !this.scene) return;

    // Show loading indicator
    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = [
      'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'z-index:50',
      'pointer-events:none', 'gap:10px',
    ].join(';');
    loadingEl.innerHTML = `
      <div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.12);border-top-color:rgba(125,209,252,0.8);border-radius:50%;animation:owlnest-spin 0.8s linear infinite;"></div>
      <div style="font-size:11px;color:rgba(255,255,255,0.35);font-family:var(--primary-font-family,sans-serif);letter-spacing:.04em;">Chargement du modèle…</div>
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = '@keyframes owlnest-spin{to{transform:rotate(360deg)}}';
    loadingEl.appendChild(styleEl);
    this.overlayContainer?.appendChild(loadingEl);

    let model: THREE.Group;
    try {
      model = await loadGLTF(ec.model_url);
    } catch (err) {
      console.error('[Owlnest] model load failed:', err);
      loadingEl.innerHTML = `<div style="font-size:11px;color:#f87171;font-family:var(--primary-font-family,sans-serif);">⚠ Échec du chargement du modèle</div>`;
      return;
    }
    loadingEl.remove();

    // Enable shadows on all meshes
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    this._modelBox.copy(box).translate(centre.negate());

    const saved = this._loadView();
    if (saved) {
      this.camera!.position.fromArray(saved.pos);
      this.controls!.target.fromArray(saved.target);
      this._toggleLock(saved.locked);
    } else {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      this.camera!.position.set(0, maxDim * 0.6, maxDim * 1.4);
      this.camera!.lookAt(0, 0, 0);
      this.controls!.target.set(0, 0, 0);
      this.lockBtn!.textContent = '\uD83D\uDD13';
    }

    if (this.scene.fog instanceof THREE.Fog) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.z);
      this.scene.fog.near = maxDim * 1.2;
      this.scene.fog.far = maxDim * 4;
    }

    this.controls!.update();
    this.scene.add(model);
    this._modelRoot = model;
    if (ec.rendering?.transparent_background !== true && this._env) {
      this._env.addGround(box, this._config!);
    }

    this.anchors = detectAnchors(model, this.scene, ec);
    this._createOverlays();

    this._overlaysVisible = !(ec.tap_to_toggle ?? false);

    this.modelLoaded = true;
    if (this._hass) {
      syncLights(this.anchors, this._hass, ec);
      this._updateOverlayStates();
      this._evaluatePassiveConditions();
      this._env?.updateFromHass(this._hass);
      // Seed rule engine immediately so the first real state change fires correctly.
      // Without this, the first hass update after load would be consumed by seeding.
      if (!this._prevStatesInitialized) {
        for (const [id, s] of Object.entries(this._hass.states)) {
          this._prevEntityStates.set(id, s.state);
        }
        this._prevStatesInitialized = true;
      }
    }

    // Instantiate SimulationPanel (embedded in Weather tab — no HUD button/expand needed)
    if (!this._sim) {
      this._sim = new SimulationPanel(
        null,
        null,
        this._env!,
        () => this._requestRender(),
        () => this._hass,
        () => this.anchors,
        () => this._effectiveConfig,
        () => this._updateOverlayStates(),
      );
    }

    // Instantiate ViewManager
    this._viewMgr = new ViewManager(
      this.overlayContainer!,
      this._hudLeft!,
      this._hudSep!,
      () => this.camera,
      () => this.controls,
      () => this._effectiveConfig,
      () => this._hass,
      () => this._getActiveSceneId(),
      () => this._scene,
      (scene) => { this._scene = scene; },
      (msg, err) => this._showToast(msg, err),
      (pos, target) => { this._camAnimTo = { pos, target }; },
      () => this._hudRight,
    );

    this._rebuildNormalHUD();

    // Sync cards from scene
    const cards = this._scene?.cards ?? [];
    if (cards.length > 0) {
      this._cardRenderer?.syncCards(cards, this._hass);
    }

    this._requestRender();
  }

  // ── Overlay positioning + clustering ──────────────────────────────────

  private _updateOverlayPositions(w: number, h: number) {
    if (this._editMode) return;
    // 1. Compute 2D screen positions
    const pos2d = new Map<string, { x: number; y: number }>();
    const behind = new Set<string>();

    this.anchors.forEach((entry, name) => {
      const p = entry.worldPos.clone().project(this.camera!);
      if (p.z >= 1) { behind.add(name); return; }
      pos2d.set(name, {
        x: ((p.x + 1) / 2) * w,
        y: ((-p.y + 1) / 2) * h,
      });
    });

    // 2. Cluster visible anchors (opt-in via cluster_threshold)
    const threshold = this._effectiveConfig?.cluster_threshold ?? 0;
    const groups = threshold > 0
      ? this._computeClusters([...pos2d.entries()], threshold)
      : [...pos2d.keys()].map(k => [k]);
    const inCluster = new Set<string>();
    const activeIds = new Set<string>();

    groups.filter(g => g.length > 1).forEach(group => {
      const id = [...group].sort().join('|');
      activeIds.add(id);
      group.forEach(k => inCluster.add(k));

      const cx = group.reduce((s, k) => s + pos2d.get(k)!.x, 0) / group.length;
      const cy = group.reduce((s, k) => s + pos2d.get(k)!.y, 0) / group.length;

      let clusterOv = this._clusters.get(id);
      if (!clusterOv) {
        clusterOv = new ClusterOverlay(this.overlayContainer!);
        this._clusters.set(id, clusterOv);
      }

      const items: ClusterItem[] = group.map(k => {
        const entry = this.anchors.get(k)!;
        return {
          domain: entry.domain,
          label: entry.label,
          on: entry.targetIntensity > 0,
          color: entry.targetColor.clone(),
          onShortClick: this._getShortClickHandler(entry),
          onLongPress: () => this._openMoreInfo(entry.entityId),
        };
      });

      clusterOv.update(items);
      clusterOv.updatePosition(cx, cy);
      clusterOv.show();
    });

    // Remove stale clusters
    this._clusters.forEach((clusterOv, id) => {
      if (!activeIds.has(id)) { clusterOv.destroy(); this._clusters.delete(id); }
    });

    // 3. Show/hide individual overlays
    this.anchors.forEach((_entry, name) => {
      const ov = this.overlays.get(name);
      if (!ov) return;
      if (behind.has(name) || inCluster.has(name) || this.anchors.get(name)?.hidden || ov.conditionHidden) {
        ov.el.style.display = 'none';
        return;
      }
      const p = pos2d.get(name)!;
      ov.el.style.display = ov instanceof SensorOverlay ? 'block' : 'flex';
      ov.el.style.left = `${p.x}px`;
      ov.el.style.top = `${p.y}px`;
    });
  }

  private _computeClusters(items: [string, { x: number; y: number }][], threshold: number): string[][] {
    const groups: string[][] = [];
    const assigned = new Set<string>();

    items.forEach(([key, pos]) => {
      if (assigned.has(key)) return;
      const group = [key];
      assigned.add(key);
      items.forEach(([k2, pos2]) => {
        if (k2 === key || assigned.has(k2)) return;
        if (Math.hypot(pos.x - pos2.x, pos.y - pos2.y) < threshold) {
          group.push(k2);
          assigned.add(k2);
        }
      });
      groups.push(group);
    });

    return groups;
  }

  // ── Overlays ──────────────────────────────────────────────────────────

  private _createOverlays() {
    this._clusters.forEach(c => c.destroy());
    this._clusters.clear();
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();

    this.anchors.forEach((entry, name) => {
      if (entry.domain === 'sensor') {
        const overlay = new SensorOverlay(
          this.overlayContainer!,
          () => this._openMoreInfo(entry.entityId),
        );
        this.overlays.set(name, overlay);
        return;
      }

      const onShortClick = this._getShortClickHandler(entry);
      const overlay = new AnchorOverlay(
        this.overlayContainer!,
        entry.domain,
        entry.label,
        onShortClick,
        () => this._openMoreInfo(entry.entityId),
        entry.icon,
      );
      this.overlays.set(name, overlay);
    });
  }

  private _getShortClickHandler(entry: AnchorEntry): () => void {
    switch (entry.domain) {
      case 'light':
      case 'switch':
        return () => this._hass?.callService(entry.domain, 'toggle', { entity_id: entry.entityId });
      case 'cover':
        return () => this._hass?.callService('cover', 'toggle', { entity_id: entry.entityId });
      case 'media_player':
        return () => this._hass?.callService('media_player', 'media_play_pause', { entity_id: entry.entityId });
      default:
        return () => this._openMoreInfo(entry.entityId);
    }
  }

  // ── Rules engine ────────────────────────────────────────────────────────

  // True once _prevEntityStates has been seeded with the initial snapshot
  private _prevStatesInitialized = false;

  private _evaluateRules() {
    if (!this._hass || !this._scene) return;

    // On first call: seed prev states without evaluating rules (avoid false triggers on load)
    if (!this._prevStatesInitialized) {
      for (const [id, s] of Object.entries(this._hass.states)) {
        this._prevEntityStates.set(id, s.state);
      }
      this._prevStatesInitialized = true;
      return;
    }

    const rules = this._scene.rules as OwlnestRule[];
    if (rules.length === 0) return;

    for (const rule of rules) {
      if (rule.enabled === false) continue;
      if (!triggerFired(rule, this._prevEntityStates, this._hass)) continue;
      if (!conditionsMet(rule, this._hass)) continue;
      console.debug('[Owlnest] Rule fired:', rule.label ?? rule.id, rule.actions);
      for (const action of rule.actions) this._executeAction(action);
    }
    // Update prev states AFTER evaluation so transitions are detected correctly
    for (const [id, s] of Object.entries(this._hass.states)) {
      this._prevEntityStates.set(id, s.state);
    }
  }

  private _executeAction(action: Action) {
    if (!this._hass) return;
    switch (action.type) {
      case 'go_to_view': {
        const views = normalizeViews(this._scene?.camera_views ?? []);
        const view = views.find((v) => v.id === action.view_id);
        if (view) {
          console.debug('[Owlnest] go_to_view:', view.label);
          this._camAnimTo = {
            pos:    new THREE.Vector3(...view.position),
            target: new THREE.Vector3(...view.target),
          };
        } else {
          console.warn('[Owlnest] go_to_view: view not found:', action.view_id, 'available:', views.map(v => v.id));
        }
        break;
      }
      case 'show_card':
      case 'hide_card': {
        const visible = action.type === 'show_card';
        const cards = (this._scene?.cards ?? []).map((c) =>
          c.id === action.card_id ? { ...c, visible } : c,
        ) as SceneCard[];
        void this._saveCardsDirect(cards);
        break;
      }
      case 'call_service':
        this._hass.callService(action.domain, action.service, action.service_data ?? {});
        break;
    }
  }

  private _evaluatePassiveConditions() {
    if (!this._hass) return;

    // ── Cards (needs _scene) ──────────────────────────────────────────
    if (this._scene) {
      const cards = this._scene.cards;
      let cardsChanged = false;
      for (const card of cards) {
        if (!card.visibleIf) continue;
        const shouldBeVisible = evalCondition(card.visibleIf, this._hass);
        const isVisible = card.visible !== false;
        if (shouldBeVisible !== isVisible) {
          (card as { visible: boolean }).visible = shouldBeVisible;
          cardsChanged = true;
        }
      }
      if (cardsChanged) this._cardRenderer?.syncCards(cards, this._hass);
    }

    // ── Anchors (only needs this.anchors) ────────────────────────────
    this.anchors.forEach((entry, key) => {
      const overlay = this.overlays.get(key);
      if (!overlay || !('conditionHidden' in overlay)) return;
      if (!entry.visibleIf) {
        overlay.conditionHidden = false;
        return;
      }
      overlay.conditionHidden = !evalCondition(entry.visibleIf, this._hass!);
    });
  }

  private _updateOverlayStates() {
    this.anchors.forEach((entry, name) => {
      const overlay = this.overlays.get(name);
      if (!overlay) return;

      const stateObj = this._hass?.states[entry.entityId];

      if (overlay instanceof SensorOverlay) {
        const rawValue = stateObj?.state ?? '\u2014';
        const unit = (stateObj?.attributes.unit_of_measurement as string) ?? '';
        const value = _formatSensorValue(rawValue, entry.precision);
        overlay.updateValue(value, unit, `${entry.label}: ${value}${unit}`);
        return;
      }

      if (overlay instanceof AnchorOverlay) {
        const on = entry.targetIntensity > 0;
        const stateName = stateObj?.state ?? '\u2014';
        let label = `${entry.label} \u2022 ${stateName}`;
        if (entry.domain === 'climate') {
          const temp = stateObj?.attributes.current_temperature;
          if (temp != null) label = `${entry.label} \u2022 ${temp}\u00B0`;
        } else if (entry.domain === 'cover') {
          const pct = stateObj?.attributes.current_position;
          if (pct != null) label = `${entry.label} \u2022 ${pct}%`;
        }
        overlay.updateState(on, entry.targetColor, label);
      }
    });
  }

  private _openMoreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }

  // ── Resize ────────────────────────────────────────────────────────────

  private _onResize() {
    const container = this.querySelector('ha-card') as HTMLElement | null;
    if (!container || !this.renderer || !this.camera) return;
    const w = container.offsetWidth;
    const h = this._config?.height ?? Math.round(w * 0.75);
    container.style.height = `${h}px`;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._requestRender();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private _teardown() {
    cancelAnimationFrame(this.rafId);
    this.ro?.disconnect();
    if (this._editMode) this._editor?.deactivate();
    this.controls?.dispose();
    this.renderer?.dispose();
    this._env?.removeWeatherParticles();
    this._env = null;
    this._sim = null;
    this._viewMgr = null;
    this._editPanel = null;
    this._cardRenderer?.dispose();
    this._cardRenderer = null;
    this._panelGizmo?.dispose();
    this._panelGizmo = null;
    this._clusters.forEach((c) => c.destroy());
    this._clusters.clear();
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();
    this.anchors.forEach((e) => {
      if (e.light) { this.scene?.remove(e.light); e.light.dispose(); }
      if (e.lightTarget) this.scene?.remove(e.lightTarget);
    });
    this.anchors.clear();
    this._hud?.remove();
    this._hud = null;
    this._hudLeft = null;
    this._hudSep = null;
    this._hudRight = null;
    this._hudViews = null;
    if (this._controlsHideTimer) clearTimeout(this._controlsHideTimer);
    this.modelLoaded = false;
    this._editMode = false;
    this._modelRoot = null;
    this._camAnimTo = null;
    this._sky = null;
  }

  disconnectedCallback() {
    this._teardown();
  }
}

customElements.define('ha-3d-floorplan', Ha3dFloorplan);
