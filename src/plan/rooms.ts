/**
 * plan/rooms.ts — les sortes de pièces qu'on propose d'un clic : un nom et un
 * sol qui lui va (carrelage clair pour la salle de bain, parquet pour la
 * chambre). Le nom reste libre ; ce ne sont que des raccourcis.
 */

import type { StringKey } from '../i18n';

export type RoomType =
  | 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'toilet' | 'entrance'
  | 'office' | 'corridor' | 'garage' | 'laundry' | 'dining' | 'terrace';

export const ROOM_TYPES: Record<RoomType, { label: StringKey; floor: string }> = {
  living: { label: 'planRoomLiving', floor: '#c9a27a' },
  kitchen: { label: 'planRoomKitchen', floor: '#cfd3d6' },
  dining: { label: 'planRoomDining', floor: '#c9a27a' },
  bedroom: { label: 'planRoomBedroom', floor: '#d8b98f' },
  bathroom: { label: 'planRoomBathroom', floor: '#bcd7e0' },
  toilet: { label: 'planRoomToilet', floor: '#bcd7e0' },
  entrance: { label: 'planRoomEntrance', floor: '#d6cfc4' },
  corridor: { label: 'planRoomCorridor', floor: '#d6cfc4' },
  office: { label: 'planRoomOffice', floor: '#b9a58c' },
  laundry: { label: 'planRoomLaundry', floor: '#cfd3d6' },
  garage: { label: 'planRoomGarage', floor: '#a9adb1' },
  terrace: { label: 'planRoomTerrace', floor: '#b8a48a' },
};

/** Sols proposés en pastilles, du bois clair au béton. */
export const FLOOR_COLORS = [
  '#d8b98f', '#c9a27a', '#a97c55', '#7a5a3f',
  '#e6e1d8', '#d6cfc4', '#cfd3d6', '#a9adb1',
  '#bcd7e0', '#9fb8a0', '#e3c6c0', '#585d63',
];
