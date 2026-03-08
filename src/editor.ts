import * as THREE from 'three';
import type { EditableAnchor } from './types';

function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text); return; }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  document.execCommand('copy');
  ta.remove();
}

export type EditorTool = 'select' | 'add' | 'delete';

type AnchorSnap = { key: string; entity: string; label: string; pos: [number, number, number] }[];

const AXIS_COLORS = { x: 0xFF3333, y: 0x33DD33, z: 0x3388FF };
const AXIS_DIRS: Record<string, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export class AnchorEditor {
  onChanged: (() => void) | null = null;
  onToolChange: ((tool: EditorTool) => void) | null = null;

  private _active = false;
  private _tool: EditorTool = 'select';
  private _raycaster = new THREE.Raycaster();
  private _anchors = new Map<string, EditableAnchor>();
  private _gizmoGroup: THREE.Group | null = null;
  private _selectedKey: string | null = null;
  private _dragAxis: string | null = null;
  private _dragPlane = new THREE.Plane();
  private _dragStart = new THREE.Vector3();
  private _markers = new Map<string, THREE.Mesh>();
  private _pendingPos: THREE.Vector3 | null = null;
  private _popup: HTMLDivElement | null = null;
  private _hoveredKey: string | null = null;
  private _undoStack: AnchorSnap[] = [];
  private _redoStack: AnchorSnap[] = [];

  private _scene: THREE.Scene;
  private _camera: THREE.PerspectiveCamera;
  private _canvas: HTMLCanvasElement;
  private _model: THREE.Object3D;
  private _overlayContainer: HTMLDivElement;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    model: THREE.Object3D,
    overlayContainer: HTMLDivElement,
  ) {
    this._scene = scene;
    this._camera = camera;
    this._canvas = canvas;
    this._model = model;
    this._overlayContainer = overlayContainer;
  }

  get active() { return this._active; }
  get tool() { return this._tool; }
  get anchors() { return this._anchors; }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  activate(editable: Map<string, EditableAnchor>) {
    this._active = true;
    this._tool = 'select';
    this._undoStack = [];
    this._redoStack = [];
    this._anchors = new Map(
      [...editable.entries()].map(([k, v]) => [k, { ...v, position: v.position.clone() }]),
    );
    this._anchors.forEach((a, key) => this._addMarker(key, a.position));
    this._canvas.addEventListener('pointerdown', this._onPointerDown, true);
    this._canvas.addEventListener('pointermove', this._onPointerMove, true);
    this._canvas.addEventListener('pointerup', this._onPointerUp, true);
    window.addEventListener('keydown', this._onKeyDown, true);
  }

  deactivate() {
    this._active = false;
    this._canvas.removeEventListener('pointerdown', this._onPointerDown, true);
    this._canvas.removeEventListener('pointermove', this._onPointerMove, true);
    this._canvas.removeEventListener('pointerup', this._onPointerUp, true);
    window.removeEventListener('keydown', this._onKeyDown, true);
    this._clearGizmo();
    this._markers.forEach((m) => {
      this._scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this._markers.clear();
    this._closePopup();
    this._selectedKey = null;
    this._hoveredKey = null;
    this._pendingPos = null;
    this._dragAxis = null;
    this._canvas.style.cursor = '';
  }

  setTool(tool: EditorTool) {
    this._tool = tool;
    if (tool !== 'select') {
      this._clearGizmo();
      this._selectedKey = null;
    }
    this._closePopup();
    this.onToolChange?.(tool);
  }

  deleteSelected() {
    if (this._selectedKey) this._deleteAnchor(this._selectedKey);
  }

  showExportPopup() {
    this._closePopup();
    const yaml = this._toYAML();
    const popup = this._makePopup('Export YAML', `
      <textarea readonly style="
        width:100%;height:180px;box-sizing:border-box;
        background:#0d1117;border:1px solid rgba(255,255,255,0.15);border-radius:6px;
        color:#aef;padding:8px 10px;font-size:11px;font-family:monospace;
        resize:none;outline:none;line-height:1.5;
      ">${yaml}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button data-action="copy" style="${this._btnStyle('#1a6bff')}">Copier</button>
        <button data-action="close" style="${this._btnStyle('transparent', true)}">Fermer</button>
      </div>
    `);
    const copyBtn = popup.querySelector('[data-action="copy"]') as HTMLButtonElement;
    copyBtn.addEventListener('click', () => {
      copyToClipboard(yaml);
      copyBtn.textContent = 'Copié !';
    });
    popup.querySelector('[data-action="close"]')!.addEventListener('click', () => this._closePopup());
  }

  // ── YAML ───────────────────────────────────────────────────────────────

  private _toYAML(): string {
    const lines = ['anchors:'];
    this._anchors.forEach((a) => {
      const [x, y, z] = a.position.toArray().map((v) => +v.toFixed(3));
      lines.push(`  - entity: ${a.entity}`);
      if (a.label && a.label !== a.entity.split('.')[1]) lines.push(`    label: "${a.label}"`);
      lines.push(`    position: [${x}, ${y}, ${z}]`);
    });
    return lines.join('\n');
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────────

  private _snap(): AnchorSnap {
    return [...this._anchors.entries()].map(([key, a]) => ({
      key, entity: a.entity, label: a.label,
      pos: [+a.position.x.toFixed(4), +a.position.y.toFixed(4), +a.position.z.toFixed(4)],
    }));
  }

  private _pushUndo() {
    this._undoStack.push(this._snap());
    this._redoStack = [];
  }

  private _restore(snap: AnchorSnap) {
    // Remove all current markers
    this._clearGizmo();
    this._selectedKey = null;
    this._markers.forEach((m) => {
      this._scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this._markers.clear();
    this._anchors.clear();

    // Rebuild from snapshot
    for (const s of snap) {
      const pos = new THREE.Vector3(...s.pos);
      this._anchors.set(s.key, { entity: s.entity, label: s.label, position: pos });
      this._addMarker(s.key, pos);
    }
    this.onChanged?.();
  }

  undo() {
    if (!this._undoStack.length) return;
    this._redoStack.push(this._snap());
    this._restore(this._undoStack.pop()!);
  }

  redo() {
    if (!this._redoStack.length) return;
    this._undoStack.push(this._snap());
    this._restore(this._redoStack.pop()!);
  }

  // ── Markers ─────────────────────────────────────────────────────────────

  private _addMarker(key: string, pos: THREE.Vector3) {
    const geo = new THREE.SphereGeometry(0.1, 14, 10);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFFDD00, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData.anchorKey = key;
    mesh.renderOrder = 999;
    this._scene.add(mesh);
    this._markers.set(key, mesh);
  }

  private _deleteAnchor(key: string) {
    this._pushUndo();
    this._anchors.delete(key);
    const m = this._markers.get(key);
    if (m) {
      this._scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this._markers.delete(key);
    }
    if (this._selectedKey === key) {
      this._clearGizmo();
      this._selectedKey = null;
    }
    this.onChanged?.();
  }

  // ── Gizmo ──────────────────────────────────────────────────────────────

  private _selectAnchor(key: string) {
    this._selectedKey = key;
    this._clearGizmo();
    const anchor = this._anchors.get(key);
    if (anchor) {
      this._buildGizmo(anchor.position);
      this._markers.forEach((m, k) => {
        (m.material as THREE.MeshBasicMaterial).color.setHex(k === key ? 0xFFFFFF : 0xFFDD00);
      });
    }
  }

  private _buildGizmo(pos: THREE.Vector3) {
    this._gizmoGroup = new THREE.Group();
    this._gizmoGroup.position.copy(pos);

    (['x', 'y', 'z'] as const).forEach((axis) => {
      const color = AXIS_COLORS[axis];

      const shaftGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8);
      const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = 0.3;
      shaft.renderOrder = 1000;
      shaft.userData.gizmoAxis = axis;

      const coneGeo = new THREE.ConeGeometry(0.08, 0.18, 8);
      const coneMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.y = 0.69;
      cone.renderOrder = 1000;
      cone.userData.gizmoAxis = axis;

      const hitGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.y = 0.45;
      hit.renderOrder = 1000;
      hit.userData.gizmoAxis = axis;

      const group = new THREE.Group();
      group.add(shaft, cone, hit);
      group.userData.gizmoAxis = axis;
      if (axis === 'x') group.rotation.z = -Math.PI / 2;
      else if (axis === 'z') group.rotation.x = Math.PI / 2;

      this._gizmoGroup!.add(group);
    });

    this._scene.add(this._gizmoGroup);
  }

  private _clearGizmo() {
    if (!this._gizmoGroup) return;
    this._gizmoGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this._scene.remove(this._gizmoGroup);
    this._gizmoGroup = null;
    this._markers.forEach((m) => {
      (m.material as THREE.MeshBasicMaterial).color.setHex(0xFFDD00);
    });
  }

  // ── NDC helper ─────────────────────────────────────────────────────────

  private _ndc(e: PointerEvent): THREE.Vector2 {
    const rect = this._canvas.getBoundingClientRect();
    return new THREE.Vector2(
      (e.clientX - rect.left) / rect.width * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private _startDrag(e: PointerEvent, axis: string) {
    this._pushUndo(); // snapshot before drag
    this._dragAxis = axis;
    this._canvas.setPointerCapture(e.pointerId);
    const pos = this._gizmoGroup!.position.clone();
    const axisDir = AXIS_DIRS[axis].clone();
    const toCam = new THREE.Vector3().subVectors(pos, this._camera.position).normalize();
    const perp = new THREE.Vector3().crossVectors(axisDir, toCam);
    const normal = new THREE.Vector3().crossVectors(axisDir, perp).normalize();
    this._dragPlane.setFromNormalAndCoplanarPoint(normal, pos);
    this._raycaster.ray.intersectPlane(this._dragPlane, this._dragStart);
  }

  // ── Entity picker popup ─────────────────────────────────────────────────

  private _showEntityPicker() {
    this._closePopup();
    const popup = this._makePopup('Nouvelle ancre', `
      <input data-field="entity" placeholder="entity_id  (ex: light.salon)" style="${this._inputStyle('margin-bottom:8px')}"/>
      <input data-field="label"  placeholder="label (optionnel)"             style="${this._inputStyle('margin-bottom:14px')}"/>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button data-action="cancel" style="${this._btnStyle('transparent', true)}">Annuler</button>
        <button data-action="ok"     style="${this._btnStyle('#1a6bff')}">Ajouter</button>
      </div>
    `);
    popup.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
      this._closePopup();
      this._pendingPos = null;
    });
    popup.querySelector('[data-action="ok"]')!.addEventListener('click', () => {
      const entity = (popup.querySelector('[data-field="entity"]') as HTMLInputElement).value.trim();
      const label = (popup.querySelector('[data-field="label"]') as HTMLInputElement).value.trim();
      if (!entity || !this._pendingPos) return;
      const key = `anchor_${Date.now()}_${entity}`;
      const anchor: EditableAnchor = {
        entity,
        position: this._pendingPos.clone(),
        label: label || entity.split('.')[1] || entity,
      };
      this._pushUndo();
      this._anchors.set(key, anchor);
      this._addMarker(key, anchor.position);
      this.setTool('select');
      this._selectAnchor(key);
      this._closePopup();
      this._pendingPos = null;
      this.onChanged?.();
      this.onToolChange?.('select');
    });
    setTimeout(() => {
      (popup.querySelector('[data-field="entity"]') as HTMLInputElement)?.focus();
    }, 50);
  }

  // ── Popup helpers ───────────────────────────────────────────────────────

  private _makePopup(title: string, content: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      'top:50%',
      'left:50%',
      'transform:translate(-50%,-50%)',
      'background:#1a1f2e',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:10px',
      'padding:16px 20px',
      'z-index:200',
      'min-width:280px',
      'width:340px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'font-family:var(--primary-font-family,sans-serif)',
      'color:#fff',
      'pointer-events:auto',
    ].join(';');
    el.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:#aac8e8">${title}</div>
      ${content}
    `;
    this._popup = el;
    this._overlayContainer.appendChild(el);
    return el;
  }

  private _closePopup() {
    this._popup?.remove();
    this._popup = null;
  }

  private _inputStyle(extra = ''): string {
    return [
      'width:100%',
      'box-sizing:border-box',
      'background:#0d1117',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:6px',
      'color:#fff',
      'padding:7px 10px',
      'font-size:13px',
      'outline:none',
      'display:block',
      extra,
    ].join(';');
  }

  private _btnStyle(bg: string, outline = false): string {
    return [
      `background:${bg}`,
      outline ? 'border:1px solid rgba(255,255,255,0.2)' : 'border:none',
      'color:' + (outline ? '#aaa' : '#fff'),
      'border-radius:6px',
      'padding:6px 14px',
      'cursor:pointer',
      'font-size:12px',
      outline ? '' : 'font-weight:600',
    ].filter(Boolean).join(';');
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private _onKeyDown = (e: KeyboardEvent) => {
    if (!this._active || this._popup) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z') { e.preventDefault(); e.stopImmediatePropagation(); this.undo(); return; }
    if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); e.stopImmediatePropagation(); this.redo(); return; }
    if (ctrl) return; // ignore other ctrl combos
    switch (e.key) {
      case 'Delete': case 'Backspace':
        if (this._selectedKey) { e.preventDefault(); this._deleteAnchor(this._selectedKey); }
        break;
      case 'Escape':
        e.preventDefault();
        if (this._selectedKey) { this._clearGizmo(); this._selectedKey = null; }
        else this.setTool('select');
        break;
      case 's': case 'S': this.setTool('select'); this.onToolChange?.('select'); break;
      case 'a': case 'A': this.setTool('add');    this.onToolChange?.('add');    break;
      case 'd': case 'D': this.setTool('delete'); this.onToolChange?.('delete'); break;
    }
  };

  private _onPointerDown = (e: PointerEvent) => {
    if (!this._active || e.button !== 0) return;
    if (this._popup) {
      e.stopImmediatePropagation();
      return;
    }
    const ndc = this._ndc(e);
    this._raycaster.setFromCamera(ndc, this._camera);

    if (this._tool === 'select') {
      if (this._gizmoGroup) {
        const hits = this._raycaster.intersectObject(this._gizmoGroup, true);
        if (hits.length > 0) {
          const axis = hits[0].object.userData.gizmoAxis as string;
          if (axis) {
            e.stopImmediatePropagation();
            this._startDrag(e, axis);
            return;
          }
        }
      }
      const hits = this._raycaster.intersectObjects([...this._markers.values()], false);
      if (hits.length > 0) {
        e.stopImmediatePropagation();
        this._selectAnchor(hits[0].object.userData.anchorKey as string);
        return;
      }
      if (this._selectedKey) {
        this._clearGizmo();
        this._selectedKey = null;
      }
    }

    if (this._tool === 'add') {
      const hits = this._raycaster.intersectObject(this._model, true);
      if (hits.length > 0) {
        e.stopImmediatePropagation();
        this._pendingPos = hits[0].point.clone();
        this._showEntityPicker();
      }
    }

    if (this._tool === 'delete') {
      const hits = this._raycaster.intersectObjects([...this._markers.values()], false);
      if (hits.length > 0) {
        e.stopImmediatePropagation();
        this._deleteAnchor(hits[0].object.userData.anchorKey as string);
      }
    }
  };

  private _onPointerMove = (e: PointerEvent) => {
    if (!this._active) return;

    // Hover highlight (only when not dragging)
    if (!this._dragAxis) {
      const ndc = this._ndc(e);
      this._raycaster.setFromCamera(ndc, this._camera);
      const hits = this._raycaster.intersectObjects([...this._markers.values()], false);
      const newHover = hits.length > 0 ? (hits[0].object.userData.anchorKey as string) : null;
      if (newHover !== this._hoveredKey) {
        if (this._hoveredKey && this._hoveredKey !== this._selectedKey) {
          (this._markers.get(this._hoveredKey)?.material as THREE.MeshBasicMaterial)?.color.setHex(0xFFDD00);
        }
        if (newHover && newHover !== this._selectedKey) {
          (this._markers.get(newHover)?.material as THREE.MeshBasicMaterial)?.color.setHex(0xFFFFAA);
        }
        this._hoveredKey = newHover;
        this._canvas.style.cursor = newHover ? 'pointer' : '';
      }
    }

    if (!this._dragAxis || !this._gizmoGroup) return;
    e.stopImmediatePropagation();
    const ndc = this._ndc(e);
    this._raycaster.setFromCamera(ndc, this._camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, hit)) return;
    const delta = new THREE.Vector3().subVectors(hit, this._dragStart);
    const axisDir = AXIS_DIRS[this._dragAxis];
    const dist = delta.dot(axisDir);
    const newPos = this._gizmoGroup.position.clone().addScaledVector(axisDir, dist);
    this._dragStart.copy(hit);
    this._gizmoGroup.position.copy(newPos);
    if (this._selectedKey) {
      const anchor = this._anchors.get(this._selectedKey);
      if (anchor) {
        anchor.position.copy(newPos);
        this._markers.get(this._selectedKey)?.position.copy(newPos);
      }
    }
    this.onChanged?.();
  };

  private _onPointerUp = (e: PointerEvent) => {
    if (this._dragAxis) {
      this._canvas.releasePointerCapture(e.pointerId);
      this._dragAxis = null;
    }
  };
}
