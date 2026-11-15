/// <reference types="node" />
/**
 * cli.ts — l'optimiseur en ligne de commande (voir scripts/optimize-glb.mjs).
 *
 * Même cœur que le worker de la carte : mêmes estimations, mêmes
 * transformations, même protection. Seuls changent la lecture du fichier et
 * la réduction des images (sharp au lieu d'un canevas).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger, NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { analyzeDocument } from './analyze';
import { CATALOG, defaultParams, modelOps, presetSelection, type EstimateContext, type PresetName } from './catalog';
import { optimizeDocument, type ImageResizer } from './model-ops';
import { protectFromScene } from './protected';
import type { ModelReport, OpResult, Params, ProtectSpec, Selection } from './types';

/** Titres courts, pour la console. */
const TITLES: Record<string, string> = {
  A1: 'Physical → Standard materials', A2: 'Transmission off', A3: 'Selective shadows', A4: 'Static sun shadow',
  A5: 'Spatial batching', A6: 'DPR / FPS cap', A7: 'Hide objects', A8: 'Texture size cap (GPU)',
  B1: 'Dedup + prune', B2: 'Weld + instance', B3: 'Draco → meshopt + quantize', B4: 'Remove unused attributes',
  C1: 'Simplify figures', C2: 'Simplify dense props', C3: 'Shrink book textures', C4: 'Shrink normal/roughness maps',
  C5: 'KTX2 textures', C6: 'Bake materials', C7: 'Join static meshes',
};

interface Args {
  input: string;
  output?: string;
  preset?: PresetName;
  only?: string[];
  keep: string[];
  scene?: string;
  report?: string;
  each: boolean;
  params: Record<string, Params>;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { input: '', keep: [], each: false, params: {} };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => argv[++i];
    if (v === '--preset') a.preset = next() as PresetName;
    else if (v === '--only') a.only = next().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (v === '--keep') a.keep.push(next());
    else if (v === '--scene') a.scene = next();
    else if (v === '--report') a.report = next();
    else if (v === '--each') a.each = true;
    else if (v === '--param') {
      // --param C1.target=25000
      const m = /^([A-C]\d)\.(\w+)=(.*)$/i.exec(next());
      if (m) {
        const raw = m[3];
        const val = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
        (a.params[m[1].toUpperCase()] ??= {})[m[2]] = val;
      }
    } else rest.push(v);
  }
  a.input = rest[0] ?? '';
  a.output = rest[1];
  return a;
}

const USAGE = `Usage: npm run optimize-glb -- <input.glb> [output.glb] [options]

  --preset safe|balanced|aggressive   pre-selection (default: balanced)
  --only B1,C1,C3                     exactly these items (overrides the preset)
  --param C1.target=25000             item parameter (repeatable)
  --keep <regex>                      extra protected node names (repeatable)
  --scene <scene.json>                Owlnest scene (exported from the card): protects
                                      anchors, light hosts, openings and effects
  --report <report.json>              write the analysis + results as JSON
  --each                              measure every model item alone against the input
                                      (no output file), for the comparison matrix`;

