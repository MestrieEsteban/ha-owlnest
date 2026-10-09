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
  /** Agrandissement propre à ce modèle ; absent, celui de son pack. */
  scale?: number;
}

/** Agrandissement commun aux modèles du kit Kenney. */
export const KIT_SCALE = 2;

/**
 * Les modèles du pack « Ultimate House Interior » de Quaternius (CC0), dont
 * les fichiers commencent par `q_` : deux fois trop grands, eux.
 */
export const QUATERNIUS_SCALE = 0.5;

/** Agrandissement à appliquer à un modèle du catalogue. */
export function catalogScale(c: CatalogItem): number {
  return c.scale ?? (c.id.startsWith('q_') ? QUATERNIUS_SCALE : KIT_SCALE);
}

/** Les vignettes livrées : celles du kit Kenney. Les autres sont rendues à la volée. */
export const hasThumb = (c: CatalogItem) => !c.id.startsWith('q_') && !c.id.startsWith('p_');

/**
 * Où sont servis les meubles. En production, par l'intégration, sur le même
 * serveur que Home Assistant. En dev, la carte est chargée depuis Vite (voir
 * DEVELOPMENT.md) : les meubles aussi, sinon il faudrait recopier le dossier
 * dans HA à chaque essai.
 */
export const FURNITURE_URL = import.meta.env?.DEV
  ? new URL('/owlnest_frontend/furniture/', import.meta.url).href
  : '/owlnest_frontend/furniture/';

