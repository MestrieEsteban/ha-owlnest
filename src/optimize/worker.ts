/**
 * worker.ts — l'optimiseur, dans un Web Worker à part.
 *
 * Construit séparément (vite.optimizer.config.js) et servi à côté de la carte
 * par l'intégration : glTF-Transform pèse plusieurs centaines de Ko, que la
 * carte ne télécharge qu'au premier « Analyser ». Le calcul quitte aussi le
 * fil de l'interface : la tablette ne se fige pas pendant une minute.
 *
 * Un worker classique, pas un module : `importScripts` charge le décodeur
 * Draco hébergé par Google, le même que celui de la carte.
 */

import { Logger, WebIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { analyzeDocument } from './analyze';
import { optimizeDocument, type ImageResizer } from './model-ops';
import type { Params, ProtectSpec } from './types';

declare function importScripts(...urls: string[]): void;
declare const DracoDecoderModule: (config: { wasmBinary: ArrayBuffer; onModuleLoaded(m: unknown): void }) => void;

const DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

export type WorkerRequest =
  | { id: number; type: 'analyze'; glb: ArrayBuffer; protect: ProtectSpec }
  | { id: number; type: 'optimize'; ops: { id: string; params: Params }[]; protect: ProtectSpec };

let source: Uint8Array | null = null;
let draco: unknown = null;

/** Le GLB déclare-t-il Draco ? Lecture du seul bloc JSON. */
function usesDraco(glb: Uint8Array): boolean {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return false;
  const len = view.getUint32(12, true);
  const json = new TextDecoder().decode(glb.subarray(20, 20 + len));
  return json.includes('KHR_draco_mesh_compression');
}

async function loadDraco(): Promise<unknown> {
  if (draco) return draco;
  importScripts(`${DRACO}draco_wasm_wrapper_gltf.js`);
  const wasmBinary = await (await fetch(`${DRACO}draco_decoder_gltf.wasm`)).arrayBuffer();
  // Le module Emscripten est un « thenable » qui se rend lui-même : l'attendre
  // directement bouclerait. On le reçoit par le rappel, emballé.
  const { m } = await new Promise<{ m: unknown }>((resolve) => {
    DracoDecoderModule({ wasmBinary, onModuleLoaded: (mod) => resolve({ m: mod }) });
  });
  draco = m;
  return draco;
}

async function makeIO(glb: Uint8Array): Promise<WebIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const deps: Record<string, unknown> = { 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder };
  if (usesDraco(glb)) deps['draco3d.decoder'] = await loadDraco();
  return new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies(deps);
}

/**
 * Réduit une image avec les outils du navigateur. Sans conversion de couleur
 * ni prémultiplication : une carte de normales n'est pas une photo.
 */
const canvasResizer: ImageResizer = async (image, mime, width, height) => {
  const bmp = await createImageBitmap(new Blob([image as BlobPart], { type: mime }), {
    resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
    colorSpaceConversion: 'none', premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: mime, quality: 0.85 });
  // Un navigateur sans encodeur WebP rend du PNG : le type suit.
  return { image: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/png' };
};

type Reply = (msg: Record<string, unknown>, transfer?: Transferable[]) => void;

async function handle(req: WorkerRequest, reply: Reply): Promise<void> {
  if (req.type === 'analyze') {
    source = new Uint8Array(req.glb);
    const io = await makeIO(source);
    const doc = await io.readBinary(source);
    reply({ id: req.id, type: 'done', report: analyzeDocument(doc, source.byteLength, req.protect) });
    return;
  }
  if (!source) throw new Error('No model analyzed yet');
  const io = await makeIO(source);
  reply({ id: req.id, type: 'progress', step: 'read', index: 0, total: 1 });
  const doc: Document = await io.readBinary(source);
  const results = await optimizeDocument(doc, req.ops, {
    protect: req.protect, encoder: MeshoptEncoder, simplifier: MeshoptSimplifier, resize: canvasResizer,
  }, { onStep: (step, index, total) => reply({ id: req.id, type: 'progress', step, index, total }) });
  reply({ id: req.id, type: 'progress', step: 'write', index: 1, total: 1 });
  const out = await io.writeBinary(doc);
  const report = analyzeDocument(doc, out.byteLength, req.protect);
  reply({ id: req.id, type: 'done', glb: out.buffer, report, results }, [out.buffer]);
}

const scope = self as unknown as {
  onmessage: (e: MessageEvent<WorkerRequest>) => void;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const reply: Reply = (msg, transfer) => scope.postMessage(msg, transfer ?? []);
  handle(e.data, reply).catch((err: unknown) => {
    reply({ id: e.data.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};
