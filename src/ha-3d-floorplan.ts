import * as THREE from 'three';


import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Hass, CardConfig, AnchorEntry, SavedView, EditableAnchor, OwlnestScene } from './types';
import { syncLights, stepTransitions } from './lights';
import { loadGLTF, detectAnchors, buildAnchorsFromEditable, rebuildAnchorLight, lightTargetPos } from './model';
import { AnchorOverlay, SensorOverlay, ClusterOverlay, LabelOverlay, CameraOverlay, pulseOverlay } from './overlay';
import type { ClusterItem } from './overlay';
import { AnchorEditor } from './editor';
import { loadScene, saveScene, listScenes, sceneToEffectiveConfig, buildSceneFromEditor, normalizeViews } from './scene';
import { setLang, t } from './i18n';
import { qualityFromConfig, qualityKey, profileFor } from './quality';
import { describeEntity, fallbackIcon } from './entities/descriptors';
import './card-editor';
import { EnvironmentController } from './card/environment';
import { SimulationPanel } from './card/simulation';
import { ViewManager } from './card/view-manager';
import { EditPanel } from './card/edit-panel';
import { SceneCardRenderer } from './cards/renderer';
import { PanelGizmo } from './panels/gizmo';
import type { SceneCard, SceneCardType } from './cards/types';
import { PartController, meshOrder } from './parts-runtime';
import { modelScale } from './scale';
import { partIndexOf, partFrame, guessPart, verticalAxis } from './parts';
import { separateCoplanarSlabs } from './coplanar';
import { createUniforms, instrumentMaterials, updateXray, createGhost } from './cutaway';
import type { CutawayUniforms } from './cutaway';
import { evalCondition, RuleEngine } from './rules/engine';
import type { OwlnestRule, Action } from './rules/types';

type AnyOverlay = AnchorOverlay | SensorOverlay | LabelOverlay | ClusterOverlay | CameraOverlay;

/**
 * Largeur de reference d'une vignette, en fraction de la plus grande dimension
 * du modele. Exprimer une taille en metres ne marche pas : un export en
 * centimetres donne une maison de 800 unites de large, et la vignette
 * disparaitrait.
 *
 * L'ordre de grandeur se lit ainsi : quand le modele entier tient a l'ecran, la
 * vignette occupe environ `ratio` fois la hauteur du viewport. A 0.045 elle
 * faisait 18 px sur une carte de 400 px — toujours sous le plancher, donc de
 * taille figee.
 */
const CAMERA_WIDTH_RATIO = 0.18;

/** Format a sensor state string respecting optional decimal precision. */
function _formatSensorValue(raw: string, precision?: number): string {
  if (precision === undefined) return raw;
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  return num.toFixed(precision);
}

/**
 * Estampille de build, lisible depuis la console du navigateur :
 * `document.querySelector('ha-3d-floorplan').constructor.OWLNEST_BUILD`
 * Permet de savoir si la page execute bien le code du disque.
 */
const OWLNEST_BUILD = 'rules-engine-v2';

class Ha3dFloorplan extends HTMLElement {
  static readonly OWLNEST_BUILD = OWLNEST_BUILD;

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
  private _lastGroundKey = '';
  private _lastQualityKey = '';

  // Profil qualité résolu, relu à chaque frame — mis à jour à l'init et à chaud.
  private _quality = profileFor('auto');

  /**
   * Les shadow maps sont recalculées à la demande, pas à chaque image :
   * tourner la caméra ne change aucune ombre.
   */
  private _shadowsDirty = true;

  // Rendu suspendu quand la carte est masquée ou hors écran.
  /** Aperçu de règle en cours : les overlays restent visibles malgré l'édition. */
  private _previewingRule = false;
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;

  private _paused = false;
  private _io: IntersectionObserver | null = null;
  private _onVisibility: (() => void) | null = null;

  // Réutilisé chaque frame pour la projection des overlays (évite un clone par
  // ancre et par image).
  private _projScratch = new THREE.Vector3();

  // Rafraichissement des vignettes de camera. Piloté depuis la boucle de
  // rendu : celle-ci sort immédiatement quand la carte est hors écran, donc
  // les téléchargements s'arrêtent avec elle.
  private _camAccum = 0;

  // Overlay visibility (tap-to-toggle)
  private _overlaysVisible = true;
  private _tapStartTime = 0;
  private _tapStartPos = { x: 0, y: 0 };

  // Controls visibility (hover / touch reveal)
  private _controlsHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Camera animation
  private _camAnimTo: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  // Moteur de regles : porte lui-meme ses etats precedents, ses minuteries de
  // duree et ses anti-rebonds.
  private _ruleEngine = new RuleEngine();
  /** Calque translucide du mur retiré — voir cutaway.ts. */
  private _ghost: THREE.Group | null = null;

  /** Uniformes partagés de l'effacement, mis à jour à chaque image. */
  private _cutaway: CutawayUniforms = createUniforms();

  /** Ouvrants du modèle animés par l'état des entités (portes, volets…). */
  private _parts = new PartController();
  /** Renseigné pendant que l'éditeur attend un clic sur une pièce du modèle. */
  private _partPickHandler: ((hit: import('./card/edit-panel').PickedPart) => void) | null = null;

  // Environment lights
  private _hemiLight: THREE.HemisphereLight | null = null;
  private _sunLight: THREE.DirectionalLight | null = null;
  private _sky: Sky | null = null;

  private _modelBox = new THREE.Box3();
  /** Plus grande dimension du modele, dans ses propres unites. */
  private _modelSpan = 1;


  // Anchor editor
  private _editor: AnchorEditor | null = null;
  private _modelRoot: THREE.Object3D | null = null;
  private _savePending = false;  // true while a callWS is in flight
  private _saveQueued = false;   // une modification est arrivee pendant l'envoi

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

    // Les ouvrants suivent l'état même en édition : voir une porte s'ouvrir est
    // le seul moyen de vérifier qu'on a choisi le bon côté de gonds.
    if (this.modelLoaded && this._parts.built && this._parts.applyStates(hass.states)) {
      this._requestRender();
    }

