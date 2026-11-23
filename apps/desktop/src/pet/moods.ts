import type { CartoonFrame } from '@deskpals/shared';

/**
 * The mood check-in as a small decision tree: pick a mood → the pet reacts and asks a follow-up
 * → each answer leads to a reply, an action (breathing, a break, a hug…) and sometimes one more
 * question. Pure data so it is easy to extend and test.
 */

export type MoodId =
  'happy' | 'excited' | 'calm' | 'tired' | 'stressed' | 'sad' | 'angry' | 'lonely';

export type MoodAction =
  | 'celebrate'
  | 'hearts'
  | 'breathe'
  | 'stretch'
  | 'break'
  | 'focus'
  | 'water'
  | 'joke'
  | 'friends'
  | 'compliment'
  | 'stayClose';

export interface MoodStep {
  question: string;
  options: MoodOption[];
}

export interface MoodOption {
  label: string;
  reply?: string;
  action?: MoodAction;
  next?: MoodStep;
}

export interface Mood {
  id: MoodId;
  emoji: string;
  label: string;
  /** How friends' pets describe it. */
  valence: 'positive' | 'neutral' | 'negative';
  /** The pet's face while it reacts. */
  frame: CartoonFrame;
  /** Immediate reaction, then the follow-up question. */
  reaction: string;
  step: MoodStep;
}

const feelingBetter: MoodStep = {
  question: 'Feeling any better?',
  options: [
    { label: 'A bit, thanks', reply: "Good. I'm right here if you need me 💛", action: 'hearts' },
    {
      label: 'Not really',
      reply: "That's okay. Maybe a short break, or talk to someone you like?",
      next: {
        question: 'What would help most?',
        options: [
          { label: '5-min break', action: 'break' },
          { label: 'Message a friend', action: 'friends' },
          { label: 'Just stay with me', action: 'stayClose', reply: "I'm not going anywhere 🫂" },
        ],
      },
    },
  ],
};

export const MOODS: Mood[] = [
  {
    id: 'happy',
    emoji: '😄',
    label: 'happy',
    valence: 'positive',
    frame: 'happy',
    reaction: 'Yay! I love that for you!',
    step: {
      question: "What's making today good?",
      options: [
        {
          label: 'Work is going well',
          reply: 'Look at you go! Keep riding that wave 🌊',
          action: 'celebrate',
        },
        { label: 'Fun plans', reply: 'Ooh, have the best time! 🎈', action: 'celebrate' },
        { label: 'Just good vibes', reply: 'The best kind of day ✨', action: 'hearts' },
      ],
    },
  },
  {
    id: 'excited',
    emoji: '🤩',
    label: 'excited',
    valence: 'positive',
    frame: 'celebrate',
    reaction: 'Ooh! Something exciting?!',
    step: {
      question: 'Want to tell a friend?',
      options: [
        { label: 'Yes!', action: 'friends', reply: 'Spread the joy! 🎉' },
        { label: 'Celebrate with me', action: 'celebrate', reply: 'Party time! 🥳' },
      ],
    },
  },
  {
    id: 'calm',
    emoji: '😌',
    label: 'calm',
    valence: 'positive',
    frame: 'blush',
    reaction: 'Nice and peaceful.',
    step: {
      question: 'Keep it gentle, or want a little boost?',
      options: [
        { label: 'Keep it gentle', reply: "I'll keep things quiet and cosy ☁️", action: 'hearts' },
        { label: 'A boost please', action: 'compliment' },
        { label: 'Time to focus', action: 'focus', reply: "Let's get in the zone 🍅" },
      ],
    },
  },
  {
    id: 'tired',
    emoji: '😴',
    label: 'tired',
    valence: 'neutral',
    frame: 'sleepy',
    reaction: 'Aww, sleepy one…',
    step: {
      question: 'Long day, or not enough sleep?',
      options: [
        {
          label: 'Not enough sleep',
          reply: 'Some water and daylight might help. And an early night tonight? 🌙',
          action: 'water',
        },
        {
          label: 'Long day',
          reply: "You've done a lot. A short break is well earned.",
          next: {
            question: 'Take 5 with me?',
            options: [
              { label: 'Yes, 5-min break', action: 'break' },
              { label: 'Stretch instead', action: 'stretch' },
              { label: 'Push on', reply: "Okay! I'll cheer you on quietly 📣", action: 'hearts' },
            ],
          },
        },
        {
          label: 'Both 😵',
          reply: 'Be extra kind to yourself today. Water first?',
          action: 'water',
        },
      ],
    },
  },
  {
    id: 'stressed',
    emoji: '😣',
    label: 'stressed',
    valence: 'negative',
    frame: 'surprised',
    reaction: "Oh no, that's a lot. Let's slow down together.",
    step: {
      question: 'Want to try something?',
      options: [
        { label: 'Breathe with me', action: 'breathe', next: feelingBetter },
        {
          label: 'Break it down',
          reply: 'Pick just one small thing. We do that one first, together.',
          action: 'focus',
        },
        {
          label: 'Just vent',
          reply: "I'm listening. You're doing your best, and that's enough 🫂",
          action: 'hearts',
        },
      ],
    },
  },
  {
    id: 'sad',
    emoji: '😔',
    label: 'sad',
    valence: 'negative',
    frame: 'sad',
    reaction: "I'm sorry you're feeling down.",
    step: {
      question: 'Want a hug, or a little distraction?',
      options: [
        {
          label: 'A hug 🫂',
          reply: 'Biggest hug. You matter so much 💛',
          action: 'hearts',
          next: feelingBetter,
        },
        { label: 'Distract me', action: 'joke', next: feelingBetter },
        {
          label: 'Tell a friend',
          action: 'friends',
          reply: 'Good idea. People who love you want to know.',
        },
      ],
    },
  },
  {
    id: 'angry',
    emoji: '😠',
    label: 'frustrated',
    valence: 'negative',
    frame: 'grumpy',
    reaction: "Grr, that's annoying. I'm on your side.",
    step: {
      question: 'What would help?',
      options: [
        { label: 'Cool down breathing', action: 'breathe', next: feelingBetter },
        {
          label: 'Walk away 5 min',
          action: 'break',
          reply: 'Step away. It will still be there — smaller.',
        },
        {
          label: 'Let it out',
          reply: 'Ugh! Totally fair. Shake it out with me 💢',
          action: 'celebrate',
        },
      ],
    },
  },
  {
    id: 'lonely',
    emoji: '🥺',
    label: 'lonely',
    valence: 'negative',
    frame: 'sad',
    reaction: "Hey, you're not alone — I'm right here.",
    step: {
      question: 'Want to reach out to someone?',
      options: [
        { label: 'Message a friend', action: 'friends', reply: "They'll be glad you did 💌" },
        { label: 'Stay with me', action: 'stayClose', reply: "I'll stay close today 🐾" },
      ],
    },
  },
];

