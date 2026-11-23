import { ipc, type DownloadProgress } from '../lib/ipc';
import { MODEL_INPUT_SIZE } from './segmentation';
import type { RawImage } from './stylize';
import type { WorkerRequest, WorkerResponse } from './segment.worker';

const MODEL = 'isnet-general-use.onnx';
const WASM = 'ort-wasm-simd-threaded-1.31.1.wasm';

export type RemoverStatus =
  | { phase: 'downloading'; progress: DownloadProgress }
  | { phase: 'loading' }
  | { phase: 'segmenting' };

/** Turns a photo into a cutout (same pixels, alpha = subject). */
export interface BackgroundRemover {
  removeBackground(image: ImageBitmap, onStatus: (s: RemoverStatus) => void): Promise<RawImage>;
}

/** On-device ISNet via onnxruntime-web in a worker. Photos never leave the machine. */
export class OnDeviceRemover implements BackgroundRemover {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;

  private request(msg: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('worker not started'));
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerResponse>) =>
        e.data.type === 'error' ? reject(new Error(e.data.message)) : resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage(msg, transfer);
    });
  }

  private init(onStatus: (s: RemoverStatus) => void): Promise<void> {
    this.ready ??= (async () => {
      await ipc.ensureSegmentationAssets((progress) =>
        onStatus({ phase: 'downloading', progress }),
      );
      onStatus({ phase: 'loading' });
      const [model, wasm] = await Promise.all([
        ipc.readSegmentationAsset(MODEL),
        ipc.readSegmentationAsset(WASM),
      ]);
      this.worker = new Worker(new URL('./segment.worker.ts', import.meta.url), {
        type: 'module',
      });
      await this.request({ type: 'init', model, wasm }, [model, wasm]);
    })().catch((e: unknown) => {
      this.ready = null;
      this.dispose();
      throw e;
    });
    return this.ready;
  }

  async removeBackground(image: ImageBitmap, onStatus: (s: RemoverStatus) => void) {
    await this.init(onStatus);
    onStatus({ phase: 'segmenting' });
    const n = MODEL_INPUT_SIZE;
    const small = new OffscreenCanvas(n, n);
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('canvas unavailable');
    sctx.drawImage(image, 0, 0, n, n);
    const rgba = sctx.getImageData(0, 0, n, n).data;
    const res = await this.request({ type: 'run', rgba }, [rgba.buffer]);
    if (res.type !== 'mask') throw new Error('unexpected worker response');

    // Upscale the 1024² mask to the photo's size with smoothing, then use it as alpha.
    const maskImg = new ImageData(n, n);
    for (let i = 0; i < n * n; i++) maskImg.data[i * 4 + 3] = res.mask[i] ?? 0;
    sctx.putImageData(maskImg, 0, 0);
    const { width: w, height: h } = image;
    const full = new OffscreenCanvas(w, h);
    const fctx = full.getContext('2d', { willReadFrequently: true });
    if (!fctx) throw new Error('canvas unavailable');
    fctx.drawImage(small, 0, 0, w, h);
    const alpha = fctx.getImageData(0, 0, w, h).data;
    fctx.clearRect(0, 0, w, h);
    fctx.drawImage(image, 0, 0);
    const photo = fctx.getImageData(0, 0, w, h);
    for (let i = 3; i < photo.data.length; i += 4) photo.data[i] = alpha[i] ?? 0;
    return { width: w, height: h, data: photo.data };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
