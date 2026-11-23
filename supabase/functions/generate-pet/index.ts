// Generates cartoon-pet images with OpenAI. Called by the desktop app, one image per request:
//   { mode: 'character', kind, photo }  → the base character, from the user's photo
//   { mode: 'frame', frame, reference } → one expression/pose of that character
// Requires a signed-in user and spends their daily quota. The photo is never stored.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { characterPrompt, FRAME_IDS, framePrompt, type FrameId } from './prompts.ts';

const MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2.5-flare';
const QUALITY = Deno.env.get('OPENAI_IMAGE_QUALITY') ?? 'medium';
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

/** Accepts a base64 data URL of a PNG/JPEG/WebP within the size limit. */
function validImage(dataUrl: unknown): dataUrl is string {
  return (
    typeof dataUrl === 'string' &&
    /^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) &&
    dataUrl.length * 0.75 <= MAX_INPUT_BYTES
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json(500, { error: 'Cartoon pets are not set up yet (missing API key).' });

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
  let image: string;
  let quotaKind: 'character' | 'frame';
  if (body.mode === 'character') {
    if (!['person', 'animal', 'object'].includes(body.kind))
      return json(400, { error: 'bad kind' });
    if (!validImage(body.photo)) return json(400, { error: 'photo must be an image under 6 MB' });
    prompt = characterPrompt(body.kind);
    image = body.photo;
    quotaKind = 'character';
  } else if (body.mode === 'frame') {
    if (!FRAME_IDS.includes(body.frame as FrameId)) return json(400, { error: 'unknown frame' });
    if (!validImage(body.reference)) return json(400, { error: 'reference must be an image' });
    prompt = framePrompt(body.frame as FrameId);
    image = body.reference;
    quotaKind = 'frame';
  } else {
    return json(400, { error: 'unknown mode' });
  }

  const { error: quotaError } = await supabase.rpc('consume_generation_quota', {
    p_kind: quotaKind,
  });
  if (quotaError) return json(429, { error: quotaError.message });

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [{ image_url: image }],
      background: 'transparent',
      output_format: 'png',
      quality: QUALITY,
      size: '1024x1024',
      n: 1,
    }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const message: string = out?.error?.message ?? `image service error ${res.status}`;
    console.error('openai error', res.status, message);
    const blocked = out?.error?.code === 'moderation_blocked' || /safety|moderation/i.test(message);
    return json(blocked ? 422 : 502, {
      error: blocked
        ? 'The image service declined this photo. Try a different one.'
        : 'The image service had a problem. Please try again.',
    });
  }
  const b64: string | undefined = out?.data?.[0]?.b64_json;
  if (!b64) return json(502, { error: 'The image service returned no image.' });
  return json(200, { image: `data:image/png;base64,${b64}` });
});