export function moodById(id: string): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}

/** Mood whose emoji starts `text` (friend notifications carry "😔 sad"). */
export function moodFromText(text: string): Mood | undefined {
  return MOODS.find((m) => text.startsWith(m.emoji));
}

export const JOKES = [
  'Why did the scarecrow win an award? He was outstanding in his field 🌾',
  'What do you call a sleeping dinosaur? A dino-snore 🦕',
  'Why don’t eggs tell jokes? They’d crack each other up 🥚',
  'What do you call a bear with no teeth? A gummy bear 🐻',
  'Why did the cookie go to the doctor? It felt crummy 🍪',
  'What do clouds wear under their shorts? Thunderwear ⛈️',
  'Why are cats bad storytellers? They only have one tale 🐱',
  'What did the ocean say to the beach? Nothing, it just waved 🌊',
  'Why did the computer go to therapy? Too many bytes of emotional baggage 💻',
  'What do you call cheese that isn’t yours? Nacho cheese 🧀',
  'How does a penguin build its house? Igloos it together 🐧',
  'Why did the banana go to the party? Because it was a-peeling 🍌',
  'What’s a cat’s favourite colour? Purr-ple 💜',
  'Why can’t you trust stairs? They’re always up to something 🪜',
  'What did one plate say to the other? Lunch is on me 🍽️',
] as const;

/** Guided breathing: (text, seconds, phase) steps, three gentle cycles. */
export function breathingSteps(
  cycles = 3,
): { text: string; seconds: number; phase: 'in' | 'hold' | 'out' }[] {
  const steps: { text: string; seconds: number; phase: 'in' | 'hold' | 'out' }[] = [];
  for (let i = 0; i < cycles; i++) {
    steps.push({ text: 'Breathe in… 🌬️', seconds: 4, phase: 'in' });
    steps.push({ text: 'Hold…', seconds: 2, phase: 'hold' });
    steps.push({ text: 'And out… 🍃', seconds: 5, phase: 'out' });
  }
  return steps;
}
