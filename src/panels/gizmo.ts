import * as THREE from 'three';

type GizmoAxis = 'x' | 'y' | 'z';

export class PanelGizmo {
  private _group = new THREE.Group();
  private _handles: { axis: GizmoAxis; mesh: THREE.Mesh; baseColor: number }[] = [];

  constructor(private scene: THREE.Scene) {
    this._build();
    this._group.visible = false;
    this._group.renderOrder = 999;
    scene.add(this._group);
  }

  getMeshes(): THREE.Mesh[] { return this._handles.map(h => h.mesh); }

  getAxis(mesh: THREE.Mesh): GizmoAxis | null {
    return this._handles.find(h => h.mesh === mesh)?.axis ?? null;
  }

  setPosition(pos: THREE.Vector3) { this._group.position.copy(pos); }

  /** Scale gizmo so it stays constant screen-size */
  updateScale(camera: THREE.Camera) {
    const dist = camera.position.distanceTo(this._group.position);
    this._group.scale.setScalar(dist * 0.12);
  }

  get visible() { return this._group.visible; }

  setVisible(v: boolean) { this._group.visible = v; }

  setHover(axis: GizmoAxis | null) {
    this._handles.forEach(h => {
      const mat = h.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(h.axis === axis ? 0xffffff : h.baseColor);
    });
  }

  dispose() {
    this.scene.remove(this._group);
    this._handles.forEach(h => {
      h.mesh.geometry.dispose();
      (h.mesh.material as THREE.Material).dispose();
    });
  }

  private _arrow(color: number, axis: GizmoAxis) {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
    // shaft: thin cylinder along Y
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), mat.clone());
    shaft.position.y = 0.3;
    shaft.renderOrder = 999;
    // tip: cone
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), mat.clone());
    tip.position.y = 0.71;
    tip.renderOrder = 999;
    // invisible hit box
    const hitBox = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.93, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false }),
    );
    hitBox.position.y = 0.46;
    hitBox.userData.gizmoAxis = axis;
    hitBox.renderOrder = 999;

    const g = new THREE.Group();
    g.add(shaft, tip, hitBox);
    g.renderOrder = 999;

    // Rotate group to align with axis direction; default arrow points up (Y+)
    if (axis === 'x') g.rotation.z = -Math.PI / 2;
    else if (axis === 'z') g.rotation.x = Math.PI / 2;

    this._group.add(g);
    this._handles.push({ axis, mesh: hitBox, baseColor: color });
  }

  private _build() {
    // X = red, Y = green, Z = blue
    this._arrow(0xff4444, 'x');
    this._arrow(0x44ff44, 'y');
    this._arrow(0x4488ff, 'z');
  }
}
