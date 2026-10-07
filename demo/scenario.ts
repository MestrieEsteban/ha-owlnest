/**
 * scenario.ts — le scénario de la visite : une soirée chez vous.
 *
 * D'abord ce que voit l'habitant (la maison, la lumière, les capteurs, une
 * porte qui s'ouvre), puis comment tout
 * cela se règle dans la carte, onglet par onglet. Chaque étape prépare sa
 * scène — point de vue, lampes, heure — pour que ce qu'elle montre soit à
 * l'écran, dans l'état où l'effet se voit le mieux.
 */

import type { TourStep } from './tour';

export interface ScenarioContext {
  /** Fait voler la caméra vers une vue enregistrée de la scène. */
  goView(id: string): void;
  /** Place le soleil à une heure de la journée. */
  setHour(hour: number): void;
  /** Force l'état d'une entité (lampe éteinte, porte fermée…). */
  setState(entityId: string, on: boolean): void;
  /** Ouvre ou ferme l'éditeur de la carte. */
  setEditor(open: boolean): void;
}

export function scenario(ctx: ScenarioContext): TourStep[] {
  return [
    {
      center: true,
      title: { en: 'Welcome to Owlnest', fr: 'Bienvenue dans Owlnest' },
      text: {
        en: 'Your home in live 3D for Home Assistant. Below is the <b>real card</b>, connected to a simulated home. Let’s spend an evening in it, then see how it’s all set up, <b>right in the card</b>.',
        fr: 'Votre maison en 3D vivante pour Home Assistant. Ci-dessous, la <b>vraie carte</b>, branchée sur une maison simulée. Passons-y une soirée, puis voyons comment tout se règle, <b>directement dans la carte</b>.',
      },
      enter: () => { ctx.setEditor(false); ctx.goView('home'); ctx.setHour(19); },
    },
    {
      title: { en: 'Your home, in 3D', fr: 'Votre maison, en 3D' },
      text: {
        en: '<b>Drag</b> to turn around the house. <b>Scroll</b> or <b>pinch</b> to zoom.',
        fr: '<b>Glissez</b> pour tourner autour de la maison. <b>Molette</b> ou <b>pincement</b> pour zoomer.',
      },
      success: {
        en: 'Your whole home, from every angle: zoom into a room to see it up close.',
        fr: 'Toute votre maison, sous tous les angles : zoomez sur une pièce pour la voir de près.',
      },
      doneOn: 'orbit',
      enter: () => { ctx.setEditor(false); ctx.goView('home'); },
    },
    {
      title: { en: 'Lights that follow your lamps', fr: 'Des lumières qui suivent vos lampes' },
      text: {
        en: 'Night is falling. <b>Tap the bedside lamp</b> to switch it on.',
        fr: 'La nuit tombe. <b>Touchez la lampe de chevet</b> pour l’allumer.',
      },
      success: {
        en: 'The 3D light follows the real lamp: on/off, <b>colour</b> and <b>brightness</b>. A long press opens its settings in Home Assistant.',
        fr: 'La lumière 3D suit la vraie lampe : allumage, <b>couleur</b> et <b>intensité</b>. Un appui long ouvre ses réglages dans Home Assistant.',
      },
      focus: 'lamp',
      doneOn: 'light',
      enter: () => { ctx.setEditor(false); ctx.goView('home'); ctx.setHour(20.5); ctx.setState('light.chevet', false); },
    },
    {
      title: { en: 'Sensors where they are', fr: 'Les capteurs à leur place' },
      text: {
        en: 'Every device has its anchor in the right room: <b>21.4 °C</b> in the living room, 19.2 °C in the bedroom. The <b>heating</b> glows orange while it heats, the TV purple while it plays.',
        fr: 'Chaque appareil a son ancre dans la bonne pièce : <b>21,4 °C</b> au salon, 19,2 °C dans la chambre. Le <b>chauffage</b> s’allume en orange quand il chauffe, la télé en violet quand elle joue.',
      },
      focus: 'sensor',
      enter: () => { ctx.setEditor(false); ctx.goView('home'); },
    },
    {
      title: { en: 'A door that opens… and a rule', fr: 'Une porte qui s’ouvre… et une règle' },
      text: {
        en: 'Someone is coming home. <b>Tap the front door sensor</b>, as if it opened.',
        fr: 'Quelqu’un rentre. <b>Touchez le capteur de la porte d’entrée</b>, comme si elle s’ouvrait.',
      },
      success: {
        en: 'The door swings open in 3D. And a <b>rule</b> took over: the camera flew to the entrance and an alert showed up. You’ll see how it’s written in a minute.',
        fr: 'La porte pivote en 3D. Et une <b>règle</b> a pris le relais : la caméra a volé vers l’entrée et une alerte s’est affichée. Vous verrez comment elle s’écrit dans un instant.',
      },
      focus: 'door',
      doneOn: 'door',
      enter: () => { ctx.setEditor(false); ctx.setState('binary_sensor.porte_entree', false); ctx.goView('home'); },
    },
    {
      title: { en: 'Saved views', fr: 'Des vues enregistrées' },
      text: {
        en: 'Back to the whole house: <b>tap “Overview”</b> in the bar at the bottom.',
        fr: 'Revenons à toute la maison : <b>touchez « Ensemble »</b> dans la barre du bas.',
      },
      success: {
        en: 'Your favourite viewpoints, one tap away. Rules use them too, like the door just now.',
        fr: 'Vos points de vue favoris, à un clic. Les règles s’en servent aussi, comme la porte tout à l’heure.',
      },
      focus: 'views',
      doneOn: 'view',
      enter: () => ctx.setEditor(false),
    },
    {
      title: { en: 'Everything is set up here', fr: 'Tout se règle ici' },
      text: {
        en: 'All of this was set up <b>in the card</b>: no YAML, no file to copy. <b>Open the editor</b> with the pencil.',
        fr: 'Tout ça a été réglé <b>dans la carte</b> : pas de YAML, pas de fichier à copier. <b>Ouvrez l’éditeur</b> avec le crayon.',
      },
      success: {
        en: 'Here is the editor. Let’s go through its tabs.',
        fr: 'Voici l’éditeur. Faisons le tour de ses onglets.',
      },
      focus: 'pencil',
      doneOn: 'edit',
      enter: () => ctx.setEditor(false),
    },
    {
      title: { en: 'Anchors', fr: 'Les ancres' },
      text: {
        en: 'Every device of the house is listed here. <b>Drag</b> an anchor on the model to move it, <b>click</b> it to link an entity, change its icon or its light style.',
        fr: 'Tous les appareils de la maison sont listés ici. <b>Glissez</b> une ancre sur le modèle pour la déplacer, <b>cliquez-la</b> pour la relier à une entité, changer son icône ou son style de lumière.',
      },
      focus: 'tabAnchors',
      side: 'left',
      enter: () => ctx.setEditor(true),
    },
    {
      title: { en: 'Openings', fr: 'Les ouvrants' },
      text: {
        en: 'Open the <b>🚪 Openings</b> tab.',
        fr: 'Ouvrez l’onglet <b>🚪 Ouvrants</b>.',
      },
      success: {
        en: 'The front door is here: it swings 95° when its sensor opens. To add one: <b>+ Opening</b>, then click a door, window or shutter on the model, and preview the movement.',
        fr: 'La porte d’entrée est là : elle pivote de 95° quand son capteur s’ouvre. Pour en ajouter : <b>+ Ouvrant</b>, cliquez une porte, une fenêtre ou un volet sur le modèle, et prévisualisez le mouvement.',
      },
      focus: 'tabParts',
      side: 'left',
      enter: () => ctx.setEditor(true),
      doneOn: 'tab:parts',
    },
    {
      title: { en: 'Rules', fr: 'Les règles' },
      text: {
        en: 'Open the <b>⚡ Rules</b> tab.',
        fr: 'Ouvrez l’onglet <b>⚡ Règles</b>.',
      },
      success: {
        en: 'Here is the rule of the evening: <i>when the front door opens → Entrance view, red anchor, alert</i>. Written as <b>when… if… then…</b>, no code.',
        fr: 'Voici la règle de la soirée : <i>quand la porte d’entrée s’ouvre → vue Entrée, ancre en rouge, alerte</i>. Écrite en <b>quand… si… alors…</b>, sans code.',
      },
      focus: 'tabRules',
      side: 'left',
      enter: () => ctx.setEditor(true),
      doneOn: 'tab:rules',
    },
    {
      title: { en: 'Sun and weather', fr: 'Soleil et météo' },
      text: {
        en: 'Open the <b>☁ Weather</b> tab.',
        fr: 'Ouvrez l’onglet <b>☁ Météo</b>.',
      },
      success: {
        en: 'The sun follows <code>sun.sun</code>, rain and snow your weather entity. And here you can <b>simulate</b>: move the time, make it snow, to check your scene at any hour.',
        fr: 'Le soleil suit <code>sun.sun</code>, la pluie et la neige votre entité météo. Et ici, vous pouvez <b>simuler</b> : changez l’heure, faites neiger, pour vérifier votre scène à toute heure.',
      },
      focus: 'tabWeather',
      side: 'left',
      enter: () => ctx.setEditor(true),
      doneOn: 'tab:weather',
    },
    {
      center: true,
      title: { en: 'Your turn', fr: 'À vous de jouer' },
      text: {
        en: 'Owlnest is <b>your own home</b> in 3D, set up in the card. Free, open source, 100% local. Bring your model (Sweet Home 3D, Blender…) or start with this demo house.',
        fr: 'Owlnest, c’est <b>votre logement</b> en 3D, réglé dans la carte. Gratuit, open source, 100 % local. Apportez votre modèle (Sweet Home 3D, Blender…) ou partez de cette maison de démo.',
      },
    },
  ];
}
