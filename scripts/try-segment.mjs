// Dev harness: run ISNet on a 1024×1024 24/32-bit BMP in Node and write the mask as a PGM.
// usage: node scripts/try-segment.mjs <model.onnx> <ort.wasm> <in.bmp> <out.pgm>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const ortMod = await import(require.resolve('onnxruntime-web/wasm'));
const ort = ortMod.default ?? ortMod;
const {
  toModelInput,
  toAlphaMask,
  MODEL_INPUT_SIZE: N,
} = await import('../apps/desktop/src/creator/segmentation.ts');

const [model, wasm, inPath, outPath] = process.argv.slice(2);
const bmp = readFileSync(inPath);
const off = bmp.readUInt32LE(10),
  w = bmp.readInt32LE(18),
  h = bmp.readInt32LE(22),
  bpp = bmp.readUInt16LE(28) / 8;
if (w !== N || Math.abs(h) !== N) throw new Error(`need ${N}x${N}, got ${w}x${h}`);
const stride = Math.ceil((w * bpp) / 4) * 4;
const rgba = new Uint8Array(N * N * 4);
for (let y = 0; y < N; y++) {
  const row = h > 0 ? N - 1 - y : y;
  for (let x = 0; x < N; x++) {
    const s = off + row * stride + x * bpp,
      d = (y * N + x) * 4;
    rgba[d] = bmp[s + 2];
    rgba[d + 1] = bmp[s + 1];
    rgba[d + 2] = bmp[s];
    rgba[d + 3] = 255;
  }
}
ort.env.wasm.wasmBinary = readFileSync(wasm);
ort.env.wasm.numThreads = 1;
let t = performance.now();
const session = await ort.InferenceSession.create(readFileSync(model).buffer, {
  executionProviders: ['wasm'],
});
console.log(
  'load ms',
  Math.round(performance.now() - t),
  'inputs',
  session.inputNames,
  'outputs',
  session.outputNames,
);
t = performance.now();
const input = new ort.Tensor('float32', toModelInput(rgba), [1, 3, N, N]);
const res = await session.run({ [session.inputNames[0]]: input });
const out = res[session.outputNames[0]];
console.log('infer ms', Math.round(performance.now() - t), 'dims', out.dims);
const mask = toAlphaMask(out.data);
writeFileSync(outPath, Buffer.concat([Buffer.from(`P5 ${N} ${N} 255\n`), Buffer.from(mask)]));
let fg = 0;
for (const v of mask) if (v > 127) fg++;
console.log('foreground %', ((100 * fg) / mask.length).toFixed(1));
