/**
 * plan/catalog.ts — les meubles qu'on pose sur le plan.
 *
 * Le catalogue de base vient du « Furniture Kit » de Kenney (www.kenney.nl),
 * dans le domaine public (CC0) : on peut le livrer avec Owlnest, gratuitement,
 * sans condition. Les modèles sont servis par l'intégration
 * (`/owlnest_frontend/furniture/<id>.glb`) et ne se chargent que lorsqu'on
 * pose un meuble ou qu'on ouvre le catalogue.
 *
 * Les modèles du kit sont à peu près à moitié de la taille réelle : on les
 * agrandit d'un même facteur, qui met plans de travail et portes à la bonne
 * hauteur.
 */

import { getLang } from '../i18n';

export type ItemCategory = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'office' | 'lights' | 'decor';

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  en: string;
  fr: string;
  /** Accroché au mur à cette hauteur (bas du meuble), en mètres. */
  wall?: number;
  /** Pendu au plafond. */
  ceiling?: boolean;
  /** Une source de lumière : elle peut piloter (et suivre) une lampe de Home Assistant. */
  light?: boolean;
}

/** Agrandissement commun aux modèles du kit. */
export const KIT_SCALE = 2;

export const FURNITURE_URL = '/owlnest_frontend/furniture/';

type Row = [string, ItemCategory, string, string, Partial<Pick<CatalogItem, 'wall' | 'ceiling' | 'light'>>?];