type Row = [string, ItemCategory, string, string, Partial<Pick<CatalogItem, 'wall' | 'ceiling' | 'light' | 'top' | 'surface' | 'scale'>>?];

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
  // Fabriqués dans le code (plan/procedural.ts)
  ['p_aquarium', 'decor', 'Aquarium', 'Aquarium'],
  ['p_frame', 'decor', 'Picture', 'Tableau', { wall: 1.3 }],
  ['p_mirror', 'decor', 'Round mirror', 'Miroir rond', { wall: 1.2 }],
  ['p_rug', 'decor', 'Plain rug', 'Tapis uni'],
  ['p_radiator', 'decor', 'Radiator', 'Radiateur', { wall: 0 }],
  // Pack Quaternius
  ['q_Couch_Small2', 'living', 'Loveseat', 'Petit canapé'],
  ['q_Couch_Large2', 'living', 'Beige sofa', 'Canapé beige'],
  ['q_Couch_Large1', 'living', 'Red sofa', 'Canapé rouge'],
  ['q_Couch_Large3', 'living', 'Low green sofa', 'Canapé bas vert'],
  ['q_Couch_Medium1', 'living', 'Blue sofa', 'Canapé bleu'],
  ['q_Couch_Medium2', 'living', 'Mustard sofa', 'Canapé moutarde'],
  ['q_Couch_Small1', 'living', 'Blue armchair', 'Fauteuil bleu'],
  ['q_Couch_L', 'living', 'L-shaped sofa', 'Canapé en L'],
  ['q_Fireplace', 'living', 'Fireplace', 'Cheminée'],
  ['q_Table_RoundLarge', 'living', 'Oval table', 'Table ovale', { surface: true, scale: 0.67 }],
  ['q_Table_RoundSmall', 'living', 'Round wooden table', 'Table ronde en bois', { surface: true, scale: 0.67 }],
  ['q_Table_RoundSmall2', 'living', 'Pedestal table', 'Guéridon', { surface: true, scale: 0.67 }],
  ['q_Chair_1', 'living', 'Wooden chair', 'Chaise en bois'],
  ['q_Chair_2', 'living', 'Padded chair', 'Chaise rembourrée'],
  ['q_Chair_3', 'living', 'Dark padded chair', 'Chaise foncée'],
  ['q_Chair_4', 'living', 'Slatted chair', 'Chaise à barreaux'],
  ['q_Stool', 'living', 'Stool', 'Tabouret'],
  ['q_Bookshelf', 'living', 'White bookcase', 'Bibliothèque blanche'],
  ['q_Shelf_Large', 'living', 'Large shelving', 'Grande étagère'],
  ['q_Shelf_1', 'living', 'Narrow shelving', 'Étagère étroite'],
  ['q_Shelf_2', 'living', 'Shelving', 'Étagère'],
  ['q_Shelf_Small1', 'living', 'Wall shelf', 'Étagère murale', { wall: 1.4 }],
  ['q_Shelf_Small2', 'living', 'Small wall shelf', 'Petite étagère murale', { wall: 1.4 }],
  ['q_Curtains_Double', 'living', 'Curtains', 'Rideaux', { wall: 0 }],
  ['q_Curtains_Single', 'living', 'Curtain', 'Rideau', { wall: 0 }],
  ['q_Bed_King', 'bedroom', 'King size bed', 'Grand lit'],
  ['q_Bed_Single', 'bedroom', 'Single bed, red', 'Lit simple rouge'],
  ['q_Bed_Bunk', 'bedroom', 'Bunk bed, wood', 'Lits superposés en bois'],
  ['q_NightStand_1', 'bedroom', 'Nightstand', 'Table de nuit', { surface: true }],
  ['q_NightStand_2', 'bedroom', 'Nightstand, 2 drawers', 'Table de nuit à 2 tiroirs', { surface: true }],
  ['q_NightStand_3', 'bedroom', 'Open nightstand', 'Table de nuit ouverte', { surface: true }],
  ['q_Drawer_1', 'bedroom', 'Dresser', 'Commode', { surface: true }],
  ['q_Drawer_2', 'bedroom', 'Wide dresser', 'Grande commode', { surface: true }],
  ['q_Drawer_3', 'bedroom', 'Sideboard', 'Buffet', { surface: true }],
  ['q_Drawer_4', 'bedroom', 'Tall dresser', 'Chiffonnier', { surface: true }],
  ['q_Drawer_5', 'bedroom', 'Low chest', 'Commode basse', { surface: true }],
  ['q_Kitchen_Cabinet1', 'kitchen', 'Kitchen unit', 'Meuble de cuisine', { surface: true, scale: 0.56 }],
  ['q_Kitchen_Cabinet2', 'kitchen', 'Kitchen unit, 2 doors', 'Meuble de cuisine 2 portes', { surface: true, scale: 0.56 }],
  ['q_Kitchen_CabinetSmall', 'kitchen', 'Narrow kitchen unit', 'Meuble de cuisine étroit', { surface: true, scale: 0.56 }],
  ['q_Kitchen_1Drawers', 'kitchen', 'Unit with drawer', 'Meuble à tiroir', { surface: true, scale: 0.56 }],
  ['q_Kitchen_2Drawers', 'kitchen', 'Unit with 2 drawers', 'Meuble à 2 tiroirs', { surface: true, scale: 0.56 }],
  ['q_Kitchen_3Drawers', 'kitchen', 'Unit with 3 drawers', 'Meuble à 3 tiroirs', { surface: true, scale: 0.56 }],
  ['q_Kitchen_Sink', 'kitchen', 'Kitchen sink unit', 'Meuble évier', { surface: true, scale: 0.56 }],
  ['q_Kitchen_Oven', 'kitchen', 'Oven and hob', 'Four et plaque', { surface: true, scale: 0.56 }],
  ['q_Kitchen_Oven_Large', 'kitchen', 'Range cooker', 'Piano de cuisson', { scale: 0.56 }],
  ['q_Kitchen_Fridge', 'kitchen', 'Tall fridge', 'Grand réfrigérateur', { scale: 0.56 }],
  ['q_Trashcan_Large', 'kitchen', 'Pedal bin', 'Poubelle à pédale'],
  ['q_Trashcan_Cylindric', 'kitchen', 'Round bin', 'Poubelle ronde'],
  ['q_Trashcan_Small1', 'kitchen', 'Small bin', 'Petite poubelle'],
  ['q_Trashcan_Small2', 'kitchen', 'Waste basket', 'Corbeille'],
  ['q_Trashcan_Green', 'kitchen', 'Wheelie bin', 'Poubelle à roulettes'],
  ['q_Bathroom_Bathtub', 'bathroom', 'White bath', 'Baignoire blanche'],
  ['q_Bathroom_Shower1', 'bathroom', 'Shower with curtain', 'Douche à rideau'],
  ['q_Bathroom_Sink', 'bathroom', 'Wall-hung basin', 'Lavabo suspendu'],
  ['q_Bathroom_Toilet', 'bathroom', 'Toilet with cistern', 'WC avec réservoir'],
  ['q_Bathroom_Toilet2', 'bathroom', 'Compact toilet', 'WC compact'],
  ['q_Bathroom_WashingMachine', 'bathroom', 'White washing machine', 'Lave-linge blanc'],
  ['q_Bathroom_Mirror1', 'bathroom', 'Black frame mirror', 'Miroir cadre noir', { wall: 1.1 }],
  ['q_Bathroom_Mirror2', 'bathroom', 'Small mirror', 'Petit miroir', { wall: 1.2 }],
  ['q_Bathroom_Towel', 'bathroom', 'Towel rail', 'Porte-serviette', { wall: 0.9 }],
  ['q_Bathroom_ToiletPaper', 'bathroom', 'Toilet roll holder', 'Dérouleur papier', { wall: 0.7 }],
  ['q_Bathroom_ToiletPaperPile', 'bathroom', 'Toilet rolls', 'Rouleaux de papier'],
  ['q_Light_Ceiling5', 'lights', 'Flush ceiling light', 'Plafonnier', { light: true, ceiling: true }],
  ['q_Light_Ceiling6', 'lights', 'Flush ceiling light 2', 'Plafonnier 2', { light: true, ceiling: true }],
  ['q_Light_Small', 'lights', 'Spotlight', 'Spot', { light: true, ceiling: true }],
  ['q_Light_Chandelier', 'lights', 'Chandelier', 'Lustre', { light: true, ceiling: true }],
  ['q_Light_Ceiling1', 'lights', 'Cone pendant', 'Suspension conique', { light: true, ceiling: true }],
  ['q_Light_Ceiling2', 'lights', 'Long pendant', 'Suspension longue', { light: true, ceiling: true }],
  ['q_Light_Ceiling3', 'lights', 'Dome pendant', 'Suspension dôme', { light: true, ceiling: true }],
  ['q_Light_Ceiling4', 'lights', 'Large pendant', 'Grande suspension', { light: true, ceiling: true }],
  ['q_Light_CeilingSingle', 'lights', 'Bare bulb', 'Ampoule suspendue', { light: true, ceiling: true }],
  ['q_Light_Cube', 'lights', 'Cube pendant', 'Suspension cube', { light: true, ceiling: true }],
  ['q_Light_Cube2', 'lights', 'Cube pendant 2', 'Suspension cube 2', { light: true, ceiling: true }],
  ['q_Light_Icosahedron', 'lights', 'Geometric pendant', 'Suspension géométrique', { light: true, ceiling: true }],
  ['q_Light_Icosahedron2', 'lights', 'Triple geometric pendant', 'Triple suspension géométrique', { light: true, ceiling: true }],
  ['q_Light_Stand1', 'lights', 'Arc floor lamp', 'Lampadaire arc', { light: true }],
  ['q_Light_Stand2', 'lights', 'Tall floor lamp', 'Grand lampadaire', { light: true }],
  ['q_Light_Floor1', 'lights', 'Tripod lamp', 'Lampe trépied', { light: true }],
  ['q_Light_Floor2', 'lights', 'White table lamp', 'Lampe blanche', { light: true, top: true }],
  ['q_Light_Floor3', 'lights', 'Shaded table lamp', 'Lampe abat-jour', { light: true, top: true }],
  ['q_Light_Floor4', 'lights', 'Round table lamp', 'Lampe ronde', { light: true, top: true }],
  ['q_Light_Desk', 'lights', 'Desk lamp', 'Lampe de bureau', { light: true, top: true }],
  ['q_Houseplant_1', 'decor', 'Bushy plant', 'Plante touffue'],
  ['q_Houseplant_2', 'decor', 'Cactus', 'Cactus', { top: true }],
  ['q_Houseplant_3', 'decor', 'Tall cactus', 'Grand cactus'],
  ['q_Houseplant_4', 'decor', 'Snake plant', 'Sansevieria'],
  ['q_Houseplant_5', 'decor', 'Low plant', 'Plante basse', { top: true }],
  ['q_Houseplant_6', 'decor', 'Large plant', 'Grande plante'],
  ['q_Houseplant_7', 'decor', 'Leafy plant', 'Plante feuillue'],
  ['q_Houseplant_8', 'decor', 'Small tree', 'Petit arbre'],
  ['q_Carpet_1', 'decor', 'Patterned rug', 'Tapis à motifs'],
  ['q_Carpet_2', 'decor', 'Large patterned rug', 'Grand tapis à motifs'],
  ['q_Carpet_Round', 'decor', 'Round patterned rug', 'Tapis rond à motifs'],
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
