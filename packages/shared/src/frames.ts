/**
 * Expression/pose frames of a cartoon pet, in generation order. The prompts live server-side in
 * supabase/functions/generate-pet/prompts.ts — keep the ids in sync.
 * `neutral` is the base character itself.
 */
export const CARTOON_FRAMES = [
  'neutral',
  'blink',
  'happy',
  'laugh',
  'love',
  'blush',
  'surprised',
  'sad',
  'grumpy',
  'sleepy',
  'asleep',
  'wink',
  'dizzy',
  'walk1',
  'walk2',
  'sit',
  'wave',
  'celebrate',
] as const;

export type CartoonFrame = (typeof CARTOON_FRAMES)[number];