async function makeIO(): Promise<NodeIO> {
  const draco3d = (await import('draco3dgltf')).default as { createDecoderModule(): Promise<unknown> };
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

const sharpResizer: ImageResizer = async (image, mime, width, height) => {
  const sharp = (await import('sharp')).default;
  let img = sharp(image).resize(width, height, { fit: 'fill', kernel: 'lanczos3' });
  if (mime === 'image/png') img = img.png();
  else if (mime === 'image/jpeg') img = img.jpeg({ quality: 85 });
  else img = img.webp({ quality: 85 });
  return { image: new Uint8Array(await img.toBuffer()), mime };
};

function selectionFor(a: Args): Selection {
  const sel = presetSelection(a.preset ?? 'balanced');
  if (a.only) for (const d of CATALOG) sel[d.id] = { enabled: a.only.includes(d.id), params: defaultParams(d) };
  for (const [id, p] of Object.entries(a.params)) if (sel[id]) sel[id].params = { ...sel[id].params, ...p };
  return sel;
}

const fmt = (n: number, d = 1) => n.toFixed(d);
const k = (n: number) => (Math.abs(n) >= 1e6 ? `${fmt(n / 1e6, 2)}M` : Math.abs(n) >= 1e3 ? `${fmt(n / 1e3, 1)}k` : String(Math.round(n)));

function summary(r: ModelReport): string {
  const s = r.stats;
  return `${fmt(s.fileMB)} MB file · ${k(s.triangles)} tris · ${s.primitives} prims · ${s.textures} tex (${fmt(s.textureGpuMB)} MB GPU) · geometry ${fmt(s.geometryGpuMB)} MB GPU · ${s.materials} mats (${s.physical} physical, ${s.transmission} transmission, ${s.doubleSided} double-sided) · ${s.compression}`;
}

async function measure(io: NodeIO, doc: Document, protect: ProtectSpec): Promise<{ bytes: Uint8Array; report: ModelReport }> {
  const bytes = await io.writeBinary(doc);
  return { bytes, report: analyzeDocument(doc, bytes.byteLength, protect) };
}

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (!a.input) { console.log(USAGE); return 1; }
  if (a.output && resolve(a.output) === resolve(a.input)) {
    console.error('Refusing to overwrite the input file: choose another output name.');
    return 1;
  }
  const io = await makeIO();
  const scene = a.scene ? JSON.parse(readFileSync(a.scene, 'utf8')) : null;
  // Un fichier exporté par la carte enveloppe la scène : { version, scene }.
  const protect = protectFromScene(scene?.scene ?? scene, a.keep);
  const src = new Uint8Array(readFileSync(a.input));

  const t0 = Date.now();
  const doc = await io.readBinary(src);
  const before = analyzeDocument(doc, src.byteLength, protect);
  console.log(`Read ${a.input} in ${Date.now() - t0} ms`);
  console.log(`Before: ${summary(before)}`);
  if (before.protectedNames.length) console.log(`Protected: ${before.protectedNames.length} names (${before.protectedNames.slice(0, 8).join(', ')}${before.protectedNames.length > 8 ? '…' : ''})`);

  const ctx: EstimateContext = { dpr: 2, maxPixelRatio: 1.5, maxFps: 45 };
  console.log('\nEstimates (from the analysis):');
  for (const d of CATALOG) {
    const g = d.estimate(before, defaultParams(d), ctx);
    const parts = [
      g.affected !== undefined ? `${g.affected} affected` : '',
      g.skipped ? `${g.skipped} protected` : '',
      g.triangles ? `-${k(g.triangles)} tris` : '',
      g.drawCalls ? `-${k(g.drawCalls)} calls` : '',
      g.passes ? `-${g.passes} pass` : '',
      g.gpuMB ? `-${fmt(g.gpuMB)} MB GPU` : '',
      g.fileMB ? `-${fmt(g.fileMB)} MB file` : '',
      g.fpsHint ? `~${Math.round(g.fpsHint * 100)}% frame` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${d.id} ${TITLES[d.id].padEnd(30)} [${d.category}/${d.cost}${d.cliOnly ? '/n.a.' : ''}] ${parts}`);
  }

  const encoder = MeshoptEncoder, simplifier = MeshoptSimplifier;
  const opCtx = { protect, encoder, simplifier, resize: sharpResizer };
  const out: Record<string, unknown> = { input: a.input, before };

  if (a.each) {
    const rows: unknown[] = [];
    console.log('\nEach model item alone (B3 is added automatically for Draco inputs):');
    const ids = CATALOG.filter((d) => d.category !== 'render' && !d.cliOnly && (!a.only || a.only.includes(d.id))).map((d) => d.id);
    for (const id of ids) {
      const d = await io.readBinary(src);
      const t = Date.now();
      const params = { ...defaultParams(CATALOG.find((c) => c.id === id)!), ...(a.params[id] ?? {}) };
      const res = await optimizeDocument(d, [{ id, params }], opCtx);
      const m = await measure(io, d, protect);
      const ms = Date.now() - t;
      rows.push({ id, results: res, after: m.report.stats, ms });
      console.log(`  ${id} ${TITLES[id].padEnd(30)} ${line(before, m.report)} (${ms} ms) ${describe(res)}`);
    }
    out.each = rows;
  } else {
    const sel = selectionFor(a);
    const ops = modelOps(sel);
    console.log(`\nApplying: ${ops.map((o) => o.id).join(', ') || '(nothing)'}`);
    const t = Date.now();
    const res = await optimizeDocument(doc, ops, opCtx, { onStep: (id, i, n) => console.log(`  [${i + 1}/${n}] ${id} ${TITLES[id]}`) });
    const m = await measure(io, doc, protect);
    console.log(`Done in ${Date.now() - t} ms: ${describe(res)}`);
    console.log(`After:  ${summary(m.report)}`);
    console.log(`Delta:  ${line(before, m.report)}`);
    out.ops = ops;
    out.results = res;
    out.after = m.report;
    if (a.output) {
      writeFileSync(a.output, m.bytes);
      console.log(`Wrote ${a.output}`);
    }
  }
  if (a.report) {
    writeFileSync(a.report, JSON.stringify(out, null, 2));
    console.log(`Report: ${a.report}`);
  }
  return 0;
}

function describe(res: OpResult[]): string {
  return res.map((r) => `${r.id}: ${r.affected}${r.skipped ? ` (+${r.skipped} protected)` : ''}${r.note ? ` [${r.note}]` : ''}`).join('; ');
}

function line(b: ModelReport, a: ModelReport): string {
  const s = b.stats, t = a.stats;
  return `tris ${k(s.triangles)}→${k(t.triangles)} · tex ${s.textures}→${t.textures} · tex GPU ${fmt(s.textureGpuMB)}→${fmt(t.textureGpuMB)} MB · geo GPU ${fmt(s.geometryGpuMB)}→${fmt(t.geometryGpuMB)} MB · prims ${s.primitives}→${t.primitives} · file ${fmt(s.fileMB)}→${fmt(t.fileMB)} MB`;
}
