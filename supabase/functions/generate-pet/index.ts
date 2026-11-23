// Generates cartoon-pet images with FLUX.2 [klein] on Cloudflare Workers AI (free daily allowance).
// Called by the desktop app, one image per request:
//   { mode: 'character', kind, photo }  → the base character, from the user's photo
//   { mode: 'frame', frame, reference } → one expression/pose of that character
// Images come back on a green screen; the app removes the background on-device.
// Requires a signed-in user and spends their daily quota. The photo is never stored.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { characterPrompt, FRAME_IDS, framePrompt, type FrameId } from './prompts.ts';

const MODEL = Deno.env.get('CF_IMAGE_MODEL') ?? '@cf/black-forest-labs/flux-2-klein-4b';
const MAX_INPUT_BYTES = 6 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

type Body =
  | { mode: 'character'; kind: string; photo: string }
  | { mode: 'frame'; frame: string; reference: string };

/** Decodes a base64 data URL of a PNG/JPEG/WebP within the size limit. */
function decodeImage(dataUrl: unknown): Blob | null {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!m || m[2].length * 0.75 > MAX_INPUT_BYTES) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function mimeOf(b64: string): string {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const account = Deno.env.get('CF_ACCOUNT_ID');
  const token = Deno.env.get('CF_API_TOKEN');
  if (!account || !token) return json(500, { error: 'Cartoon pets are not set up yet.' });

  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return json(401, { error: 'Please sign in to make cartoon pets.' });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  let prompt: string;
  let image: Blob | null;
  let quotaKind: 'character' | 'frame';
  if (body.mode === 'character') {
    if (!['person', 'animal', 'object'].includes(body.kind))
      return json(400, { error: 'bad kind' });
    prompt = characterPrompt(body.kind);
    image = decodeImage(body.photo);
    quotaKind = 'character';
  } else if (body.mode === 'frame') {
    if (!FRAME_IDS.includes(body.frame as FrameId)) return json(400, { error: 'unknown frame' });
    prompt = framePrompt(body.frame as FrameId);
    image = decodeImage(body.reference);
    quotaKind = 'frame';
  } else {
    return json(400, { error: 'unknown mode' });
  }
  if (!image) return json(400, { error: 'image must be a PNG/JPEG/WebP under 6 MB' });

  const { error: quotaError } = await supabase.rpc('consume_generation_quota', {
    p_kind: quotaKind,
  });
  if (quotaError) return json(429, { error: quotaError.message });

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('input_image_0', image, 'reference');
  form.append('width', '1024');
  form.append('height', '1024');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const out = await res.json().catch(() => null);
  const b64: string | undefined = out?.result?.image;
  if (!res.ok || !b64) {
    const message = out?.errors?.[0]?.message ?? `image service error ${res.status}`;
    console.error('workers-ai error', res.status, message);
    if (res.status === 429 || /neuron|allocation|limit/i.test(message)) {
      return json(429, { error: "Today's free drawing allowance is used up. Try again tomorrow." });
    }
    return json(502, { error: 'The image service had a problem. Please try again.' });
  }
  return json(200, { image: `data:${mimeOf(b64)};base64,${b64}` });
});
