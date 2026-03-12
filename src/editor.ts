import * as THREE from 'three';
import type { EditableAnchor, LightStyle } from './types';

export type EditorTool = 'select' | 'add' | 'delete' | 'rotate' | 'add_panel';

type AnchorSnap = {
  key: string; entity: string; label: string;
  pos: [number, number, number];
  hidden?: boolean; lightStyle?: LightStyle; lightIntensity?: number;
  lightDirection?: [number, number, number];
}[];

const AXIS_COLORS = { x: 0xFF3333, y: 0x33DD33, z: 0x3388FF };
const AXIS_DIRS: Record<string, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export class AnchorEditor {
  onChanged: (() => void) | null = null;
  onToolChange: ((tool: EditorTool) => void) | null = null;
  onSelectionChange: ((key: string | null) => void) | null = null;
  onDragStart: ((type: 'grab' | 'rotate' | 'gizmo') => void) | null = null;
  onDragEnd: (() => void) | null = null;

  private _active = false;
  private _hass: import('./types').Hass | null = null;

  setHass(hass: import('./types').Hass | null) { this._hass = hass; }
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
  private _markerRadius = 0.1;
  private _rotGizmoGroup: THREE.Group | null = null;
  private _rotAxis: 'x' | 'y' | 'z' | null = null;
  private _rotDragPlane = new THREE.Plane();
  private _rotDragStart = new THREE.Vector3();
  private _rotInitDir: [number, number, number] = [0, -1, 0];
  private _rotDirLine: THREE.Line | null = null;

  // G-grab mode (Blender-style immediate move)
  private _grabMode = false;
  private _grabConstraint: 'x' | 'y' | 'z' | null = null;
  private _grabOrigin = new THREE.Vector3();
  private _grabPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private _grabOffset = new THREE.Vector3(); // offset for direct-drag (no teleport)

  // Direct drag (click-drag on marker without pressing G)
  private _directDragKey: string | null = null;
  private _directDragStartX = 0;
  private _directDragStartY = 0;

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
  get selectedKey() { return this._selectedKey; }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  activate(editable: Map<string, EditableAnchor>) {
    // Auto-scale markers relative to model size
    const box = new THREE.Box3().setFromObject(this._model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    this._markerRadius = Math.max(0.03, maxDim * 0.012);

    this._active = true;
    this._tool = 'select';
    this._undoStack = [];
    this._redoStack = [];
    this._anchors = new Map(
      [...editable.entries()].map(([k, v]) => [k, { ...v, position: v.position.clone() }]),
    );
    this._anchors.forEach((a, key) => this._addMarker(key, a.position, a.hidden));
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
    this._clearRotGizmo();
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
    this._rotAxis = null;
    this._canvas.style.cursor = '';
  }

  setTool(tool: EditorTool) {
    this._tool = tool;
    if (tool === 'add' || tool === 'delete') {
      this._clearGizmo();
      this._selectedKey = null;
      this.onSelectionChange?.(null);
    }
    // Keep rot gizmo visible if selected anchor is spot/beam
    const selAnchor = this._selectedKey ? this._anchors.get(this._selectedKey) : null;
    const isDirectional = selAnchor?.lightStyle === 'spot' || selAnchor?.lightStyle === 'beam';
    if (tool !== 'rotate' && !isDirectional) {
      this._clearRotGizmo();
    }
    if ((tool === 'rotate' || isDirectional) && this._selectedKey && selAnchor) {
      if (!this._rotGizmoGroup) this._buildRotGizmo(selAnchor.position, selAnchor.lightDirection);
    }
    this._closePopup();
    this.onToolChange?.(tool);
  }

  deleteSelected() {
    if (this._selectedKey) this._deleteAnchor(this._selectedKey);
  }

  duplicate() {
    if (!this._selectedKey) return;
    const src = this._anchors.get(this._selectedKey);
    if (!src) return;
    this._pushUndo();
    const key = `anchor_${Date.now()}_copy`;
    const pos = src.position.clone().add(new THREE.Vector3(0.3, 0, 0.3));
    const newAnchor: EditableAnchor = { ...src, position: pos };
    this._anchors.set(key, newAnchor);
    this._addMarker(key, pos, newAnchor.hidden);
    this._selectAnchor(key);
    this.onChanged?.();
  }

  /** Batch-update a property on every anchor (single undo entry). */
  updateAll(props: Partial<EditableAnchor>) {
    this._pushUndo();
    this._anchors.forEach((a, key) => {
      Object.assign(a, props);
      const marker = this._markers.get(key);
      if (marker && props.hidden !== undefined) {
        const mat = marker.material as THREE.MeshBasicMaterial;
        mat.opacity = a.hidden ? 0.25 : 1;
        mat.transparent = !!a.hidden;
        mat.color.setHex(a.hidden ? 0x888888 : (key === this._selectedKey ? 0xFFFFFF : 0xFFDD00));
      }
    });
    this.onChanged?.();
  }

  selectAnchor(key: string) { this._selectAnchor(key); }

  updateAnchor(key: string, props: Partial<EditableAnchor>) {
    const anchor = this._anchors.get(key);
    if (!anchor) return;
    this._pushUndo();
    Object.assign(anchor, props);
    // Sync rotation gizmo when lightStyle changes on selected anchor
    if ('lightStyle' in props && key === this._selectedKey) {
      const isDirectional = anchor.lightStyle === 'spot' || anchor.lightStyle === 'beam';
      if (isDirectional) {
        this._clearRotGizmo();
        this._buildRotGizmo(anchor.position, anchor.lightDirection);
      } else {
        this._clearRotGizmo();
      }
    }
    const marker = this._markers.get(key);
    if (marker) {
      const mat = marker.material as THREE.MeshBasicMaterial;
      mat.opacity = anchor.hidden ? 0.25 : (key === this._selectedKey ? 1 : 1);
      mat.transparent = !!anchor.hidden;
      mat.color.setHex(anchor.hidden ? 0x888888 : (key === this._selectedKey ? 0xFFFFFF : 0xFFDD00));
    }
    this.onChanged?.();
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────────

  private _snap(): AnchorSnap {
    return [...this._anchors.entries()].map(([key, a]) => ({
      key, entity: a.entity, label: a.label,
      pos: [+a.position.x.toFixed(4), +a.position.y.toFixed(4), +a.position.z.toFixed(4)],
      hidden: a.hidden,
      lightStyle: a.lightStyle,
      lightIntensity: a.lightIntensity,
      lightDirection: a.lightDirection,
    }));
  }

  private _pushUndo() {
    this._undoStack.push(this._snap());
    this._redoStack = [];
  }

  private _restore(snap: AnchorSnap) {
    this._clearGizmo();
    this._selectedKey = null;
    this.onSelectionChange?.(null);
    this._markers.forEach((m) => {
      this._scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this._markers.clear();
    this._anchors.clear();

    for (const s of snap) {
      const pos = new THREE.Vector3(...s.pos);
      this._anchors.set(s.key, {
        entity: s.entity, label: s.label, position: pos,
        hidden: s.hidden, lightStyle: s.lightStyle, lightIntensity: s.lightIntensity,
        lightDirection: s.lightDirection,
      });
      this._addMarker(s.key, pos, s.hidden);
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

  private _addMarker(key: string, pos: THREE.Vector3, hidden = false) {
    const geo = new THREE.SphereGeometry(this._markerRadius, 14, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: hidden ? 0x888888 : 0xFFDD00,
      depthTest: false,
      transparent: !!hidden,
      opacity: hidden ? 0.25 : 1,
    });
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
      this.onSelectionChange?.(null);
    }
    this.onChanged?.();
  }

  // ── Gizmo ──────────────────────────────────────────────────────────────

  private _selectAnchor(key: string) {
    this._selectedKey = key;
    this._clearGizmo();
    this._clearRotGizmo();
    const anchor = this._anchors.get(key);
    if (anchor) {
      if (this._tool === 'select') {
        this._buildGizmo(anchor.position);
      }
      this._markers.forEach((m, k) => {
        const a = this._anchors.get(k);
        const isHidden = a?.hidden ?? false;
        (m.material as THREE.MeshBasicMaterial).color.setHex(
          k === key ? 0xFFFFFF : (isHidden ? 0x888888 : 0xFFDD00)
        );
      });
      // Show rotation gizmo for directional lights regardless of active tool
      const isDirectional = anchor.lightStyle === 'spot' || anchor.lightStyle === 'beam';
      if (this._tool === 'rotate' || isDirectional) {
        this._buildRotGizmo(anchor.position, anchor.lightDirection);
      }
    }
    this.onSelectionChange?.(key);
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
    this._markers.forEach((m, k) => {
      const a = this._anchors.get(k);
      const isHidden = a?.hidden ?? false;
      (m.material as THREE.MeshBasicMaterial).color.setHex(isHidden ? 0x888888 : 0xFFDD00);
    });
  }

  // ── Rotation gizmo ─────────────────────────────────────────────────────

  /** Build or rebuild the rotation rings gizmo at the given position. */
  private _buildRotGizmo(pos: THREE.Vector3, dir?: [number, number, number]) {
    this._clearRotGizmo();
    const anchor = this._selectedKey ? this._anchors.get(this._selectedKey) : null;
    const style = anchor?.lightStyle ?? 'point';
    if (style !== 'spot' && style !== 'beam') return;

    const group = new THREE.Group();
    group.position.copy(pos);
    const R = this._markerRadius * 5;
    const TUBE = R * 0.045;

    const ringDefs: { axis: 'x' | 'y' | 'z'; color: number; rx: number; ry: number; rz: number }[] = [
      { axis: 'x', color: 0xFF4444, rx: 0, ry: Math.PI / 2, rz: 0 },
      { axis: 'y', color: 0x44DD44, rx: Math.PI / 2, ry: 0, rz: 0 },
      { axis: 'z', color: 0x4488FF, rx: 0, ry: 0, rz: 0 },
    ];

    for (const { axis, color, rx, ry, rz } of ringDefs) {
      // Visible ring
      const geo = new THREE.TorusGeometry(R, TUBE, 8, 64);
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(rx, ry, rz);
      mesh.renderOrder = 999;
      mesh.userData.rotAxis = axis;
      group.add(mesh);

      // Invisible thick ring for easier picking
      const pickGeo = new THREE.TorusGeometry(R, TUBE * 5, 4, 64);
      const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });
      const pickMesh = new THREE.Mesh(pickGeo, pickMat);
      pickMesh.rotation.set(rx, ry, rz);
      pickMesh.renderOrder = 998;
      pickMesh.userData.rotAxis = axis;
      group.add(pickMesh);
    }

    // Direction indicator line
    const d = dir ?? [0, -1, 0];
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(d[0] * R * 1.3, d[1] * R * 1.3, d[2] * R * 1.3),
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF, depthTest: false });
    this._rotDirLine = new THREE.Line(lineGeo, lineMat);
    this._rotDirLine.renderOrder = 1000;
    group.add(this._rotDirLine);

    this._scene.add(group);
    this._rotGizmoGroup = group;
  }

  private _clearRotGizmo() {
    if (this._rotGizmoGroup) {
      this._scene.remove(this._rotGizmoGroup);
      this._rotGizmoGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
        if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this._rotGizmoGroup = null;
      this._rotDirLine = null;
    }
  }

  /** Update just the direction indicator line inside the rotation gizmo. */
  private _updateRotGizmoDir(dir: [number, number, number]) {
    if (!this._rotDirLine || !this._rotGizmoGroup) return;
    const R = this._markerRadius * 5;
    const positions = this._rotDirLine.geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(1, dir[0] * R * 1.3, dir[1] * R * 1.3, dir[2] * R * 1.3);
    positions.needsUpdate = true;
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
    this._pushUndo();
    this._dragAxis = axis;
    this._canvas.setPointerCapture(e.pointerId);
    this.onDragStart?.('gizmo');
    const pos = this._gizmoGroup!.position.clone();
    const axisDir = AXIS_DIRS[axis].clone();
    const toCam = new THREE.Vector3().subVectors(pos, this._camera.position).normalize();
    const perp = new THREE.Vector3().crossVectors(axisDir, toCam);
    const normal = new THREE.Vector3().crossVectors(axisDir, perp).normalize();
    this._dragPlane.setFromNormalAndCoplanarPoint(normal, pos);
    this._raycaster.ray.intersectPlane(this._dragPlane, this._dragStart);
  }

  private _startRotDrag(e: PointerEvent, axis: 'x' | 'y' | 'z') {
    this._pushUndo();
    this._rotAxis = axis;
    this._canvas.setPointerCapture(e.pointerId);
    this.onDragStart?.('rotate');

    const center = this._rotGizmoGroup!.position;
    const axisVec = axis === 'x' ? new THREE.Vector3(1, 0, 0)
      : axis === 'y' ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
    this._rotDragPlane.setFromNormalAndCoplanarPoint(axisVec, center);

    const ndc = this._ndc(e);
    this._raycaster.setFromCamera(ndc, this._camera);
    const hit = new THREE.Vector3();
    this._raycaster.ray.intersectPlane(this._rotDragPlane, hit);
    this._rotDragStart.subVectors(hit, center).normalize();

    const anchor = this._selectedKey ? this._anchors.get(this._selectedKey) : null;
    this._rotInitDir = anchor?.lightDirection ? [...anchor.lightDirection] as [number, number, number] : [0, -1, 0];
  }

  // ── Entity picker popup ─────────────────────────────────────────────────

  private _showEntityPicker() {
    this._closePopup();

    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:#1a1f2e', 'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:10px', 'padding:16px 20px',
      'z-index:200', 'width:340px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'font-family:var(--primary-font-family,sans-serif)',
      'color:#fff', 'pointer-events:auto',
    ].join(';');

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:12px;color:#aac8e8';
    titleEl.textContent = 'Nouvelle ancre';
    el.appendChild(titleEl);

    const acWrap = document.createElement('div');
    acWrap.style.cssText = 'position:relative;margin-bottom:8px;';

    const entityInput = document.createElement('input');
    entityInput.placeholder = 'entity_id  (ex: light.salon)';
    entityInput.style.cssText = this._inputStyle('');
    acWrap.appendChild(entityInput);

    let dropdown: HTMLDivElement | null = null;

    const DOMAIN_COLORS: Record<string, string> = {
      light: '#ffd700', switch: '#4caf50', cover: '#ff9800',
      sensor: '#2196f3', binary_sensor: '#00bcd4',
      climate: '#f44336', media_player: '#9c27b0',
    };

    const showDropdown = (q: string) => {
      dropdown?.remove(); dropdown = null;
      if (!this._hass || q.length < 1) return;
      const lq = q.toLowerCase();
      const matches = Object.entries(this._hass.states)
        .filter(([id, s]) => {
          const fn = (s.attributes.friendly_name as string ?? '').toLowerCase();
          return id.includes(lq) || fn.includes(lq);
        })
        .slice(0, 12);
      if (!matches.length) return;

      dropdown = document.createElement('div');
      dropdown.style.cssText = [
        'position:absolute', 'top:100%', 'left:0', 'right:0',
        'background:#1a1f2e', 'border:1px solid rgba(255,255,255,0.2)',
        'border-top:none', 'border-radius:0 0 8px 8px',
        'max-height:180px', 'overflow-y:auto',
        'z-index:10', 'box-shadow:0 6px 20px rgba(0,0,0,0.6)',
      ].join(';');

      for (const [id, s] of matches) {
        const fn = s.attributes.friendly_name as string ?? '';
        const domain = id.split('.')[0];
        const name = id.split('.')[1];
        const color = DOMAIN_COLORS[domain] ?? '#aaa';

        const item = document.createElement('div');
        item.style.cssText = 'padding:7px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);line-height:1.4;';
        item.innerHTML =
          `<span style="color:${color};font-size:10px;font-weight:700;">${domain}</span>` +
          `<span style="color:#fff">.</span>` +
          `<span style="color:#7dd3fc;font-size:13px;">${name}</span>` +
          (fn ? `<br><span style="font-size:10px;color:#888;">${fn}</span>` : '');

        item.addEventListener('mouseover', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
        item.addEventListener('mouseout', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          entityInput.value = id;
          if (!labelInput.value) {
            labelInput.value = fn || name || '';
          }
          dropdown?.remove(); dropdown = null;
        });
        dropdown.appendChild(item);
      }
      acWrap.appendChild(dropdown);
    };

    entityInput.addEventListener('input', () => showDropdown(entityInput.value));
    entityInput.addEventListener('blur', () => setTimeout(() => { dropdown?.remove(); dropdown = null; }, 200));
    el.appendChild(acWrap);

    const labelInput = document.createElement('input');
    labelInput.placeholder = 'Label (optionnel — sinon déduit de l\'entity)';
    labelInput.style.cssText = this._inputStyle('margin-bottom:14px');
    el.appendChild(labelInput);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Annuler';
    cancelBtn.style.cssText = this._btnStyle('transparent', true);
    cancelBtn.addEventListener('click', () => { this._closePopup(); this._pendingPos = null; });

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Ajouter';
    okBtn.style.cssText = this._btnStyle('#1a6bff');
    okBtn.addEventListener('click', () => {
      const entity = entityInput.value.trim();
      const label = labelInput.value.trim();
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

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    el.appendChild(btnRow);

    this._popup = el;
    this._overlayContainer.appendChild(el);
    setTimeout(() => entityInput.focus(), 50);
  }

  // ── Popup helpers ───────────────────────────────────────────────────────

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

  private _startGrab(offset = new THREE.Vector3()) {
    if (!this._selectedKey) return;
    const anchor = this._anchors.get(this._selectedKey);
    if (!anchor) return;
    this._grabOrigin.copy(anchor.position);
    this._grabConstraint = null;
    this._grabMode = true;
    this._grabOffset.copy(offset);
    this._grabPlane.set(new THREE.Vector3(0, 1, 0), -anchor.position.y);
    this._canvas.style.cursor = 'crosshair';
    this.onDragStart?.('grab');
  }

  private _confirmGrab() {
    this._grabMode = false;
    this._grabConstraint = null;
    this._canvas.style.cursor = '';
    this.onDragEnd?.();
  }

  private _cancelGrab() {
    if (this._grabMode && this._selectedKey) {
      const anchor = this._anchors.get(this._selectedKey);
      if (anchor) {
        anchor.position.copy(this._grabOrigin);
        this._gizmoGroup?.position.copy(this._grabOrigin);
        this._rotGizmoGroup?.position.copy(this._grabOrigin);
        this._markers.get(this._selectedKey)?.position.copy(this._grabOrigin);
      }
      this.onChanged?.();
    }
    this._grabMode = false;
    this._grabConstraint = null;
    this._canvas.style.cursor = '';
    this.onDragEnd?.();
  }

  private _showContextMenu(e: PointerEvent, key: string) {
    this._closePopup();
    const anchor = this._anchors.get(key);
    if (!anchor) return;

    const containerRect = this._overlayContainer.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.style.cssText = [
      `left:${e.clientX - containerRect.left}px`,
      `top:${e.clientY - containerRect.top}px`,
      'position:absolute', 'background:#131820',
      'border:1px solid rgba(255,255,255,0.12)', 'border-radius:9px',
      'padding:4px 0', 'min-width:168px', 'z-index:2000',
      'box-shadow:0 10px 32px rgba(0,0,0,0.75)', 'font-size:12px',
      'font-family:inherit', 'user-select:none',
    ].join(';');

    const item = (label: string, shortcut: string, action: () => void, danger = false) => {
      const el = document.createElement('div');
      el.style.cssText = [
        'padding:7px 14px', 'cursor:pointer', 'display:flex',
        'justify-content:space-between', 'align-items:center', 'gap:18px',
        `color:${danger ? '#f87171' : '#e2e8f0'}`, 'border-radius:5px', 'margin:1px 3px',
      ].join(';');
      el.innerHTML = `<span>${label}</span><span style="color:rgba(255,255,255,0.28);font-size:10px;letter-spacing:.03em">${shortcut}</span>`;
      el.addEventListener('mouseenter', () => { el.style.background = 'rgba(255,255,255,0.08)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); this._closePopup(); action(); });
      return el;
    };
    const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:rgba(255,255,255,0.07);margin:3px 0;'; return s; };

    menu.appendChild(item('Saisir', 'G', () => { this.setTool('select'); this._selectAnchor(key); this._startGrab(); }));
    const style = anchor.lightStyle ?? 'point';
    if (style === 'spot' || style === 'beam') {
      menu.appendChild(item('Orienter', 'R', () => { this.setTool('rotate'); this._selectAnchor(key); }));
    }
    menu.appendChild(sep());
    menu.appendChild(item('Dupliquer', 'Ctrl+D', () => { this._selectAnchor(key); this.duplicate(); }));
    menu.appendChild(item(anchor.hidden ? 'Afficher' : 'Masquer', 'H', () => this.updateAnchor(key, { hidden: !anchor.hidden })));
    menu.appendChild(sep());
    menu.appendChild(item('Supprimer', 'X', () => this._deleteAnchor(key), true));

    this._popup = menu;
    this._overlayContainer.appendChild(menu);
    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) { this._closePopup(); document.removeEventListener('mousedown', close); }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private _onKeyDown = (e: KeyboardEvent) => {
    if (!this._active) return;

    // Block shortcuts while typing in inputs.
    // Must traverse shadow roots — document.activeElement only points to the host element.
    const getDeepActive = (): Element | null => {
      let el: Element | null = document.activeElement;
      while (el?.shadowRoot) el = el.shadowRoot.activeElement;
      return el;
    };
    const active = getDeepActive();
    const inInput = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || (active instanceof HTMLElement && active.isContentEditable);
    if (inInput) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); (active as HTMLElement).blur(); }
      e.stopPropagation();
      return;
    }

    // Grab mode: only axis-constraint, confirm, cancel
    if (this._grabMode) {
      e.preventDefault(); e.stopImmediatePropagation();
      switch (e.key) {
        case 'x': case 'X': this._grabConstraint = this._grabConstraint === 'x' ? null : 'x'; break;
        case 'y': case 'Y': this._grabConstraint = this._grabConstraint === 'y' ? null : 'y'; break;
        case 'z': case 'Z': this._grabConstraint = this._grabConstraint === 'z' ? null : 'z'; break;
        case 'Escape': case 'Mouse2': this._cancelGrab(); break;
        case 'Enter': this._confirmGrab(); break;
      }
      return;
    }

    if (this._popup) { if (e.key === 'Escape') { e.preventDefault(); this._closePopup(); } return; }

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z') { e.preventDefault(); e.stopImmediatePropagation(); this.undo(); return; }
    if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); e.stopImmediatePropagation(); this.redo(); return; }
    if (ctrl && e.key === 'd') { e.preventDefault(); e.stopImmediatePropagation(); this.duplicate(); return; }
    if (ctrl) return;

    switch (e.key) {
      case 'Delete': case 'Backspace': case 'x': case 'X':
        if (this._selectedKey) { e.preventDefault(); this._deleteAnchor(this._selectedKey); }
        break;
      case 'g': case 'G': e.preventDefault(); this._startGrab(); break;
      case 'h': case 'H':
        if (this._selectedKey) {
          const a = this._anchors.get(this._selectedKey);
          if (a) this.updateAnchor(this._selectedKey, { hidden: !a.hidden });
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (this._selectedKey) { this._clearGizmo(); this._clearRotGizmo(); this._selectedKey = null; this.onSelectionChange?.(null); }
        else this.setTool('select');
        break;
      case 's': case 'S': this.setTool('select'); break;
      case 'r': case 'R': this.setTool('rotate'); break;
      case 'a': case 'A': this.setTool('add'); break;
    }
  };

  private _onPointerDown = (e: PointerEvent) => {
    if (!this._active) return;

    // Confirm/cancel grab on any click
    if (this._grabMode) {
      e.stopImmediatePropagation();
      if (e.button === 0) this._confirmGrab();
      else this._cancelGrab();
      return;
    }

    if (this._popup) { e.stopImmediatePropagation(); return; }

    const ndc = this._ndc(e);
    this._raycaster.setFromCamera(ndc, this._camera);

    // Right-click: context menu on anchor
    if (e.button === 2) {
      const hits = this._raycaster.intersectObjects([...this._markers.values()], false);
      if (hits.length > 0) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const key = hits[0].object.userData.anchorKey as string;
        if (key !== this._selectedKey) this._selectAnchor(key);
        this._showContextMenu(e, key);
      }
      return;
    }

    if (e.button !== 0) return;

    // Rotation gizmo (rotate tool)
    if (this._tool === 'rotate' && this._rotGizmoGroup) {
      const rotHits = this._raycaster.intersectObjects(this._rotGizmoGroup.children, false);
      const rotHit = rotHits.find(h => h.object.userData.rotAxis);
      if (rotHit) {
        e.stopImmediatePropagation();
        this._startRotDrag(e, rotHit.object.userData.rotAxis as 'x' | 'y' | 'z');
        return;
      }
      // Click marker to re-select
      const mHits = this._raycaster.intersectObjects([...this._markers.values()], false);
      if (mHits.length) {
        const k = [...this._markers.entries()].find(([, m]) => m === mHits[0].object)?.[0];
        if (k) { e.stopImmediatePropagation(); this._selectAnchor(k); }
      }
      return;
    }

    // Select tool
    if (this._tool === 'select') {
      // Gizmo arrow drag
      if (this._gizmoGroup) {
        const hits = this._raycaster.intersectObject(this._gizmoGroup, true);
        if (hits.length > 0 && hits[0].object.userData.gizmoAxis) {
          e.stopImmediatePropagation();
          this._startDrag(e, hits[0].object.userData.gizmoAxis as string);
          return;
        }
      }
      // Marker select (+ arm direct-drag)
      const hits = this._raycaster.intersectObjects([...this._markers.values()], false);
      if (hits.length > 0) {
        e.stopImmediatePropagation();
        const key = hits[0].object.userData.anchorKey as string;
        this._selectAnchor(key);
        this._directDragKey = key;
        this._directDragStartX = e.clientX;
        this._directDragStartY = e.clientY;
        this._canvas.setPointerCapture(e.pointerId);
        return;
      }
      // Click empty → deselect
      this._clearGizmo(); this._clearRotGizmo();
      this._selectedKey = null;
      this.onSelectionChange?.(null);
    }

    // Add tool
    if (this._tool === 'add') {
      const hits = this._raycaster.intersectObject(this._model, true);
      if (hits.length > 0) {
        e.stopImmediatePropagation();
        this._pendingPos = hits[0].point.clone();
        this._showEntityPicker();
      }
    }
  };

  private _onPointerMove = (e: PointerEvent) => {
    if (!this._active) return;

    // Direct drag: click-drag on marker triggers grab (no G key needed)
    if (this._directDragKey) {
      const dx = e.clientX - this._directDragStartX;
      const dy = e.clientY - this._directDragStartY;
      if (dx * dx + dy * dy > 25) { // 5px threshold
        e.stopImmediatePropagation();
        this._pushUndo();
        // Compute offset so anchor doesn't teleport to cursor
        const anchor = this._anchors.get(this._directDragKey);
        const offset = new THREE.Vector3();
        if (anchor) {
          const ndc = this._ndc(e);
          this._raycaster.setFromCamera(ndc, this._camera);
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -anchor.position.y);
          const hit = new THREE.Vector3();
          if (this._raycaster.ray.intersectPlane(plane, hit)) {
            offset.subVectors(hit, anchor.position);
          }
        }
        this._startGrab(offset);
        this._directDragKey = null;
      }
      return;
    }

    // G-grab mode
    if (this._grabMode && this._selectedKey) {
      e.stopImmediatePropagation();
      const ndc = this._ndc(e);
      this._raycaster.setFromCamera(ndc, this._camera);
      const hit = new THREE.Vector3();
      let plane = this._grabPlane; // horizontal XZ by default
      if (this._grabConstraint === 'y') {
        // For Y: use a camera-facing vertical plane through anchor
        const camDir = new THREE.Vector3();
        this._camera.getWorldDirection(camDir);
        camDir.y = 0; if (camDir.lengthSq() < 0.001) camDir.set(1, 0, 0); else camDir.normalize();
        const anchor = this._anchors.get(this._selectedKey)!;
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, anchor.position);
      }
      if (!this._raycaster.ray.intersectPlane(plane, hit)) return;
      const anchor = this._anchors.get(this._selectedKey)!;
      const newPos = anchor.position.clone();
      if (this._grabConstraint === 'x') newPos.x = hit.x - this._grabOffset.x;
      else if (this._grabConstraint === 'y') newPos.y = hit.y - this._grabOffset.y;
      else if (this._grabConstraint === 'z') newPos.z = hit.z - this._grabOffset.z;
      else { newPos.x = hit.x - this._grabOffset.x; newPos.z = hit.z - this._grabOffset.z; }
      anchor.position.copy(newPos);
      this._gizmoGroup?.position.copy(newPos);
      this._rotGizmoGroup?.position.copy(newPos);
      this._markers.get(this._selectedKey)?.position.copy(newPos);
      this.onChanged?.();
      return;
    }

    // Rotation drag (must come before translation drag check)
    if (this._rotAxis && this._rotGizmoGroup && this._selectedKey) {
      e.stopImmediatePropagation();
      const ndc = this._ndc(e);
      this._raycaster.setFromCamera(ndc, this._camera);
      const hit = new THREE.Vector3();
      if (!this._raycaster.ray.intersectPlane(this._rotDragPlane, hit)) return;
      const center = this._rotGizmoGroup.position;
      const current = new THREE.Vector3().subVectors(hit, center).normalize();
      const axisVec = this._rotAxis === 'x' ? new THREE.Vector3(1, 0, 0)
        : this._rotAxis === 'y' ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
      const angle = this._rotDragStart.angleTo(current);
      const cross = new THREE.Vector3().crossVectors(this._rotDragStart, current);
      const sign = cross.dot(axisVec) >= 0 ? 1 : -1;
      const quat = new THREE.Quaternion().setFromAxisAngle(axisVec, angle * sign);
      const initDir = new THREE.Vector3(...this._rotInitDir);
      initDir.applyQuaternion(quat).normalize();
      const newDir: [number, number, number] = [initDir.x, initDir.y, initDir.z];
      const anchor = this._anchors.get(this._selectedKey);
      if (anchor) anchor.lightDirection = newDir;
      this._updateRotGizmoDir(newDir);
      this.onChanged?.();
      return;
    }

    if (!this._dragAxis) {
      const ndc = this._ndc(e);
      this._raycaster.setFromCamera(ndc, this._camera);
      const hits = this._raycaster.intersectObjects([...this._markers.values()], false);
      const newHover = hits.length > 0 ? (hits[0].object.userData.anchorKey as string) : null;
      if (newHover !== this._hoveredKey) {
        if (this._hoveredKey && this._hoveredKey !== this._selectedKey) {
          const a = this._anchors.get(this._hoveredKey);
          (this._markers.get(this._hoveredKey)?.material as THREE.MeshBasicMaterial)?.color.setHex(
            a?.hidden ? 0x888888 : 0xFFDD00
          );
        }
        if (newHover && newHover !== this._selectedKey) {
          (this._markers.get(newHover)?.material as THREE.MeshBasicMaterial)?.color.setHex(0xFFFFAA);
        }
        this._hoveredKey = newHover;
        this._canvas.style.cursor = newHover ? 'grab' : '';
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
    if (this._directDragKey) {
      // Tap without drag — just a selection, pointer was captured
      this._canvas.releasePointerCapture(e.pointerId);
      this._directDragKey = null;
    }
    // Direct drag ends on pointerup — confirm grab so _gizmoDragging is cleared
    // (G-grab is confirmed on next pointerdown, so _grabMode will already be false here)
    if (this._grabMode && e.button === 0) {
      this._canvas.releasePointerCapture(e.pointerId);
      this._confirmGrab();
    }
    if (this._rotAxis) {
      this._canvas.releasePointerCapture(e.pointerId);
      this._rotAxis = null;
      this.onDragEnd?.();
    }
    if (this._dragAxis) {
      this._canvas.releasePointerCapture(e.pointerId);
      this._dragAxis = null;
      this.onDragEnd?.();
    }
  };
}