    if (this.modelLoaded && !this._editMode) {
      syncLights(this.anchors, hass, this._effectiveConfig, this._modelSpan);
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

  /**
   * Enregistre la scene.
   *
   * Une sauvegarde arrivant pendant qu'une autre est en vol etait auparavant
   * abandonnee, ce qui perdait silencieusement la derniere modification — et le
   * toast de la sauvegarde precedente laissait croire au succes. On memorise
   * desormais la demande et on rejoue un tour, en reconstruisant la scene a
   * chaque passage pour toujours ecrire l'etat le plus recent.
   */
  async _saveScene() {
    const sceneId = this._getActiveSceneId();
    if (!sceneId || !this._hass || !this._editor) return;

    if (this._savePending) { this._saveQueued = true; return; }
    this._savePending = true;

    try {
      do {
        this._saveQueued = false;

        const sceneData = buildSceneFromEditor(
          sceneId,
          this._editor.anchors as Map<string, EditableAnchor>,
          this._scene,
          this._config!,
        );
        // Preserve scene settings (env, rendering, language configured from Config tab)
        sceneData.settings = this._scene?.settings;

        await saveScene(this._hass, sceneId, sceneData);
        this._scene = sceneData;
      } while (this._saveQueued);

      this._showToast('✓ Scène sauvegardée');
    } catch (err) {
      console.error('[Owlnest] Save failed:', err);
      this._showToast('✗ Erreur lors de la sauvegarde', true);
    } finally {
      this._savePending = false;
      this._saveQueued = false;
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

        // La sélection d'une pièce du modèle passe avant tout : l'éditeur
        // attend explicitement ce clic.
        if (this._partPickHandler) {
          if (!this._handlePartPick(ndc)) {
            // Clic dans le vide : on annule plutôt que de laisser l'éditeur
            // attendre indéfiniment.
            this._partPickHandler = null;
            if (this.canvas) this.canvas.style.cursor = '';
            this._editPanel?.hideStatusBar();
          }
          return;
        }

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
            +(hits[0].point.y + this._modelSpan * 0.04).toFixed(3),
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
    // Les marqueurs et gizmos de l'éditeur modifient la géométrie de la scène.
    this._requestShadowUpdate();
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
      this._hudBar.style.setProperty('-webkit-backdrop-filter', 'blur(12px)');
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
      // ⚠ Recopie exhaustive obligatoire : ce qui manque ici est perdu à
      // l'entrée en édition, puis écrasé dans la scène au prochain
      // enregistrement. Tout nouveau champ d'ancre doit être ajouté ici, dans
      // scene.ts (les deux sens) et dans model.ts (les deux fabriques).
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
        color: entry.color,
        tapAction: entry.tapAction,
        kind: entry.kind,
        actions: entry.actions,
        navViewId: entry.navViewId,
        size: entry.size,
        display: entry.display,
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
          // scene_id was changed — store in localStorage and fully reload
          const newId = (s as Record<string, unknown>)['scene_id'] as string | undefined;
          if (newId) {
            localStorage.setItem('owlnest_scene_id', newId);
            this._scene = null;
            this._sceneLoading = false;
            if (this._hass) {
              this._fetchAndLoadScene(newId);
            }
          }
          return; // skip live-apply & auto-save — scene will be fully reloaded
        }
        this._applySettingsLive();
        this._editPanel?.scheduleAutoSave();
        this._requestRender();
      },
      async () => {
        if (!this._hass) return [];
        return listScenes(this._hass).catch(() => []);
      },
      () => this._scene?.parts ?? [],
      async (parts) => this._savePartsDirect(parts),
      (onPicked) => this._startPartPicking(onPicked),
      (id, fraction) => { this._parts.preview(id, fraction); this._requestRender(); },
      (cfg) => {
        const applied = this._parts.configure(cfg);
        if (applied) this._requestRender();
        return applied;
      },
      () => this._modelSpan,
    );

    this._editPanel.onTestRule = (rule) => this.runRuleNow(rule);

    this._editor.onChanged = () => {
      this._requestShadowUpdate();
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
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
    this._previewingRule = false;
    this._requestShadowUpdate();
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

    this.anchors = buildAnchorsFromEditable(editable, this.scene!, this._effectiveConfig, this._modelSpan);

    if (this.controls) this.controls.enabled = !this._locked;

    this._createOverlays();
    if (this._hass) {
      syncLights(this.anchors, this._hass, this._config, this._modelSpan);
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
        rebuildAnchorLight(entry, this.scene!, this._effectiveConfig, newStyle, ea.lightDirection, this._modelSpan);
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

  /**
   * Enregistre les ouvrants et remonte le modèle en conséquence.
   *
   * Détacher une pièce retire ses triangles de la maille : on ne peut pas
   * appliquer un changement par-dessus l'état courant, il faut repartir du
   * modèle d'origine. D'où le rechargement, qui reste local (le fichier est
   * dans le cache du navigateur).
   */
  private async _savePartsDirect(parts: import('./types').OwlnestPart[]) {
    const sceneId = this._getActiveSceneId();
    const hass = this._hass;
    const current = this._scene;
    const before = current?.parts ?? [];
    const base = current ?? {
      version: 1, scene_id: sceneId ?? '',
      model_url: this._config?.model_url ?? '',
      anchors: [], camera_views: [], cards: [], rules: [],
    };
    const updated = { ...base, parts };
    this._scene = updated;

    if (sceneId && hass) {
      try {
        await saveScene(hass, sceneId, updated);
      } catch (err) {
        console.error('[Owlnest] Parts save failed:', err);
      }
    }
    // Un ajout ou une suppression change la géométrie détachée : il faut
    // repartir du modèle d'origine. Un simple réglage passe par `configure`
    // et n'arrive jamais ici.
    const ids = new Set(parts.map((p) => p.id));
    const known = new Set(before.map((p) => p.id));
    const structural = ids.size !== known.size || [...ids].some((id) => !known.has(id));
    if (structural) this.refreshParts();
  }

  /**
   * Attend le prochain clic sur le modèle et renvoie la pièce touchée.
   *
   * On ne propose pas de liste : sur 2 600 composantes, désigner du doigt est
   * la seule interaction praticable.
   */
  private _startPartPicking(onPicked: (hit: import('./card/edit-panel').PickedPart) => void) {
    this._partPickHandler = onPicked;
    if (this.canvas) this.canvas.style.cursor = 'crosshair';
  }

  private _handlePartPick(ndc: THREE.Vector2): boolean {
    const cb = this._partPickHandler;
    if (!cb || !this.camera || !this._modelRoot) return false;

    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this._modelRoot, true);
    const hit = hits.find((h) => h.faceIndex !== undefined && (h.object as THREE.Mesh).isMesh);
    if (!hit) return false;

    this._partPickHandler = null;
    if (this.canvas) this.canvas.style.cursor = '';

    const mesh = hit.object as THREE.Mesh;
    const index = partIndexOf(mesh);
    const partId = index.ofTriangle[hit.faceIndex!];
    const part = partId >= 0 ? index.parts[partId] : null;
    if (!part) return false;

    // Le modèle peut être en mètres comme en centimètres : on cale l'échelle
    // sur une hauteur d'étage plausible pour que les cotes affichées parlent.
    const span = this._modelSpan;
    const unitToCm = span > 50 ? 1 : 100;
    const frame = partFrame(part.box);
    cb({
      mesh: mesh.name,
      meshIndex: meshOrder(this._modelRoot).indexOf(mesh),
      triangle: hit.faceIndex!,
      // Hauteur, largeur, épaisseur — dans cet ordre, quelle que soit
      // l'orientation du modèle.
      size: [
        frame.size[frame.up] * unitToCm,
        frame.size[frame.wide] * unitToCm,
        frame.size[frame.thin] * unitToCm,
      ],
      guess: guessPart(part.box, unitToCm),
      triangles: part.tris.length,
    });
    return true;
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
      this._hudBar.style.setProperty('-webkit-backdrop-filter', 'none');
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
    // Profil qualité : antialias est figé à la création du contexte WebGL, donc
    // c'est le seul réglage qui exige un rechargement de la page pour changer.
    const q = qualityFromConfig(this._effectiveConfig);
    this._quality = q;
    this._lastQualityKey = qualityKey(this._effectiveConfig);
    // Always alpha:true so transparent_background can be toggled live
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas!, antialias: q.antialias, alpha: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxPixelRatio));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = q.shadowFilter;
    // Les ombres ne dépendent pas de la caméra : on ne les recalcule que
    // lorsqu'une lumière, le soleil ou la géométrie change.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = rl.exposure ?? 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (transparentBg) this.renderer.setClearColor(0x000000, 0);