const ROWS: Row[] = [
  // Salon
  ['loungeSofa', 'living', 'Sofa', 'Canapé'],
  ['loungeSofaLong', 'living', 'Chaise longue sofa', 'Canapé méridienne'],
  ['loungeSofaCorner', 'living', 'Corner sofa', 'Canapé d’angle'],
  ['loungeSofaOttoman', 'living', 'Ottoman', 'Pouf'],
  ['loungeDesignSofa', 'living', 'Design sofa', 'Canapé design'],
  ['loungeDesignSofaCorner', 'living', 'Design corner sofa', 'Canapé d’angle design'],
  ['loungeChair', 'living', 'Armchair', 'Fauteuil'],
  ['loungeChairRelax', 'living', 'Recliner', 'Fauteuil relax'],
  ['loungeDesignChair', 'living', 'Design armchair', 'Fauteuil design'],
  ['tableCoffee', 'living', 'Coffee table', 'Table basse'],
  ['tableCoffeeSquare', 'living', 'Square coffee table', 'Table basse carrée'],
  ['tableCoffeeGlass', 'living', 'Glass coffee table', 'Table basse en verre'],
  ['tableCoffeeGlassSquare', 'living', 'Square glass coffee table', 'Table basse carrée en verre'],
  ['cabinetTelevision', 'living', 'TV stand', 'Meuble TV'],
  ['cabinetTelevisionDoors', 'living', 'TV cabinet', 'Meuble TV fermé'],
  ['televisionModern', 'living', 'Flat TV', 'Télévision'],
  ['televisionVintage', 'living', 'Vintage TV', 'Télévision vintage'],
  ['speaker', 'living', 'Speaker', 'Enceinte'],
  ['speakerSmall', 'living', 'Small speaker', 'Petite enceinte'],
  ['radio', 'living', 'Radio', 'Radio'],
  ['bookcaseOpen', 'living', 'Bookcase', 'Bibliothèque'],
  ['bookcaseOpenLow', 'living', 'Low bookcase', 'Bibliothèque basse'],
  ['bookcaseClosed', 'living', 'Closed bookcase', 'Bibliothèque fermée'],
  ['bookcaseClosedDoors', 'living', 'Cabinet', 'Armoire'],
  ['bookcaseClosedWide', 'living', 'Wide bookcase', 'Grande bibliothèque'],
  ['table', 'living', 'Dining table', 'Table'],
  ['tableCloth', 'living', 'Table with cloth', 'Table avec nappe'],
  ['tableCross', 'living', 'Farmhouse table', 'Table de ferme'],
  ['tableCrossCloth', 'living', 'Farmhouse table, cloth', 'Table de ferme avec nappe'],
  ['tableGlass', 'living', 'Glass table', 'Table en verre'],
  ['tableRound', 'living', 'Round table', 'Table ronde'],
  ['chair', 'living', 'Chair', 'Chaise'],
  ['chairCushion', 'living', 'Chair with cushion', 'Chaise à coussin'],
  ['chairRounded', 'living', 'Rounded chair', 'Chaise arrondie'],
  ['chairModernCushion', 'living', 'Modern chair', 'Chaise moderne'],
  ['chairModernFrameCushion', 'living', 'Modern frame chair', 'Chaise moderne à cadre'],
  ['bench', 'living', 'Bench', 'Banc'],
  ['benchCushion', 'living', 'Bench with cushion', 'Banc à coussin'],
  ['benchCushionLow', 'living', 'Low bench', 'Banc bas'],
  // Chambre
  ['bedDouble', 'bedroom', 'Double bed', 'Lit double'],
  ['bedSingle', 'bedroom', 'Single bed', 'Lit simple'],
  ['bedBunk', 'bedroom', 'Bunk bed', 'Lits superposés'],
  ['cabinetBed', 'bedroom', 'Bedside table', 'Table de chevet'],
  ['cabinetBedDrawer', 'bedroom', 'Bedside drawers', 'Chevet à tiroir'],
  ['cabinetBedDrawerTable', 'bedroom', 'Bedside cabinet', 'Chevet'],
  ['sideTable', 'bedroom', 'Side table', 'Console'],
  ['sideTableDrawers', 'bedroom', 'Chest of drawers', 'Commode'],
  ['coatRackStanding', 'bedroom', 'Coat stand', 'Portemanteau sur pied'],
  ['coatRack', 'bedroom', 'Coat rack', 'Portemanteau mural', { wall: 1.55 }],
  // Cuisine
  ['kitchenCabinet', 'kitchen', 'Base cabinet', 'Meuble bas'],
  ['kitchenCabinetDrawer', 'kitchen', 'Drawer cabinet', 'Meuble à tiroirs'],
  ['kitchenCabinetCornerInner', 'kitchen', 'Corner cabinet', 'Meuble d’angle'],
  ['kitchenCabinetCornerRound', 'kitchen', 'Round corner cabinet', 'Meuble d’angle arrondi'],
  ['kitchenSink', 'kitchen', 'Sink', 'Évier'],
  ['kitchenStove', 'kitchen', 'Gas stove', 'Cuisinière gaz'],
  ['kitchenStoveElectric', 'kitchen', 'Electric stove', 'Plaque électrique'],
  ['kitchenCabinetUpper', 'kitchen', 'Wall cabinet', 'Meuble haut', { wall: 1.45 }],
  ['kitchenCabinetUpperDouble', 'kitchen', 'Double wall cabinet', 'Meuble haut double', { wall: 1.45 }],
  ['kitchenCabinetUpperLow', 'kitchen', 'Low wall cabinet', 'Meuble haut bas', { wall: 1.65 }],
  ['kitchenCabinetUpperCorner', 'kitchen', 'Corner wall cabinet', 'Meuble haut d’angle', { wall: 1.45 }],
  ['hoodModern', 'kitchen', 'Cooker hood', 'Hotte', { wall: 1.5 }],
  ['hoodLarge', 'kitchen', 'Large hood', 'Grande hotte', { wall: 1.5 }],
  ['kitchenFridge', 'kitchen', 'Fridge', 'Réfrigérateur'],
  ['kitchenFridgeLarge', 'kitchen', 'American fridge', 'Frigo américain'],
  ['kitchenFridgeSmall', 'kitchen', 'Small fridge', 'Petit frigo'],
  ['kitchenFridgeBuiltIn', 'kitchen', 'Built-in fridge', 'Frigo encastré'],
  ['kitchenBar', 'kitchen', 'Kitchen bar', 'Bar'],
  ['kitchenBarEnd', 'kitchen', 'Bar end', 'Bout de bar'],
  ['stoolBar', 'kitchen', 'Bar stool', 'Tabouret de bar'],
  ['stoolBarSquare', 'kitchen', 'Square stool', 'Tabouret carré'],
  ['kitchenMicrowave', 'kitchen', 'Microwave', 'Micro-ondes'],
  ['kitchenCoffeeMachine', 'kitchen', 'Coffee machine', 'Machine à café'],
  ['kitchenBlender', 'kitchen', 'Blender', 'Blender'],
  ['toaster', 'kitchen', 'Toaster', 'Grille-pain'],
  ['washer', 'kitchen', 'Washing machine', 'Lave-linge'],
  ['dryer', 'kitchen', 'Dryer', 'Sèche-linge'],
  ['washerDryerStacked', 'kitchen', 'Washer and dryer', 'Lave-linge et sèche-linge'],
  ['trashcan', 'kitchen', 'Bin', 'Poubelle'],
  // Salle de bain
  ['bathtub', 'bathroom', 'Bathtub', 'Baignoire'],
  ['shower', 'bathroom', 'Shower', 'Douche'],
  ['showerRound', 'bathroom', 'Round shower', 'Douche arrondie'],
  ['toilet', 'bathroom', 'Toilet', 'WC'],
  ['toiletSquare', 'bathroom', 'Square toilet', 'WC carré'],
  ['bathroomSink', 'bathroom', 'Pedestal sink', 'Lavabo'],
  ['bathroomSinkSquare', 'bathroom', 'Vanity unit', 'Meuble vasque'],
  ['bathroomCabinetDrawer', 'bathroom', 'Bathroom drawers', 'Meuble de salle de bain'],
  ['bathroomCabinet', 'bathroom', 'Bathroom cabinet', 'Armoire de toilette', { wall: 1.3 }],
  ['bathroomMirror', 'bathroom', 'Mirror', 'Miroir', { wall: 1.2 }],
  // Bureau
  ['desk', 'office', 'Desk', 'Bureau'],
  ['deskCorner', 'office', 'Corner desk', 'Bureau d’angle'],
  ['chairDesk', 'office', 'Office chair', 'Chaise de bureau'],
  ['computerScreen', 'office', 'Screen', 'Écran'],
  ['laptop', 'office', 'Laptop', 'Ordinateur portable'],
  ['computerKeyboard', 'office', 'Keyboard', 'Clavier'],
  ['computerMouse', 'office', 'Mouse', 'Souris'],
  // Lumières
  ['lampRoundFloor', 'lights', 'Floor lamp', 'Lampadaire', { light: true }],
  ['lampSquareFloor', 'lights', 'Square floor lamp', 'Lampadaire carré', { light: true }],
  ['lampRoundTable', 'lights', 'Table lamp', 'Lampe à poser', { light: true }],
  ['lampSquareTable', 'lights', 'Square table lamp', 'Lampe carrée', { light: true }],
  ['lampSquareCeiling', 'lights', 'Pendant light', 'Suspension', { light: true, ceiling: true }],
  ['lampWall', 'lights', 'Wall light', 'Applique', { light: true, wall: 1.8 }],
  ['ceilingFan', 'lights', 'Ceiling fan', 'Ventilateur de plafond', { light: true, ceiling: true }],
  // Déco
  ['pottedPlant', 'decor', 'Plant', 'Plante'],
  ['plantSmall1', 'decor', 'Small plant', 'Petite plante'],
  ['plantSmall2', 'decor', 'Small plant 2', 'Petite plante 2'],
  ['plantSmall3', 'decor', 'Small plant 3', 'Petite plante 3'],
  ['rugRectangle', 'decor', 'Rug', 'Tapis'],
  ['rugRounded', 'decor', 'Rounded rug', 'Tapis arrondi'],
  ['rugRound', 'decor', 'Round rug', 'Tapis rond'],
  ['rugSquare', 'decor', 'Square rug', 'Tapis carré'],
  ['rugDoormat', 'decor', 'Doormat', 'Paillasson'],
  ['books', 'decor', 'Books', 'Livres'],
  ['pillow', 'decor', 'Cushion', 'Coussin'],
  ['pillowLong', 'decor', 'Long cushion', 'Coussin long'],
  ['pillowBlue', 'decor', 'Blue cushion', 'Coussin bleu'],
  ['pillowBlueLong', 'decor', 'Long blue cushion', 'Coussin long bleu'],
  ['bear', 'decor', 'Teddy bear', 'Ours en peluche'],
  ['cardboardBoxClosed', 'decor', 'Box', 'Carton'],
  ['cardboardBoxOpen', 'decor', 'Open box', 'Carton ouvert'],
];

export const CATALOG: CatalogItem[] = ROWS.map(([id, category, en, fr, extra]) => ({ id, category, en, fr, ...extra }));

export const CATEGORIES: ItemCategory[] = ['living', 'bedroom', 'kitchen', 'bathroom', 'office', 'lights', 'decor'];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.id === id);
}

export function itemLabel(c: CatalogItem): string {
  return getLang() === 'fr' ? c.fr : c.en;
}

export const modelUrl = (id: string) => `${FURNITURE_URL}${id}.glb`;
export const thumbUrl = (id: string) => `${FURNITURE_URL}${id}.webp`;
