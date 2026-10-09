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
  /** Un objet qui se pose sur un meuble (lampe de chevet, micro-ondes, écran…). */
  top?: boolean;
  /** Un meuble dont le dessus accueille les objets posés. */
  surface?: boolean;
}

/** Agrandissement commun aux modèles du kit. */
export const KIT_SCALE = 2;

export const FURNITURE_URL = '/owlnest_frontend/furniture/';

type Row = [string, ItemCategory, string, string, Partial<Pick<CatalogItem, 'wall' | 'ceiling' | 'light' | 'top' | 'surface'>>?];

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
  ['tableCoffee', 'living', 'Coffee table', 'Table basse', { surface: true }],
  ['tableCoffeeSquare', 'living', 'Square coffee table', 'Table basse carrée', { surface: true }],
  ['tableCoffeeGlass', 'living', 'Glass coffee table', 'Table basse en verre', { surface: true }],
  ['tableCoffeeGlassSquare', 'living', 'Square glass coffee table', 'Table basse carrée en verre', { surface: true }],
  ['cabinetTelevision', 'living', 'TV stand', 'Meuble TV', { surface: true }],
  ['cabinetTelevisionDoors', 'living', 'TV cabinet', 'Meuble TV fermé', { surface: true }],
  ['televisionModern', 'living', 'Flat TV', 'Télévision', { top: true }],
  ['televisionVintage', 'living', 'Vintage TV', 'Télévision vintage', { top: true }],
  ['speaker', 'living', 'Speaker', 'Enceinte'],
  ['speakerSmall', 'living', 'Small speaker', 'Petite enceinte', { top: true }],
  ['radio', 'living', 'Radio', 'Radio', { top: true }],
  ['bookcaseOpen', 'living', 'Bookcase', 'Bibliothèque', { surface: true }],
  ['bookcaseOpenLow', 'living', 'Low bookcase', 'Bibliothèque basse', { surface: true }],
  ['bookcaseClosed', 'living', 'Closed bookcase', 'Bibliothèque fermée', { surface: true }],
  ['bookcaseClosedDoors', 'living', 'Cabinet', 'Armoire', { surface: true }],
  ['bookcaseClosedWide', 'living', 'Wide bookcase', 'Grande bibliothèque', { surface: true }],
  ['table', 'living', 'Dining table', 'Table', { surface: true }],
  ['tableCloth', 'living', 'Table with cloth', 'Table avec nappe', { surface: true }],
  ['tableCross', 'living', 'Farmhouse table', 'Table de ferme', { surface: true }],
  ['tableCrossCloth', 'living', 'Farmhouse table, cloth', 'Table de ferme avec nappe', { surface: true }],
  ['tableGlass', 'living', 'Glass table', 'Table en verre', { surface: true }],
  ['tableRound', 'living', 'Round table', 'Table ronde', { surface: true }],
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
  ['cabinetBed', 'bedroom', 'Bedside table', 'Table de chevet', { surface: true }],
  ['cabinetBedDrawer', 'bedroom', 'Bedside drawers', 'Chevet à tiroir', { surface: true }],
  ['cabinetBedDrawerTable', 'bedroom', 'Bedside cabinet', 'Chevet', { surface: true }],
  ['sideTable', 'bedroom', 'Side table', 'Console', { surface: true }],
  ['sideTableDrawers', 'bedroom', 'Chest of drawers', 'Commode', { surface: true }],
  ['coatRackStanding', 'bedroom', 'Coat stand', 'Portemanteau sur pied'],
  ['coatRack', 'bedroom', 'Coat rack', 'Portemanteau mural', { wall: 1.55 }],
  // Cuisine
  ['kitchenCabinet', 'kitchen', 'Base cabinet', 'Meuble bas', { surface: true }],
  ['kitchenCabinetDrawer', 'kitchen', 'Drawer cabinet', 'Meuble à tiroirs', { surface: true }],
  ['kitchenCabinetCornerInner', 'kitchen', 'Corner cabinet', 'Meuble d’angle', { surface: true }],
  ['kitchenCabinetCornerRound', 'kitchen', 'Round corner cabinet', 'Meuble d’angle arrondi', { surface: true }],
  ['kitchenSink', 'kitchen', 'Sink', 'Évier', { surface: true }],
  ['kitchenStove', 'kitchen', 'Gas stove', 'Cuisinière gaz', { surface: true }],
  ['kitchenStoveElectric', 'kitchen', 'Electric stove', 'Plaque électrique', { surface: true }],
  ['kitchenCabinetUpper', 'kitchen', 'Wall cabinet', 'Meuble haut', { wall: 1.45 }],
  ['kitchenCabinetUpperDouble', 'kitchen', 'Double wall cabinet', 'Meuble haut double', { wall: 1.45 }],
  ['kitchenCabinetUpperLow', 'kitchen', 'Low wall cabinet', 'Meuble haut bas', { wall: 1.65 }],
  ['kitchenCabinetUpperCorner', 'kitchen', 'Corner wall cabinet', 'Meuble haut d’angle', { wall: 1.45 }],
  ['hoodModern', 'kitchen', 'Cooker hood', 'Hotte', { wall: 1.5 }],
  ['hoodLarge', 'kitchen', 'Large hood', 'Grande hotte', { wall: 1.5 }],
  ['kitchenFridge', 'kitchen', 'Fridge', 'Réfrigérateur'],
  ['kitchenFridgeLarge', 'kitchen', 'American fridge', 'Frigo américain'],
  ['kitchenFridgeSmall', 'kitchen', 'Small fridge', 'Petit frigo', { surface: true }],
  ['kitchenFridgeBuiltIn', 'kitchen', 'Built-in fridge', 'Frigo encastré'],
  ['kitchenBar', 'kitchen', 'Kitchen bar', 'Bar', { surface: true }],
  ['kitchenBarEnd', 'kitchen', 'Bar end', 'Bout de bar', { surface: true }],
  ['stoolBar', 'kitchen', 'Bar stool', 'Tabouret de bar'],
  ['stoolBarSquare', 'kitchen', 'Square stool', 'Tabouret carré'],
  ['kitchenMicrowave', 'kitchen', 'Microwave', 'Micro-ondes', { top: true }],
  ['kitchenCoffeeMachine', 'kitchen', 'Coffee machine', 'Machine à café', { top: true }],
  ['kitchenBlender', 'kitchen', 'Blender', 'Blender', { top: true }],
  ['toaster', 'kitchen', 'Toaster', 'Grille-pain', { top: true }],
  ['washer', 'kitchen', 'Washing machine', 'Lave-linge', { surface: true }],
  ['dryer', 'kitchen', 'Dryer', 'Sèche-linge', { surface: true }],
  ['washerDryerStacked', 'kitchen', 'Washer and dryer', 'Lave-linge et sèche-linge'],
  ['trashcan', 'kitchen', 'Bin', 'Poubelle'],
  // Salle de bain
  ['bathtub', 'bathroom', 'Bathtub', 'Baignoire'],
  ['shower', 'bathroom', 'Shower', 'Douche'],
  ['showerRound', 'bathroom', 'Round shower', 'Douche arrondie'],
  ['toilet', 'bathroom', 'Toilet', 'WC'],
  ['toiletSquare', 'bathroom', 'Square toilet', 'WC carré'],
  ['bathroomSink', 'bathroom', 'Pedestal sink', 'Lavabo'],
  ['bathroomSinkSquare', 'bathroom', 'Vanity unit', 'Meuble vasque', { surface: true }],
  ['bathroomCabinetDrawer', 'bathroom', 'Bathroom drawers', 'Meuble de salle de bain', { surface: true }],
  ['bathroomCabinet', 'bathroom', 'Bathroom cabinet', 'Armoire de toilette', { wall: 1.3 }],
  ['bathroomMirror', 'bathroom', 'Mirror', 'Miroir', { wall: 1.2 }],
  // Bureau
  ['desk', 'office', 'Desk', 'Bureau', { surface: true }],
  ['deskCorner', 'office', 'Corner desk', 'Bureau d’angle', { surface: true }],
  ['chairDesk', 'office', 'Office chair', 'Chaise de bureau'],
  ['computerScreen', 'office', 'Screen', 'Écran', { top: true }],
  ['laptop', 'office', 'Laptop', 'Ordinateur portable', { top: true }],
  ['computerKeyboard', 'office', 'Keyboard', 'Clavier', { top: true }],
  ['computerMouse', 'office', 'Mouse', 'Souris', { top: true }],
  // Lumières
  ['lampRoundFloor', 'lights', 'Floor lamp', 'Lampadaire', { light: true }],
  ['lampSquareFloor', 'lights', 'Square floor lamp', 'Lampadaire carré', { light: true }],
  ['lampRoundTable', 'lights', 'Table lamp', 'Lampe à poser', { light: true, top: true }],
  ['lampSquareTable', 'lights', 'Square table lamp', 'Lampe carrée', { light: true, top: true }],
  ['lampSquareCeiling', 'lights', 'Pendant light', 'Suspension', { light: true, ceiling: true }],
  ['lampWall', 'lights', 'Wall light', 'Applique', { light: true, wall: 1.8 }],
  ['ceilingFan', 'lights', 'Ceiling fan', 'Ventilateur de plafond', { light: true, ceiling: true }],
  // Déco
  ['pottedPlant', 'decor', 'Plant', 'Plante'],
  ['plantSmall1', 'decor', 'Small plant', 'Petite plante', { top: true }],
  ['plantSmall2', 'decor', 'Small plant 2', 'Petite plante 2', { top: true }],
  ['plantSmall3', 'decor', 'Small plant 3', 'Petite plante 3', { top: true }],
  ['rugRectangle', 'decor', 'Rug', 'Tapis'],
  ['rugRounded', 'decor', 'Rounded rug', 'Tapis arrondi'],
  ['rugRound', 'decor', 'Round rug', 'Tapis rond'],
  ['rugSquare', 'decor', 'Square rug', 'Tapis carré'],
  ['rugDoormat', 'decor', 'Doormat', 'Paillasson'],
  ['books', 'decor', 'Books', 'Livres', { top: true }],
  ['pillow', 'decor', 'Cushion', 'Coussin', { top: true }],
  ['pillowLong', 'decor', 'Long cushion', 'Coussin long', { top: true }],
  ['pillowBlue', 'decor', 'Blue cushion', 'Coussin bleu', { top: true }],
  ['pillowBlueLong', 'decor', 'Long blue cushion', 'Coussin long bleu', { top: true }],
  ['bear', 'decor', 'Teddy bear', 'Ours en peluche', { top: true }],
  ['cardboardBoxClosed', 'decor', 'Box', 'Carton', { top: true }],
  ['cardboardBoxOpen', 'decor', 'Open box', 'Carton ouvert', { top: true }],
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
