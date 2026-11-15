/** Décodeur Draco pour Node (ligne de commande seulement). */
declare module 'draco3dgltf' {
  const draco3d: {
    createDecoderModule(options?: object): Promise<unknown>;
    createEncoderModule(options?: object): Promise<unknown>;
  };
  export default draco3d;
}
