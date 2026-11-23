/// <reference lib="webworker" />
// Runs ONNX Runtime (wasm) off the UI thread. The model and wasm binary are passed in as
// ArrayBuffers (downloaded and hash-verified by Rust), so nothing is fetched from the network here.
import * as ort from 'onnxruntime-web/wasm';
import { MODEL_INPUT_SIZE, toAlphaMask, toModelInput } from './segmentation';

export type WorkerRequest =
  | { type: 'init'; model: ArrayBuffer; wasm: ArrayBuffer }
  | { type: 'run'; rgba: Uint8ClampedArray };
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'mask'; mask: Uint8ClampedArray }
  | { type: 'error'; message: string };

let session: ort.InferenceSession | null = null;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.type === 'init') {
      ort.env.wasm.wasmBinary = e.data.wasm;
      ort.env.wasm.proxy = false;
      // Multi-threading needs cross-origin isolation; fall back to one thread otherwise.
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1;
      session = await ort.InferenceSession.create(new Uint8Array(e.data.model), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      post({ type: 'ready' });
    } else {
      if (!session) throw new Error('model not loaded');
      const n = MODEL_INPUT_SIZE;
      const input = new ort.Tensor('float32', toModelInput(e.data.rgba, n), [1, 3, n, n]);
      const name = session.inputNames[0] ?? 'input';
      const out = await session.run({ [name]: input });
      const first = out[session.outputNames[0] ?? ''];
      if (!first) throw new Error('model produced no output');
      const mask = toAlphaMask(first.data as Float32Array, n);
      input.dispose();
      post({ type: 'mask', mask }, [mask.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
