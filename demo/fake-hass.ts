/**
 * fake-hass.ts — un Home Assistant minimal, en mémoire, pour la démo en ligne.
 *
 * La carte ne parle qu'à l'objet `hass` : ses états, `callService` et
 * `callWS`. On reproduit juste assez de ce contrat pour que la maison de
 * démonstration réagisse comme chez soi — les lampes s'allument, la télé
 * s'éteint, le soleil se couche — sans serveur ni compte.
 *
 * Chaque changement d'état produit un nouvel objet `hass`, comme le fait le
 * frontend de HA : la carte compare les références pour savoir quoi mettre à
 * jour.
 */

import type { Hass, HassState, OwlnestScene } from '../src/types';
import { demoScene, demoStates, type DemoLang } from './demo-scene';

export type { DemoLang } from './demo-scene';

type Listener = (hass: Hass) => void;
type ServiceListener = (domain: string, service: string, entityIds: string[]) => void;

export class FakeHass {
  private states: Record<string, HassState> = {};
  private scene: OwlnestScene;
  private listeners: Listener[] = [];
  private serviceListeners: ServiceListener[] = [];
  private current!: Hass;
  lang: DemoLang;

  constructor(lang: DemoLang, modelUrl: string) {
    this.lang = lang;
    this.states = demoStates(lang);
    this.scene = demoScene(lang, modelUrl);
    this.publish();
  }

  /** Nom de la première vue caméra, pour repérer la barre des vues. */
  get firstViewLabel(): string {
    return this.scene.camera_views[0]?.label ?? '';
  }

  /** Noms des vues caméra, pour reconnaître un appui dans la barre des vues. */
  get viewLabels(): string[] {
    return this.scene.camera_views.map((v) => v.label);
  }

  get hass(): Hass {
    return this.current;
  }

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }

  /** Prévient quand la carte appelle un service (un appui sur une ancre). */
  onService(fn: ServiceListener) {
    this.serviceListeners.push(fn);
  }

  /** Met à jour une entité et republie un nouvel objet `hass`. */
  set(entityId: string, state: string, attributes: Record<string, unknown> = {}) {
    const prev = this.states[entityId];
    this.states = {
      ...this.states,
      [entityId]: {
        ...prev,
        state,
        attributes: { ...prev.attributes, ...attributes },
        last_changed: new Date().toISOString(),
      } as HassState,
    };
    this.publish();
  }




  /** Allume ou éteint une entité ; une lampe retrouve sa couleur en se rallumant. */
  setOn(entityId: string, on: boolean) {
    if (entityId.startsWith('light.')) this.lightService(entityId, on ? 'turn_on' : 'turn_off', {});
    else this.set(entityId, on ? 'on' : 'off');
  }



  private publish() {
    const self = this;
    this.current = {
      states: this.states,
      language: this.lang,
      locale: { language: this.lang },
      user: { name: 'Demo', is_admin: true },
      areas: {},
      devices: {},
      entities: {},
      floors: {},
      callService(domain: string, service: string, data: Record<string, unknown>) {
        self.callService(domain, service, data);
      },
      callWS: <T>(msg: Record<string, unknown>) => self.callWS(msg) as Promise<T>,
    } as unknown as Hass;
    for (const fn of this.listeners) fn(this.current);
  }

  private callService(domain: string, service: string, data: Record<string, unknown>) {
    const ids = ([] as string[]).concat((data.entity_id as string | string[]) ?? []);
    for (const fn of this.serviceListeners) fn(domain, service, ids);
    for (const id of ids) {
      const d = id.split('.')[0];
      if (d === 'light') this.lightService(id, service, data);
      else if (d === 'media_player') this.mediaService(id, service);
      else if (d === 'climate') this.climateService(id, service, data);
      else if (d === 'switch' || d === 'input_boolean' || d === 'binary_sensor' || domain === 'homeassistant') this.toggleService(id, service);
    }
  }

  private lightService(id: string, service: string, data: Record<string, unknown>) {
    const s = this.states[id];
    if (!s) return;
    const on = service === 'toggle' ? s.state !== 'on' : service === 'turn_on';
    if (!on) {
      this.set(id, 'off', { brightness: null, rgb_color: null, color_mode: null });
      return;
    }
    const a = s.attributes as Record<string, unknown>;
    const rgb = (data.rgb_color as number[] | undefined) ?? (a.rgb_color as number[] | null) ?? (a._demo_rgb as number[]);
    const brightness = (data.brightness as number | undefined)
      ?? (typeof data.brightness_pct === 'number' ? Math.round((data.brightness_pct as number) * 2.55) : undefined)
      ?? (a.brightness as number | null) ?? (a._demo_brightness as number);
    this.set(id, 'on', { rgb_color: rgb, brightness, color_mode: 'rgb', _demo_rgb: rgb, _demo_brightness: brightness });
  }

  private mediaService(id: string, service: string) {
    const s = this.states[id];
    if (!s) return;
    const playing = s.state === 'playing' || s.state === 'on';
    const next =
      service === 'turn_off' ? 'off'
      : service === 'turn_on' ? 'playing'
      : service === 'media_play_pause' ? (s.state === 'playing' ? 'paused' : 'playing')
      : playing ? 'off' : 'playing';
    this.set(id, next);
  }

  private climateService(id: string, service: string, data: Record<string, unknown>) {
    const s = this.states[id];
    if (!s) return;
    const a = s.attributes as Record<string, unknown>;
    if (service === 'set_temperature' && typeof data.temperature === 'number') {
      this.set(id, s.state, { temperature: data.temperature, hvac_action: data.temperature > (a.current_temperature as number) ? 'heating' : 'idle' });
      return;
    }
    const mode = service === 'set_hvac_mode' ? String(data.hvac_mode)
      : service === 'turn_off' ? 'off'
      : service === 'turn_on' ? 'heat'
      : s.state === 'off' ? 'heat' : 'off';
    this.set(id, mode, { hvac_action: mode === 'off' ? 'off' : 'heating' });
  }

  private toggleService(id: string, service: string) {
    const s = this.states[id];
    if (!s) return;
    const on = service === 'toggle' ? s.state !== 'on' : service === 'turn_on';
    this.set(id, on ? 'on' : 'off');
  }

  private async callWS(msg: Record<string, unknown>): Promise<unknown> {
    switch (msg.type) {
      case 'owlnest/load_scene':
        return structuredClone(this.scene);
      case 'owlnest/save_scene':
        // Les modifications faites dans l'éditeur vivent le temps de la visite.
        this.scene = structuredClone(msg.data as OwlnestScene);
        return { success: true };
      case 'owlnest/list_scenes':
        return { scenes: ['main'] };
      case 'owlnest/delete_scene':
        return { success: true };
      default:
        if (String(msg.type).startsWith('config/')) return [];
        throw new Error(`Not available in the demo: ${String(msg.type)}`);
    }
  }
}