    this.controls = new OrbitControls(this.camera, this.canvas!);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const orb = this._config?.orbit ?? {};
    // Bornes provisoires : le modèle n'est pas encore chargé, donc son échelle
    // est inconnue. `_fitOrbitLimits()` les recalcule dès qu'elle l'est.
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
    this._sunLight.shadow.mapSize.set(q.sunShadowMap, q.sunShadowMap);
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

    this._env.onSunMoved = () => this._requestShadowUpdate();

    // Set initial sky position
    if (useSky) {
      this._env.setSkyPos(rl.sky_elevation ?? 60, 180);
    }

    this._setupVisibility(container);

    this._lastTime = performance.now();
    this._loop();
  }

  // ── Render loop ───────────────────────────────────────────────────────

  private _loop = () => {
    this.rafId = requestAnimationFrame(this._loop);

    // Carte masquée (autre onglet HA, écran éteint) ou hors du viewport :
    // aucune raison de consommer du GPU.
    if (this._paused) return;

    const now = performance.now();
    // Plafond d'images par seconde. La tolérance évite de rater une frame quand
    // le pas de l'écran ne divise pas exactement l'intervalle visé.
    const minInterval = 1000 / this._quality.maxFps - 0.5;
    if (now - this._lastTime < minInterval) return;

    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Camera fly-to animation
    if (this._camAnimTo && this.camera && this.controls) {
      const arrival = Math.max(this._modelSpan * 5e-4, 1e-4);
      const alpha = 1 - Math.exp(-dt / 0.25);
      this.camera.position.lerp(this._camAnimTo.pos, alpha);
      this.controls.target.lerp(this._camAnimTo.target, alpha);
      if (
        // Seuil relatif à l'envergure : fixé à 0,005 unité, un vol vers une vue
        // n'arrivait jamais sur un modèle en centimètres, et la boucle de rendu
        // restait éveillée indéfiniment — du GPU consommé pour rien sur la
        // tablette.
        this.camera.position.distanceTo(this._camAnimTo.pos) < arrival &&
        this.controls.target.distanceTo(this._camAnimTo.target) < arrival
      ) {
        this.camera.position.copy(this._camAnimTo.pos);
        this.controls.target.copy(this._camAnimTo.target);
        this._camAnimTo = null;
        this._saveView();
      }
      this._dirty = true;
    }

    // Ouvrants en mouvement : tant qu'une porte pivote, il faut redessiner.
    if (this._parts.built && this._parts.update(dt)) this._dirty = true;

    const moved = this.controls?.update() ?? false;
    if (moved) this._dirty = true;
    // L'effacement à travers les murs dépend du point de vue : il doit suivre
    // la caméra, pas seulement les réglages.
    if (moved || this._camAnimTo) this._updateXray();

    if (this._editMode) this._dirty = true;

    const transitioning = stepTransitions(this.anchors, dt, this._effectiveConfig);
    if (transitioning) {
      this._dirty = true;
      // Une lumière dont l'intensité change modifie son ombre.
      if (this._quality.anchorShadows) this._shadowsDirty = true;
    }

    this._cardRenderer?.update();

    // Update gizmo screen-size scale each frame
    if (this._panelGizmo?.visible && this.camera) {
      this._panelGizmo.updateScale(this.camera);
    }

    this._refreshCameras(dt);

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

    if (this._shadowsDirty && this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
      this._shadowsDirty = false;
    }
    this.renderer?.render(this.scene!, this.camera!);
  };

  /** À appeler dès que les ombres cessent d'être valides (lumière, soleil, géométrie). */
  private _requestShadowUpdate() {
    this._shadowsDirty = true;
    this._dirty = true;
  }

  /**
   * Recharge les vignettes de caméra à la cadence du profil qualité.
   *
   * Seules les vignettes réellement visibles sont rechargées : une image peut
   * peser 180 Ko, et rien ne justifie de la télécharger pour un élément masqué
   * par une condition ou situé derrière la caméra.
   */
  private _refreshCameras(dt: number) {
    const interval = this._quality.cameraRefreshMs;
    if (!interval) return;

    this._camAccum += dt * 1000;
    if (this._camAccum < interval) return;
    this._camAccum = 0;

    this.anchors.forEach((entry, name) => {
      const ov = this.overlays.get(name);
      if (!(ov instanceof CameraOverlay)) return;
      if (ov.el.style.display === 'none' || ov.conditionHidden || entry.hidden) return;
      const pic = this._hass?.states[entry.entityId]?.attributes?.entity_picture;
      ov.setPicture(typeof pic === 'string' ? pic : undefined, true);
    });
  }

  // ── Mise en pause hors écran ───────────────────────────────────────────

  private _setupVisibility(container: HTMLElement) {
    this._onVisibility = () => this._setPaused(document.hidden);
    document.addEventListener('visibilitychange', this._onVisibility);

    // Un dashboard mural passe souvent d'une vue à l'autre : hors du viewport,
    // la carte n'a aucune raison de continuer à rendre.
    if (typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(
        (entries) => this._setPaused(!entries[0]?.isIntersecting),
        { threshold: 0 },
      );
      this._io.observe(container);
    }
  }

  private _setPaused(paused: boolean) {
    if (paused === this._paused) return;
    this._paused = paused;
    if (!paused) {
      // Repartir du temps courant, sinon le premier dt vaut la durée de la pause.
      this._lastTime = performance.now();
      this._dirty = true;
    }
  }

  /**
   * Cadre la caméra d'ombre du soleil sur le modèle chargé.
   *
   * Elle était figée sur ±15 unités : sur un modèle plus petit, la majorité des
   * texels de la shadow map tombait à côté de la maison, ce qui donnait des
   * ombres crénelées même en haute résolution. Ajuster le cadrage multiplie la
   * densité de texels utiles sans coûter une frame de plus.
   */
  private _fitSunShadow() {
    if (!this._sunLight || this._modelBox.isEmpty()) return;

    const sphere = this._modelBox.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(1, sphere.radius) * 1.05;
    // La lumière doit rester hors de la sphère englobante.
    const dist = Math.max(10, r * 2);
    this._env?.setSunDistance(dist);

    const cam = this._sunLight.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    /**
     * Plan proche et biais de l'ombre, eux aussi à l'échelle.
     *
     * Un `near` de 0,1 face à un `far` de près de 2 000 laisse une carte de
     * profondeur d'ombre presque inutilisable : c'est ce qui produit l'acné —
     * ces rayures sombres sur les surfaces éclairées.
     *
     * `bias` s'exprime en profondeur normalisée : sur une plage aussi étendue,
     * une valeur fixe se traduit par un décalage monde énorme, et l'ombre se
     * détache de l'objet. `normalBias`, lui, s'exprime en unités du monde et se
     * met donc à l'échelle proprement.
     */
    cam.near = Math.max(dist * 0.05, 0.01);
    cam.far = dist + r * 2;
    cam.updateProjectionMatrix();
    this._sunLight.shadow.bias = 0;
    this._sunLight.shadow.normalBias = Math.max(this._modelSpan * 0.0015, 0.002);
    this._sunLight.shadow.needsUpdate = true;
  }

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
      this._fitFog();
    }
    // Plan de coupe : relu à chaque changement de réglage, pour que le curseur
    // agisse en direct.
    this._applyCutaway();
    // Shadows
    if (rl.shadows !== undefined) {
      this.renderer.shadowMap.enabled = rl.shadows;
      this.renderer.shadowMap.needsUpdate = true;
      // Propagate shadow cast/receive — skip glass/transparent materials
      this.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mat = (obj as THREE.Mesh).material as THREE.Material;
          const isGlass = mat.transparent && mat.opacity < 0.65;
          (obj as THREE.Mesh).castShadow = rl.shadows! && !isGlass;
          (obj as THREE.Mesh).receiveShadow = rl.shadows!;
        }
      });
    }
    // Qualité — tout s'applique à chaud sauf l'antialias, figé à la création du
    // contexte WebGL et donc effectif au prochain chargement de la page.
    const qKey = qualityKey(ec);
    if (qKey !== this._lastQualityKey) {
      this._lastQualityKey = qKey;
      const q = qualityFromConfig(ec);
      this._quality = q;

      this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxPixelRatio));
      this.renderer.shadowMap.type = q.shadowFilter;
      this.renderer.shadowMap.needsUpdate = true;

      // Changer mapSize ne suffit pas : la cible de rendu existante garde son
      // ancienne taille tant qu'on ne la libère pas.
      const resizeShadow = (
        light: THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight,
        size: number,
      ) => {
        light.shadow.mapSize.set(size, size);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      };

      if (this._sunLight) resizeShadow(this._sunLight, q.sunShadowMap);
      this.anchors.forEach(({ light }) => {
        if (!light) return;
        light.castShadow = q.anchorShadows;
        resizeShadow(light, q.anchorShadowMap);
      });

      // Le filtre d'ombre est compilé dans les shaders : sans cela, les
      // matériaux déjà compilés gardent l'ancien.
      this.scene.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => { m.needsUpdate = true; });
        else if (mat) (mat as THREE.Material).needsUpdate = true;
      });

      this._cardRenderer?.setTextureWidth(q.cardTextureWidth);
      this._env?.rebuildWeather();
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
        this._fitFog();
        // Re-add ground if it was removed and model is loaded
        if (this._modelRoot && this._env && !this._env.hasGround) {
          const box = new THREE.Box3().setFromObject(this._modelRoot);
          this._env.addGround(box, ec);
        }
      }
    }
    // Sun / ambient intensities are now applied as multipliers inside
    // applySunLight(), so we don't set them directly here — updateFromHass
    // at the end will pick up the new config values.

    // Light occlusion — add/remove invisible shadow-casting roof
    if (this._env && this._modelRoot) {
      const wantOcclusion = rl.light_occlusion === 'top';
      if (wantOcclusion && !this._env.hasOcclusion) {
        this._env.addOcclusion(this._modelBox);
      } else if (!wantOcclusion && this._env.hasOcclusion) {
        this._env.removeOcclusion();
      }
    }
    // Ground style — rebuild ground only when ground-related settings change
    if (this._env && this._modelRoot && rl.transparent_background !== true) {
      const groundKey = `${rl.ground_style ?? 'square'}|${rl.ground_scale ?? 1}|${rl.ground_color ?? ''}`;
      if (groundKey !== this._lastGroundKey) {
        this._lastGroundKey = groundKey;
        const box = new THREE.Box3().setFromObject(this._modelRoot);
        this._env.addGround(box, ec);
      }
    }
    // Orbit limits
    const orb = ec.orbit ?? {};
    if (orb.min_distance !== undefined) this.controls.minDistance = orb.min_distance;
    if (orb.max_distance !== undefined) this.controls.maxDistance = orb.max_distance;
    if (orb.max_polar_angle !== undefined) this.controls.maxPolarAngle = orb.max_polar_angle * Math.PI;

    // Re-apply environment: sun mode, orientation, intensities via applySunLight
    if (this._env) {
      // If simulation is active, re-apply it (it calls applySunLight internally)
      if (this._sim?.isActive) {
        this._sim.applySimulation();
      } else if (this._hass) {
        this._env.updateFromHass(this._hass);
      }
    }

    this._requestShadowUpdate();
  }

  /**
   * Adapte les bornes d'orbite à l'échelle du modèle.
   *
   * Les valeurs par défaut (1 à 100) supposaient un modèle en mètres. Un export
   * Sweet Home 3D est en centimètres : une maison de six mètres mesure alors
   * 600 unités, et la caméra restait épinglée à un mètre du centre — on ne
   * voyait qu'un mur et du ciel.
   *
   * Les bornes explicitement fournies par la scène sont respectées : c'est un
   * réglage, pas une supposition.
   */
  /**
   * Densité du brouillard, ramenée à l'échelle du modèle.
   *
   * `FogExp2` s'exprime par unité de distance : une densité de 0,018, réglée
   * pour un modèle en mètres, sature entièrement un modèle en centimètres —
   * à 300 unités le facteur vaut déjà 1, et la maison disparaît dans un aplat
   * bleu. Le symptôme est trompeur : on croit à un modèle qui ne charge pas.
   *
   * Le réglage de l'éditeur garde son sens : il décrit la densité voulue pour
   * un modèle d'une dizaine d'unités, et on la transpose.
   */
  private _fitFog() {
    const fog = this.scene?.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    const asked = this._effectiveConfig.rendering?.fog_density ?? 0.018;
    // Même référence que le reste du projet : voir scale.ts. Cette ligne
    // utilisait un 10 écrit en dur, légèrement différent, pour la même intention.
    fog.density = asked / modelScale(this._modelSpan);
  }

  /**
   * Applique le plan de coupe horizontal.
   *
   * Un plan de découpe global du renderer s'applique à tous les matériaux sans
   * qu'il faille les toucher un par un, et il agit dans le nuanceur : aucun
   * triangle n'est analysé, aucun « mur extérieur » n'a besoin d'être
   * identifié. Cela fonctionne donc sur un export fusionné comme sur un modèle
   * découpé.
   *
   * Les overlays sont du DOM : ils restent visibles, ce qui est cohérent avec
   * le choix de laisser les pastilles traverser les murs.
   */
  /**
   * Applique le réglage d'effacement.
   *
   * L'instrumentation des matériaux n'a lieu qu'une fois ; ensuite tout passe
   * par des uniformes partagés, donc changer le réglage ne recompile rien.
   */
  private _applyCutaway() {
    if (!this._modelRoot || !this.scene) return;
    instrumentMaterials(this._modelRoot, this._cutaway);

    const on = (this._effectiveConfig.rendering?.xray ?? 0) > 0;
    if (on && !this._ghost) {
      this._ghost = createGhost(this._modelRoot, this._cutaway);
      this.scene.add(this._ghost);
    } else if (!on && this._ghost) {
      this.scene.remove(this._ghost);
      this._ghost = null;
    }

    this._updateXray();
    this._requestRender();
  }

  /**
   * Recalage de l'effacement sur la caméra.
   *
   * Appelé à chaque image où la caméra a bougé : trois écritures d'uniformes,
   * quel que soit le nombre de matériaux du modèle.
   */
  private _updateXray() {
    if (!this.camera || !this.controls) return;
    // Rayon de la sphère englobante : c'est l'échelle naturelle du dégagement.
    const radius = this._modelBox.getBoundingSphere(new THREE.Sphere()).radius;
    updateXray(
      this._cutaway,
      this.camera,
      this.controls.target,
      this._effectiveConfig.rendering?.xray ?? 0,
      radius,
    );
  }

  private _fitOrbitLimits() {
    if (!this.controls) return;
    const settings = this._scene?.settings?.orbit ?? {};
    const span = this._modelSpan;
    if (span <= 0) return;

    if (settings.min_distance === undefined) this.controls.minDistance = span * 0.05;
    if (settings.max_distance === undefined) this.controls.maxDistance = span * 3;

    /**
     * Plans de coupe.
     *
     * Le plan proche gouverne toute la précision de la profondeur : elle se
     * dégrade comme le carré de la distance divisé par lui. Le coller à zéro
     * — ce que faisait un `span * 1e-4` — réduisait la discrimination à
     * plusieurs millimètres à l'autre bout de la maison, et faisait scintiller
     * les surfaces proches.
     *
     * On le cale donc sur la distance minimale d'orbite : la caméra ne peut
     * jamais s'en approcher davantage, rien ne sera coupé.
     */
    if (this.camera) {
      this.camera.near = Math.max(this.controls.minDistance * 0.1, span * 1e-3);
      this.camera.far = Math.max(span * 8, this.camera.near * 1e4);
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  // ── Ouvrants ──────────────────────────────────────────────────────────

  /**
   * Détache les ouvrants décrits par la scène et les place selon l'état courant.
   *
   * Appelé après le chargement du modèle, et à chaque modification dans
   * l'éditeur — détacher une pièce modifie la géométrie de base, donc on repart
   * toujours d'un modèle propre plutôt que d'essayer de défaire un retrait.
   */
  private _buildParts() {
    const configs = this._scene?.parts ?? [];
    if (!this._modelRoot) return;
    this._parts.dispose(this._modelRoot);
    if (configs.length === 0) return;

    // Déduite du modèle entier, pas de chaque pièce : voir verticalAxis().
    this._parts.setVertical(verticalAxis(this._modelBox));
    const { missing } = this._parts.build(this._modelRoot, configs);
    if (missing.length) {
      console.warn(
        `[Owlnest] ${missing.length} ouvrant(s) introuvable(s) dans le modèle :`,
        missing.map((m) => m.label || m.entity).join(', '),
      );
    }
    if (this._hass) this._parts.applyStates(this._hass.states);
    // Les ouvrants partent de leur position fermée : on les amène d'un coup à
    // leur état réel, sinon toutes les portes ouvertes s'animeraient au
    // chargement de la page.
    this._parts.update(1e6);
    this._requestRender();
  }

  /** Reconstruit les ouvrants après une modification dans l'éditeur. */
  refreshParts() {
    if (!this._modelRoot) return;
    // Une pièce déjà détachée a été retirée de sa maille : seul un rechargement
    // rend le modèle à son état initial.
    this._loadModel();
  }

  // ── Scene content cleanup (keeps renderer/canvas/HUD intact) ─────────

  private _clearSceneContent() {
    // Exit edit mode cleanly
    if (this._editMode) this._exitEditMode();
    this._parts.dispose(this._modelRoot ?? undefined);
    if (this._ghost) { this.scene?.remove(this._ghost); this._ghost = null; }
    // Dispose card renderer
    this._cardRenderer?.dispose();
    this._cardRenderer = null;
    this._panelGizmo?.dispose();
    this._panelGizmo = null;
    // Remove overlays & clusters
    this._clusters.forEach((c) => c.destroy());
    this._clusters.clear();
    this.overlays.forEach((o) => o.destroy());
    this.overlays.clear();
    // Remove lights created by anchors
    this.anchors.forEach((e) => {
      if (e.light) { this.scene?.remove(e.light); e.light.dispose(); }
      if (e.lightTarget) this.scene?.remove(e.lightTarget);
    });
    this.anchors.clear();
    // Remove ground, occlusion, weather particles
    this._env?.removeGround();
    this._env?.removeOcclusion();
    this._env?.removeWeatherParticles();
    // Remove 3D model
    if (this._modelRoot && this.scene) {
      this.scene.remove(this._modelRoot);
      this._modelRoot.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry.dispose();
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
    }
    this._modelRoot = null;
    this.modelLoaded = false;
    this._lastGroundKey = '';
    // Reset simulation
    this._sim = null;
    this._viewMgr = null;
    this._ruleEngine.reset();
  }

  // ── Model loading ─────────────────────────────────────────────────────

  private async _loadModel() {
    // Clean up any previous scene content before loading new model
    this._clearSceneContent();
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

    // Enable shadows on all meshes — but skip transparent/glass materials
    // so that windows let light (and shadows) pass through.
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.Material;
        const isGlass = mat.transparent && mat.opacity < 0.65;
        obj.castShadow = !isGlass;
        obj.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    this._modelBox.copy(box).translate(centre.negate());
    const span = this._modelBox.getSize(new THREE.Vector3());
    this._modelSpan = Math.max(span.x, span.y, span.z, 1e-3);
    this._fitSunShadow();
    this._requestShadowUpdate();

    // Un export Sweet Home 3D empile son terrain, le sol de chaque pièce et le
    // dessous des tapis à la même altitude. Strictement coplanaires, ces plans
    // scintillent quelle que soit la précision du tampon de profondeur : on les
    // écarte d'une fraction imperceptible plutôt que d'en supprimer un, car le
    // terrain déborde du sol et son retrait laisserait un trou.
    const lifted = separateCoplanarSlabs(model, this._modelSpan, verticalAxis(this._modelBox));
    if (lifted) {
      console.debug(`[Owlnest] ${lifted} surface(s) coplanaire(s) écartée(s)`);
    }
    // Avant tout placement de caméra : une borne trop serrée écrêterait la
    // position par défaut, et l'élargir ensuite ne la replacerait pas.
    this._fitOrbitLimits();
    this._applyCutaway();

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

    this._fitFog();

    this.controls!.update();
    this.scene.add(model);
    this._modelRoot = model;
    if (ec.rendering?.transparent_background !== true && this._env) {
      this._env.addGround(box, ec);
    }
    // Add occlusion plane if configured
    if (ec.rendering?.light_occlusion === 'top' && this._env) {
      this._env.addOcclusion(this._modelBox);
    }

    this._buildParts();

    this.anchors = detectAnchors(model, this.scene, ec, this._modelSpan);
    this._createOverlays();

    this._overlaysVisible = !(ec.tap_to_toggle ?? false);

    // Le renderer a été créé avant que la scène ne soit chargée, donc avec les
    // seuls réglages du YAML. On applique ici ceux qui viennent de la scène
    // (qualité, exposition, brouillard…), sinon ils n'auraient d'effet qu'après
    // une modification manuelle dans l'éditeur.
    this._applySettingsLive();

    this.modelLoaded = true;
    if (this._hass) {
      syncLights(this.anchors, this._hass, ec, this._modelSpan);
      this._updateOverlayStates();
      this._evaluatePassiveConditions();
      this._env?.updateFromHass(this._hass);
      // Amorce le moteur : sans cela, la premiere mise a jour d'etat apres le
      // chargement serait consommee par l'instantane initial.
      this._evaluateRules();
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
        () => this._modelSpan,
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
    if (this._editMode && !this._previewingRule) return;
    // 1. Compute 2D screen positions
    const pos2d = new Map<string, { x: number; y: number }>();
    const behind = new Set<string>();
    // Ancres exclues du regroupement automatique (natures non-entité).
    const noCluster = new Set<string>();

    this.anchors.forEach((entry, name) => {
      // Vecteur de travail réutilisé : un clone par ancre et par image finissait
      // par peser en collecte mémoire sur les scènes chargées.
      const p = this._projScratch.copy(entry.worldPos).project(this.camera!);
      if (p.z >= 1) { behind.add(name); return; }
      // Seules les ancres d'entité entrent dans un regroupement : une étiquette
      // ou une roue n'a rien à faire dans un menu radial de voisinage.
      if ((entry.kind ?? 'entity') !== 'entity') { pos2d.set(name, {
        x: ((p.x + 1) / 2) * w,
        y: ((-p.y + 1) / 2) * h,
      }); noCluster.add(name); return; }
      pos2d.set(name, {
        x: ((p.x + 1) / 2) * w,
        y: ((-p.y + 1) / 2) * h,
      });
    });

    // 2. Cluster visible anchors (opt-in via cluster_threshold)
    const threshold = this._effectiveConfig?.cluster_threshold ?? 0;
    const inCluster = new Set<string>();
    const activeIds = new Set<string>();

    // Sans regroupement, inutile de construire un tableau par ancre à chaque
    // image : aucun groupe ne peut dépasser un élément.
    const groups = threshold > 0
      ? this._computeClusters(
          [...pos2d.entries()].filter(([k]) => !noCluster.has(k)),
          threshold,
        )
      : [];

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
        const desc = describeEntity(entry.entityId);
        const st = this._hass?.states[entry.entityId];
        return {
          domain: entry.domain,
          label: entry.label,
          on: desc.isOn(st),
          color: entry.targetColor.clone(),
          icon: entry.icon ?? desc.icon(st),
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
      const hide = behind.has(name) || inCluster.has(name)
        || this.anchors.get(name)?.hidden || ov.conditionHidden;

      // Une roue d'actions gère elle-même son positionnement et sa visibilité :
      // son menu ouvert doit rester en place.
      if (ov instanceof ClusterOverlay) {
        if (hide) { ov.hide(); return; }
        const p = pos2d.get(name)!;
        ov.updatePosition(p.x, p.y);
        ov.show();
        return;
      }

      if (hide) { ov.el.style.display = 'none'; return; }
      const p = pos2d.get(name)!;

      // Une vignette de caméra est un objet de la scène, pas un badge : sa
      // taille suit la perspective, sinon elle semble rapetisser quand on
      // approche — la maison grandit, elle non.
      if (ov instanceof CameraOverlay) {
        const entry = this.anchors.get(name)!;
        // Largeur exprimee dans les unites du modele, quelles qu'elles soient.
        const units = this._modelSpan * CAMERA_WIDTH_RATIO * (entry.size ?? 1);
        const dist = this.camera!.position.distanceTo(entry.worldPos);
        // Projection : hauteur du viewport / hauteur visible a cette distance.
        const fov = (this.camera!.fov * Math.PI) / 180;
        const pxPerUnit = h / (2 * Math.max(dist, 1e-4) * Math.tan(fov / 2));
        ov.setPixelWidth(THREE.MathUtils.clamp(units * pxPerUnit, 28, 640));
      }

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
      const kind = entry.kind ?? 'entity';

      // Étiquette : texte seul, aucune entité.
      if (kind === 'label') {
        this.overlays.set(name, new LabelOverlay(
          this.overlayContainer!, entry.label, entry.icon, entry.color,
        ));
        return;
      }

      // Roue d'actions : le menu radial des regroupements, alimenté par les
      // actions de l'ancre au lieu des ancres voisines.
      if (kind === 'menu') {
        const wheel = new ClusterOverlay(this.overlayContainer!, {
          icon: entry.icon ?? 'mdi:dots-horizontal-circle',
          title: entry.label,
        });
        wheel.update(this._buildWheelItems(entry));
        wheel.show();
        this.overlays.set(name, wheel);
        return;
      }

      // Navigation : une pastille dont l'appui vole vers une vue.
      if (kind === 'nav') {
        this.overlays.set(name, new AnchorOverlay(
          this.overlayContainer!,
          'nav',
          entry.label,
          () => this._flyToViewId(entry.navViewId),
          () => this._flyToViewId(entry.navViewId),
          entry.icon ?? 'mdi:arrow-right-circle',
        ));
        return;
      }

      // La surcharge par ancre prime sur le descripteur : une camera peut etre
      // ramenee a une simple pastille.
      const wanted = entry.display && entry.display !== 'auto' ? entry.display : null;
      const overlayKind = wanted ?? describeEntity(entry.entityId).overlay;

      // Caméra : une vignette de l'image, à l'emplacement réel de l'appareil.
      if (overlayKind === 'thumbnail') {
        const cam = new CameraOverlay(
          this.overlayContainer!,
          entry.label,
          () => this._openMoreInfo(entry.entityId),
          t('camOffline'),
        );
        cam.setPicture(this._hass?.states[entry.entityId]?.attributes?.entity_picture as string | undefined);
        this.overlays.set(name, cam);
        return;
      }

      if (overlayKind === 'badge') {
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

  /**
   * Entrees d'une roue d'actions.
   *
   * Reconstruites a chaque mise a jour d'etat : une valeur de capteur affichee
   * dans la roue doit suivre l'entite, pas rester figee au chargement.
   */
  private _buildWheelItems(entry: AnchorEntry): ClusterItem[] {
    return (entry.actions ?? []).map((a) => {
      const target = this._actionTarget(a);
      const st = target ? this._hass?.states[target] : undefined;
      const desc = target ? describeEntity(target) : null;

      // Un capteur se lit : on affiche sa valeur et son unite au lieu d'une
      // icone qui ne dirait rien. Le texte vient du descripteur, pour qu'une
      // entite indisponible affiche « Indisponible » et non « unavailable ».
      const showsValue = !!desc && desc.overlay === 'badge' && !a.icon;
      const broken = !st || st.state === 'unavailable' || st.state === 'unknown';
      const unit = (st?.attributes?.unit_of_measurement as string) ?? '';
      const value = showsValue
        ? desc!.stateText(st) + (unit && !broken ? ` ${unit}` : '')
        : undefined;

      return {
        domain: '',
        // Un libellé vide se déduit de l'entité ciblée, puis du service :
        // retaper le nom d'une entité qu'on vient de choisir n'a pas de sens.
        label: a.label || this._actionFallbackLabel(a),
        on: desc ? desc.isOn(st) : false,
        color: new THREE.Color(
          a.icon || !desc
            ? (entry.color ?? '#7dd3fc')
            : '#' + desc.color(st).toString(16).padStart(6, '0'),
        ),
        icon: a.icon ?? desc?.icon(st) ?? this._actionDefaultIcon(a),
        value,
        onShortClick: () => this._runAnchorAction(a),
        onLongPress: () => this._runAnchorAction(a),
      };
    });
  }

  /** Entité visée par une action, quand il y en a une. */
  private _actionTarget(a: import('./types').AnchorAction): string | undefined {
    if (a.entity_id) return a.entity_id;
    // Repli : les premieres roues stockaient la cible dans service_data.
    const id = a.service_data?.entity_id;
    return typeof id === 'string' && id ? id : undefined;
  }

  /** Libellé de repli : nom de l'entité, sinon service, sinon vue. */
  private _actionFallbackLabel(a: import('./types').AnchorAction): string {
    const target = this._actionTarget(a);
    if (target) {
      const fn = this._hass?.states[target]?.attributes?.friendly_name;
      if (typeof fn === 'string' && fn) return fn;
      return target.split('.')[1] ?? target;
    }
    if (a.type === 'view') {
      const v = normalizeViews(this._scene?.camera_views ?? []).find((x) => x.id === a.view_id);
      if (v) return v.label;
    }
    if (a.domain && a.service) return `${a.domain}.${a.service}`;
    return t('anchorActionNew');
  }

  /** Icône de repli quand ni l'action ni l'entité n'en fournissent. */
  private _actionDefaultIcon(a: import('./types').AnchorAction): string {
    if (a.type === 'view') return 'mdi:video';
    if (a.domain === 'script') return 'mdi:script-text';
    if (a.domain === 'scene') return 'mdi:palette';
    // Même table que le sélecteur : une entrée de roue et sa ligne de liste
    // doivent porter la même icône.
    const target = this._actionTarget(a);
    if (target) return fallbackIcon(target.split('.')[0]);
    return 'mdi:play-circle-outline';
  }

  // ── Actions d'ancres (natures menu / nav) ──────────────────────────────

  /** Exécute une entrée de roue : appel de service, ou vol vers une vue. */
  private _runAnchorAction(action: import('./types').AnchorAction) {
    if (action.type === 'view') {
      this._flyToViewId(action.view_id);
      return;
    }
    if (action.type === 'entity') {
      const target = this._actionTarget(action);
      if (target) this._entityTapHandler(target)();
      return;
    }
    if (!action.domain || !action.service) {
      console.warn('[Owlnest] Action incomplète, ignorée :', action);
      return;
    }
    this._hass?.callService(action.domain, action.service, action.service_data ?? {});
  }

  /** Vole vers une vue caméra enregistrée, par identifiant. */
  private _flyToViewId(viewId: string | undefined) {
    if (!viewId) return;
    const view = normalizeViews(this._scene?.camera_views ?? [])
      .find((v) => v.id === viewId);
    if (!view) {
      console.warn(`[Owlnest] Vue « ${viewId} » introuvable.`);
      return;
    }
    this._viewMgr?.flyTo(view);
  }

  /** Service naturel des domaines « à déclencher ». */
  private static readonly ACTIVATE_SERVICE: Record<string, string> = {
    button: 'press',
    scene: 'turn_on',
    script: 'turn_on',
  };

  /**
   * Effet d'un appui sur une entite, selon son descripteur.
   *
   * Partage entre les pastilles d'ancres et les entrees de roue : une lampe se
   * bascule, un capteur ouvre sa fiche, et ce choix ne doit pas etre reecrit a
   * deux endroits.
   */
  private _entityTapHandler(
    entityId: string,
    override?: import('./entities/descriptors').TapAction | 'default',
  ): () => void {
    if (!entityId) return () => {};
    const domain = entityId.split('.')[0];
    const tap = override && override !== 'default' ? override : describeEntity(entityId).tap;
    const data = { entity_id: entityId };

    switch (tap) {
      case 'toggle':
        return () => this._hass?.callService(domain, 'toggle', data);
      case 'media_play_pause':
        return () => this._hass?.callService('media_player', 'media_play_pause', data);
      case 'activate': {
        const service = Ha3dFloorplan.ACTIVATE_SERVICE[domain] ?? 'turn_on';
        return () => this._hass?.callService(domain, service, data);
      }
      case 'none':
        return () => {};
      default:
        return () => this._openMoreInfo(entityId);
    }
  }

  private _getShortClickHandler(entry: AnchorEntry): () => void {
    return this._entityTapHandler(entry.entityId, entry.tapAction);
  }

  // ── Rules engine ────────────────────────────────────────────────────────

  private _evaluateRules() {
    if (!this._hass || !this._scene) return;
    const rules = (this._scene.rules ?? []) as OwlnestRule[];
    if (!rules.length) return;

    const actions = this._ruleEngine.evaluate(rules, this._hass);
    if (actions.length) {
      // Trace volontaire : sans elle, une regle qui ne part pas et une regle
      // qui part sans effet visible sont impossibles a distinguer.
      console.debug('[Owlnest] règle déclenchée →', actions.map((a) => a.type).join(', '));
    }
    for (const action of actions) this._executeAction(action);
  }

  /**
   * Exécute les actions d'une règle sans attendre son déclencheur.
   *
   * Utilisé par le bouton « Essayer » de l'éditeur : vérifier une règle en
   * ouvrant physiquement une porte n'est pas une méthode de travail.
   *
   * Le mode édition masque les overlays. Une mise en évidence y ferait donc
   * pulser un élément invisible, et le bouton paraîtrait sans effet — on les
   * révèle le temps de l'aperçu.
   */
  runRuleNow(rule: OwlnestRule) {
    const actions = rule.actions ?? [];
    const highlights = actions.filter((a) => a.type === 'highlight_anchor');
    if (highlights.length && this._editMode) {
      const longest = highlights.reduce(
        (m, a) => Math.max(m, (a as import('./rules/types').HighlightAnchorAction).duration ?? 6), 6);
      this._startRulePreview(longest);
    }
    for (const action of actions) this._executeAction(action);
  }

  /** Révèle les overlays pendant un aperçu de règle, puis les remasque. */
  private _startRulePreview(seconds: number) {
    this._previewingRule = true;
    if (this._previewTimer) clearTimeout(this._previewTimer);

    if (this.canvas) {
      this._updateOverlayPositions(this.canvas.offsetWidth, this.canvas.offsetHeight);
    }
    this._requestRender();

    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      this._previewingRule = false;
      // Sorti de l'édition entre-temps : les overlays doivent rester visibles.
      if (this._editMode) this.overlays.forEach((o) => { o.el.style.display = 'none'; });
    }, (seconds + 0.5) * 1000);
  }

  /** Ancre visee par une action, par entite puis par libelle. */
  private _findOverlayFor(target: string): AnyOverlay | null {
    let found: AnyOverlay | null = null;
    this.anchors.forEach((entry, key) => {
      if (found) return;
      if (entry.entityId === target || entry.label === target) {
        found = this.overlays.get(key) ?? null;
      }
    });
    return found;
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
      case 'highlight_anchor': {
        const ov = this._findOverlayFor(action.anchor);
        if (ov) pulseOverlay(ov.el, action.color ?? '#ef4444', (action.duration ?? 6) * 1000);
        else console.warn('[Owlnest] highlight_anchor : ancre introuvable :', action.anchor);
        break;
      }
      case 'toast':
        this._showToast(action.message, action.level === 'warn');
        break;
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

      // Étiquette, roue et navigation ne reflètent aucun état d'entité — sauf
      // une roue dont les entrées ciblent des entités.
      const kind = entry.kind ?? 'entity';
      if (kind !== 'entity') {
        if (overlay instanceof LabelOverlay) overlay.updateText(entry.label);
        if (overlay instanceof ClusterOverlay && entry.actions?.length) {
          overlay.update(this._buildWheelItems(entry));
        }
        return;
      }

      const stateObj = this._hass?.states[entry.entityId];

      if (overlay instanceof CameraOverlay) {
        const desc = describeEntity(entry.entityId);
        overlay.updateState(desc.isOn(stateObj), entry.label);
        // Le token de l'URL est renouvelé par HA : on suit sans forcer.
        overlay.setPicture(stateObj?.attributes?.entity_picture as string | undefined);
        return;
      }

      if (overlay instanceof SensorOverlay) {
        const rawValue = stateObj?.state ?? '\u2014';
        const unit = (stateObj?.attributes.unit_of_measurement as string) ?? '';
        const value = _formatSensorValue(rawValue, entry.precision);
        overlay.updateValue(value, unit, `${entry.label}: ${value}${unit}`);
        return;
      }

      if (overlay instanceof AnchorOverlay) {
        // Le descripteur porte l'ic\u00F4ne, le texte d'\u00E9tat et la s\u00E9mantique du
        // \u00AB allum\u00E9 \u00BB \u2014 un capteur d'ouverture affiche donc une porte ouverte,
        // pas un cercle bleu.
        const desc = describeEntity(entry.entityId);
        overlay.setStateIcon(desc.icon(stateObj), entry.domain);
        overlay.updateState(
          desc.isOn(stateObj),
          entry.targetColor,
          `${entry.label} \u2022 ${desc.stateText(stateObj)}`,
        );
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
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
    this._previewingRule = false;
    this._io?.disconnect();
    this._io = null;
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    this._onVisibility = null;
    this._paused = false;
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

// Garde-fou : redéfinir un custom element lève une exception. Le cas se produit
// si le module est chargé deux fois (ressource HACS + ressource de dev, par ex.).
if (!customElements.get('ha-3d-floorplan')) {
  customElements.define('ha-3d-floorplan', Ha3dFloorplan);
}

