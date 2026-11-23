// Server-side prompts for cartoon pets. Clients may only pick a frame id from this list,
// so the function can't be used as a general-purpose image generator.
// Keep FRAME_IDS in sync with packages/shared/src/frames.ts.

export const STYLE = [
  'Style: an adorable chibi cartoon sticker character — big head, small body, soft rounded shapes,',
  'clean bold dark outlines, flat cel shading with soft highlights, warm vibrant colours.',
  'Full body, centred, the whole character visible with a small margin, feet near the bottom edge.',
  'Keep exactly the same character design, proportions, colours, size and framing as the reference.',
  'Solid flat pure green (#00FF00) background filling the whole image, like a green screen.',
  'No green on the character. No ground shadow, no scenery, no text, no border, no watermark.',
].join(' ');

const GESTURE_NOTE =
  'Adapt gestures to the character’s body (hands, paws, wings, or tiny stubby arms for objects).';

export function characterPrompt(kind: string): string {
  const subject =
    kind === 'object'
      ? 'the object in this photo into a cute living character with a friendly face and tiny arms and legs, keeping its shape, colours and details'
      : kind === 'animal'
        ? 'the animal in this photo into a cute cartoon character, keeping its breed/species, fur or feather colours, markings and any collar or accessories'
        : 'the person in this photo into a cute cartoon character that is clearly recognisable as them, keeping their hair colour and style, skin tone, face shape, glasses, facial hair, clothing colours and accessories';
  return `Using image 0 as reference, turn ${subject}. ${STYLE} Standing, facing the viewer, neutral gentle smile, relaxed pose.`;
}

const FRAMES = {
  blink: 'Same pose as the reference, but both eyes gently closed mid-blink, relaxed mouth.',
  happy: 'Same pose, a big happy smile with bright sparkling eyes.',
  laugh: 'Laughing out loud with joy: eyes squeezed shut, mouth wide open, leaning back slightly.',
  love: 'Heart-shaped eyes and a blissful smile, two small pink hearts floating near the head.',
  blush: 'Shy and flattered: rosy blushing cheeks, small bashful smile, looking slightly down.',
  surprised: 'Surprised: wide eyes, small round open mouth, arms slightly raised.',
  sad: 'Sad: droopy eyes, small frown, one small tear, shoulders slumped.',
  grumpy: 'Grumpy and annoyed: furrowed brows, puffed cheeks pouting, arms crossed.',
  sleepy: 'Sleepy: half-closed eyes, big yawn, rubbing one eye.',
  asleep:
    'Fast asleep lying down on its side on the ground, eyes closed, peaceful smile, a small "z" floating above.',
  wink: 'A playful wink with one eye closed and a cheeky grin, giving a thumbs-up.',
  dizzy: 'Dizzy: swirly spiral eyes, wobbly smile, tiny stars circling the head.',
  walk1:
    'Walking towards the right in a three-quarter view, mid-stride with the front leg forward, cheerful.',
  walk2:
    'Walking towards the right in a three-quarter view, the opposite step of a walk cycle (other leg forward), cheerful.',
  sit: 'Sitting on the ground, relaxed and content, legs out in front.',
  wave: 'Waving hello with one hand raised high and a big friendly smile.',
  celebrate:
    'Celebrating: jumping for joy with both arms up, huge smile, a few confetti pieces around.',
} as const;

export type FrameId = keyof typeof FRAMES;
export const FRAME_IDS = Object.keys(FRAMES) as FrameId[];

export function framePrompt(id: FrameId): string {
  return `Redraw the cartoon character from image 0. ${FRAMES[id]} ${GESTURE_NOTE} ${STYLE}`;
}
