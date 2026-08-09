/**
 * cards/renderer.ts — Scene card canvas renderer.
 *
 * Manages Three.js billboard meshes for each SceneCard, draws template-specific
 * content to 2D canvases and uploads them as GPU textures.
 *
 * Architecture:
 *   SceneCard → Canvas (1024 × H) → CanvasTexture → PlaneGeometry mesh
 *   Always billboard (face camera). Scale = world-space width in metres.
 */

import * as THREE from 'three';
import type { Hass } from '../types';
import type { SceneCard, RoomCard, EntityCard, InfoCard } from './types';
import { CARD_SCALE, CARD_ASPECT, CARD_DEFAULT_ACCENT } from './types';

const CANVAS_W = 1024;

// ── Internal state per card ─────────────────────────────────────────────────

interface CardObject {
  card: SceneCard;
  canvasH: number;
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

// ── Renderer ────────────────────────────────────────────────────────────────

export class SceneCardRenderer {
  private _objects = new Map<string, CardObject>();
  private _raycaster = new THREE.Raycaster();
  private _selectedId: string | null = null;
  private _hoveredId: string | null = null;
  private _hass: Hass | null = null;

  private _textureWidth = CANVAS_W;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private requestRender: () => void,
  ) {}

  /**
   * Change la résolution des textures de cartes (profil qualité).
   * Les canvas existants sont recréés : leur taille est figée à la création.
   */
  setTextureWidth(width: number) {
    if (width === this._textureWidth) return;
    this._textureWidth = width;
    if (!this._objects.size) return;

    const cards = [...this._objects.values()].map((o) => o.card);
    this._objects.forEach((o) => this._destroyObj(o));
    this._objects.clear();
    for (const card of cards) {
      this._create(card);
      this._draw(this._objects.get(card.id)!, this._hass);
    }
    this.requestRender();
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getMeshes(): THREE.Mesh[] {
    return [...this._objects.values()].map((o) => o.mesh);
  }

  getCardByMesh(mesh: THREE.Mesh): SceneCard | undefined {
    return [...this._objects.values()].find((o) => o.mesh === mesh)?.card;
  }

  getCard(id: string): SceneCard | undefined {
    return this._objects.get(id)?.card;
  }

  // ── Selection / hover state ───────────────────────────────────────────────

  setSelectedId(id: string | null) {
    const prev = this._selectedId;
    this._selectedId = id;
    if (prev && this._objects.has(prev)) this._draw(this._objects.get(prev)!, this._hass);
    if (id && this._objects.has(id)) this._draw(this._objects.get(id)!, this._hass);
    this.requestRender();
  }

  setHoveredId(id: string | null) {
    const prev = this._hoveredId;
    this._hoveredId = id;
    if (prev && prev !== this._selectedId && this._objects.has(prev))
      this._draw(this._objects.get(prev)!, this._hass);
    if (id && id !== this._selectedId && this._objects.has(id))
      this._draw(this._objects.get(id)!, this._hass);
    this.requestRender();
  }

  // ── Position preview (during gizmo drag) ─────────────────────────────────

  previewPosition(id: string, pos: THREE.Vector3) {
    const obj = this._objects.get(id);
    if (obj) { obj.mesh.position.copy(pos); this.requestRender(); }
  }

  // ── Sync from scene data ──────────────────────────────────────────────────

  /** Add new cards, update changed, remove deleted. Call whenever cards change. */
  syncCards(cards: SceneCard[], hass: Hass | null) {
    if (hass) this._hass = hass;
    const ids = new Set(cards.map((c) => c.id));

    // Remove deleted cards
    this._objects.forEach((obj, id) => {
      if (!ids.has(id)) {
        this._destroyObj(obj);
        this._objects.delete(id);
      }
    });

    for (const card of cards) {
      if (card.visible === false) {
        const existing = this._objects.get(card.id);
        if (existing) existing.mesh.visible = false;
        continue;
      }

      const aspect = CARD_ASPECT[card.type];
      const canvasH = Math.round(CANVAS_W * aspect);
      const existing = this._objects.get(card.id);

      // Recreate if template type changed (different canvas height)
      if (existing && existing.canvasH !== canvasH) {
        this._destroyObj(existing);
        this._objects.delete(card.id);
      }

      if (!this._objects.has(card.id)) this._create(card);

      const obj = this._objects.get(card.id)!;
      obj.card = card;
      obj.mesh.visible = true;
      obj.mesh.position.set(...card.position);
      const s = CARD_SCALE[card.size ?? 'medium'];
      obj.mesh.scale.set(s, s * aspect, 1);
      this._draw(obj, hass);
    }

    this.requestRender();
  }

  /** Called every frame — keeps all cards facing the camera (billboard mode). */
  update() {
    this._objects.forEach((obj) => {
      obj.mesh.quaternion.copy(this.camera.quaternion);
    });
  }

  /** Redraw all visible cards on HA state change. */
  updateStates(hass: Hass) {
    this._hass = hass;
    this._objects.forEach((obj) => {
      if (obj.card.visible !== false) this._draw(obj, hass);
    });
    this.requestRender();
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  /** Returns card id under the NDC pointer, or null. */
  handleClick(ndc: THREE.Vector2): string | null {
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.getMeshes());
    if (!hits.length) return null;
    return [...this._objects.values()].find((o) => o.mesh === hits[0].object)?.card.id ?? null;
  }

  /** Returns card id under the NDC pointer for hover detection. */
  handleHover(ndc: THREE.Vector2): string | null {
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.getMeshes());
    if (!hits.length) return null;
    return [...this._objects.values()].find((o) => o.mesh === hits[0].object)?.card.id ?? null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  dispose() {
    this._objects.forEach((obj) => this._destroyObj(obj));
    this._objects.clear();
  }

  // ── Private: mesh creation / destruction ──────────────────────────────────

  private _destroyObj(obj: CardObject) {
    this.scene.remove(obj.mesh);
    obj.texture.dispose();
    (obj.mesh.material as THREE.Material).dispose();
    obj.mesh.geometry.dispose();
  }

  private _create(card: SceneCard) {
    const aspect = CARD_ASPECT[card.type];
    const width = this._textureWidth;
    const canvasH = Math.round(width * aspect);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(1, aspect);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.position.set(...card.position);
    const s = CARD_SCALE[card.size ?? 'medium'];
    mesh.scale.set(s, s * aspect, 1);
    mesh.userData.cardId = card.id;

    this.scene.add(mesh);
    this._objects.set(card.id, { card, canvasH, mesh, texture, canvas, ctx });
  }

  // ── Private: drawing ─────────────────────────────────────────────────────

  private _draw(obj: CardObject, hass: Hass | null) {
    const { ctx, canvas, card } = obj;

    // Tout le dessin ci-dessous est écrit en coordonnées 1024 (tailles de police
    // et marges absolues). Le profil qualité ne change que la résolution réelle
    // du canvas : on met le contexte à l'échelle pour que la mise en page reste
    // identique quelle que soit cette résolution.
    const scale = canvas.width / CANVAS_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const W = CANVAS_W;
    const H = Math.round(obj.canvasH / scale);

    ctx.clearRect(0, 0, W, H);

    const accent = card.accentColor ?? CARD_DEFAULT_ACCENT[card.type];
    const accentRgbStr = this._hex2rgb(accent);

    const isSelected = card.id === this._selectedId;
    const isHovered  = card.id === this._hoveredId;

    // ── Rounded rect path (reused for fill + stroke) ─────────────────────
    const R = 32;
    const margin = 18; // keep glow shadow inside canvas bounds
    const buildPath = () => {
      const x0 = margin, y0 = margin, x1 = W - margin, y1 = H - margin;
      ctx.beginPath();
      ctx.moveTo(x0 + R, y0);
      ctx.lineTo(x1 - R, y0);
      ctx.quadraticCurveTo(x1, y0, x1, y0 + R);
      ctx.lineTo(x1, y1 - R);
      ctx.quadraticCurveTo(x1, y1, x1 - R, y1);
      ctx.lineTo(x0 + R, y1);
      ctx.quadraticCurveTo(x0, y1, x0, y1 - R);
      ctx.lineTo(x0, y0 + R);
      ctx.quadraticCurveTo(x0, y0, x0 + R, y0);
      ctx.closePath();
    };

    // ── Outer glow ───────────────────────────────────────────────────────
    buildPath();
    ctx.save();
    ctx.shadowColor = isSelected
      ? 'rgba(59,130,246,0.70)'
      : `rgba(${accentRgbStr},0.38)`;
    ctx.shadowBlur = isSelected ? 36 : 28;
    ctx.fillStyle = 'rgba(0,0,0,0.01)'; // near-transparent fill just to emit the shadow
    ctx.fill();
    ctx.restore();

    // ── Background: dark glass ────────────────────────────────────────────
    buildPath();
    ctx.fillStyle = 'rgba(8,14,32,0.72)';
    ctx.fill();

    // ── Border ───────────────────────────────────────────────────────────
    buildPath();
    if (isSelected) {
      ctx.strokeStyle = 'rgba(59,130,246,0.90)';
      ctx.lineWidth = 4;
    } else if (isHovered) {
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = `rgba(${accentRgbStr},0.22)`;
      ctx.lineWidth = 1.5;
    }
    ctx.stroke();

    // ── Template-specific content ────────────────────────────────────────
    switch (card.type) {
      case 'room':   this._drawRoom(obj, hass);   break;
      case 'entity': this._drawEntity(obj, hass); break;
      case 'info':   this._drawInfo(obj);          break;
    }

    obj.texture.needsUpdate = true;
  }

  // ── Room template ─────────────────────────────────────────────────────────

  private _drawRoom(obj: CardObject, hass: Hass | null) {
    const { ctx, canvas, card } = obj;
    const c = card as RoomCard;
    const W = canvas.width;
    const H = canvas.height;
    const PAD = 56; // 18px margin + 38px inner padding
    const accent = c.accentColor ?? CARD_DEFAULT_ACCENT.room;
    const show   = c.show ?? {};
    const showName     = show.name     !== false;
    const showIcon     = show.icon     !== false && !!c.icon;
    const showEntities = show.entities !== false && !!c.entities?.length;

    ctx.textBaseline = 'middle';
    let y = PAD;

    // ── Header ──────────────────────────────────────────────────────────
    if (showIcon || showName) {
      let x = PAD;

      if (showIcon) {
        ctx.font = 'bold 52px system-ui, sans-serif';
        ctx.fillStyle = accent;
        ctx.textAlign = 'left';
        ctx.fillText(c.icon!, x, y + 34);
        x += 76;
      }

      if (showName) {
        ctx.font = 'bold 44px system-ui, sans-serif';
        ctx.fillStyle = accent;
        ctx.textAlign = 'left';
        ctx.fillText(c.name, x, y + 34);
      }

      y += 88;
    }

    // ── Separator ───────────────────────────────────────────────────────
    const accentRgb = this._hex2rgb(accent);
    ctx.fillStyle = `rgba(${accentRgb},0.22)`;
    ctx.fillRect(PAD, y, W - PAD * 2, 2);
    y += 32;

    // ── Entity rows ─────────────────────────────────────────────────────
    if (showEntities) {
      const dotR = 13;
      for (const entityId of c.entities!.slice(0, 4)) {
        const state = hass?.states[entityId];
        const rawLabel = entityId.split('.')[1]?.replace(/_/g, ' ') ?? entityId;
        const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
        const value = state?.state ?? '—';
        const unit  = (state?.attributes.unit_of_measurement as string) ?? '';
        const on    = value !== 'off' && value !== 'unavailable' && value !== 'unknown';

        // Status dot
        ctx.beginPath();
        ctx.arc(PAD + dotR, y + dotR, dotR, 0, Math.PI * 2);
        ctx.fillStyle = on ? '#4ade80' : 'rgba(255,255,255,0.16)';
        ctx.fill();

        // Label
        ctx.font = '34px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.52)';
        ctx.textAlign = 'left';
        ctx.fillText(label, PAD + dotR * 2 + 16, y + dotR);

        // State + unit
        const displayValue = unit ? `${value} ${unit}` : value;
        ctx.font = `bold 34px system-ui, sans-serif`;
        ctx.fillStyle = on ? '#e2e8f0' : 'rgba(255,255,255,0.26)';
        ctx.textAlign = 'right';
        ctx.fillText(displayValue, W - PAD, y + dotR);
        ctx.textAlign = 'left';

        y += 72;
      }
    }

    // ── Empty state ─────────────────────────────────────────────────────
    if (!showEntities || !c.entities?.length) {
      if (!showName && !showIcon) {
        ctx.font = '32px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.textAlign = 'center';
        ctx.fillText(c.name, W / 2, H / 2);
      }
    }

  }

  // ── Entity template ───────────────────────────────────────────────────────

  private _drawEntity(obj: CardObject, hass: Hass | null) {
    const { ctx, canvas, card } = obj;
    const c = card as EntityCard;
    const W = canvas.width;
    const H = canvas.height;
    const PAD = 56;
    const accent   = c.accentColor ?? CARD_DEFAULT_ACCENT.entity;
    const show     = c.show ?? {};
    const showLabel = show.label  !== false;
    const showState = show.state  !== false;
    const showUnit  = show.unit   !== false;
    const showBtn   = show.button === true && !!c.action;

    const state = hass?.states[c.entity_id];
    const value = state?.state ?? '—';
    const unit  = showUnit ? ((state?.attributes.unit_of_measurement as string) ?? '') : '';
    const rawLabel = c.label ?? c.entity_id.split('.')[1]?.replace(/_/g, ' ') ?? c.entity_id;
    const label    = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    const on       = value !== 'off' && value !== 'unavailable' && value !== 'unknown';

    ctx.textBaseline = 'middle';

    // ── Label (top, small muted) ────────────────────────────────────────
    if (showLabel) {
      ctx.font = '34px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.36)';
      ctx.textAlign = 'center';
      ctx.fillText(label, W / 2, PAD + 22);
    }

    // ── Status dot ──────────────────────────────────────────────────────
    const dotR = 10;
    ctx.beginPath();
    ctx.arc(W - PAD - dotR, PAD + 22, dotR, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#4ade80' : 'rgba(255,255,255,0.16)';
    ctx.fill();

    // ── Big state value (vertically centred) ────────────────────────────
    if (showState) {
      const centerY = showBtn ? H * 0.42 : H * 0.50;

      if (unit) {
        // Value right-aligned, unit left-aligned from centre
        ctx.font = `bold 148px system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        const valX = W * 0.53;
        ctx.fillText(value, valX, centerY);

        ctx.font = '46px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.textAlign = 'left';
        ctx.fillText(unit, valX + 8, centerY + 26);
      } else {
        ctx.font = `bold 148px system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(value, W / 2, centerY);
      }

      // Accent underline
      const accentRgb = this._hex2rgb(accent);
      ctx.fillStyle = `rgba(${accentRgb},0.32)`;
      ctx.fillRect(W / 2 - 56, centerY + 86, 112, 3);
    }

    // ── Action button ────────────────────────────────────────────────────
    if (showBtn) {
      const btnH = 76;
      const btnY = H - PAD - btnH;
      const btnW = W - PAD * 2;
      const accentRgb = this._hex2rgb(accent);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(PAD, btnY, btnW, btnH, 14);
      } else {
        ctx.rect(PAD, btnY, btnW, btnH);
      }
      ctx.fillStyle = `rgba(${accentRgb},0.14)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${accentRgb},0.40)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const svcLabel = c.action!.service.replace(/_/g, ' ');
      ctx.fillText(svcLabel, W / 2, btnY + btnH / 2);
    }
  }

  // ── Info template ─────────────────────────────────────────────────────────

  private _drawInfo(obj: CardObject) {
    const { ctx, canvas, card } = obj;
    const c = card as InfoCard;
    const W = canvas.width;
    const H = canvas.height;
    const accent = c.accentColor ?? c.color ?? CARD_DEFAULT_ACCENT.info;
    const show    = c.show ?? {};
    const showIcon = show.icon     !== false && !!c.icon;
    const showName = show.name     !== false;
    const showSub  = show.subtitle !== false && !!c.subtitle;

    const lineH = {
      icon:     showIcon ? 64  : 0,
      name:     showName ? 54  : 0,
      sub:      showSub  ? 44  : 0,
      gap:      8,
    };

    const totalH = lineH.icon + lineH.name + lineH.sub
      + (showIcon && showName ? lineH.gap : 0)
      + (showName && showSub  ? lineH.gap : 0);

    let y = Math.round((H - totalH) / 2);

    ctx.textBaseline = 'middle';

    if (showIcon) {
      ctx.font = '52px system-ui, sans-serif';
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.fillText(c.icon!, W / 2, y + lineH.icon / 2);
      y += lineH.icon + (showName ? lineH.gap : 0);
    }

    if (showName) {
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.fillText(c.name, W / 2, y + lineH.name / 2);
      y += lineH.name + (showSub ? lineH.gap : 0);
    }

    if (showSub) {
      ctx.font = '34px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.44)';
      ctx.textAlign = 'center';
      ctx.fillText(c.subtitle!, W / 2, y + lineH.sub / 2);
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private _hex2rgb(hex: string): string {
    if (!hex.startsWith('#') || hex.length !== 7) return '125,211,252';
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ].join(',');
  }
}
