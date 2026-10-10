/**
 * plan/rooms.ts — les sortes de pièces qu'on propose d'un clic : un nom et un
 * sol qui lui va (carrelage clair pour la salle de bain, parquet pour la
 * chambre). Le nom reste libre ; ce ne sont que des raccourcis.
 */

import type { StringKey } from '../i18n';
import type { FloorMaterial } from './types';

export type RoomType =
  | 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'toilet' | 'entrance'
  | 'office' | 'corridor' | 'garage' | 'laundry' | 'dining' | 'terrace';

export const ROOM_TYPES: Record<RoomType, { label: StringKey; floor: string; material: FloorMaterial }> = {
  living: { label: 'planRoomLiving', floor: '#c9a27a', material: 'wood' },
  kitchen: { label: 'planRoomKitchen', floor: '#cfd3d6', material: 'tiles' },
  dining: { label: 'planRoomDining', floor: '#c9a27a', material: 'wood' },
  bedroom: { label: 'planRoomBedroom', floor: '#d8b98f', material: 'wood' },
  bathroom: { label: 'planRoomBathroom', floor: '#bcd7e0', material: 'tiles' },
  toilet: { label: 'planRoomToilet', floor: '#bcd7e0', material: 'tiles' },
  entrance: { label: 'planRoomEntrance', floor: '#d6cfc4', material: 'tiles' },
  corridor: { label: 'planRoomCorridor', floor: '#d6cfc4', material: 'wood' },
  office: { label: 'planRoomOffice', floor: '#b9a58c', material: 'wood' },
  laundry: { label: 'planRoomLaundry', floor: '#cfd3d6', material: 'tiles' },
  garage: { label: 'planRoomGarage', floor: '#a9adb1', material: 'concrete' },
  terrace: { label: 'planRoomTerrace', floor: '#b8a48a', material: 'wood' },
};

/** Couleurs de murs : blancs cassés, pastels, et quelques teintes franches. */
/** Teintes de façade : enduits, terre cuite, bois, pierre, gris. */
export const FACADE_COLORS = [
  '#f2ede3', '#e8dcc5', '#d9c7a6', '#c9a27a', '#b5653f', '#9c5a3c',
  '#8a6a4f', '#5e4636', '#cfc6b4', '#a9a49a', '#6f7478', '#3f4549',
];

/** Teintes de sol : pelouses, gravier, béton, sombre, clair. */
export const GROUND_COLORS = ['#4a6741', '#5d7b3f', '#3d5a36', '#b9a98a', '#8c8c86', '#2b2f36', '#e6e2d8'];

export const WALL_COLORS = [
  '#ece8e1', '#ffffff', '#f3ead8', '#e8dccb', '#d9e3e8', '#dfe8dc',
  '#f1dede', '#c9d4de', '#8fa3b5', '#a3b18a', '#d8a48f', '#4a5560',
];

/** Vantaux de porte : bois, blanc, gris, noir. */
export const DOOR_COLORS = ['#c8a77e', '#a97c55', '#5b4636', '#ffffff', '#9aa3ab', '#2f343b'];

/** Cadres de fenêtre : blanc, gris anthracite, noir, bois. */
export const FRAME_COLORS = ['#f4f4f2', '#3d434a', '#1f2226', '#a97c55'];

export const FLOOR_MATERIALS: FloorMaterial[] = ['plain', 'wood', 'tiles', 'concrete', 'carpet'];

/** Sols proposés en pastilles, du bois clair au béton. */
export const FLOOR_COLORS = [
  '#d8b98f', '#c9a27a', '#a97c55', '#7a5a3f',
  '#e6e1d8', '#d6cfc4', '#cfd3d6', '#a9adb1',
  '#bcd7e0', '#9fb8a0', '#e3c6c0', '#585d63',
];
