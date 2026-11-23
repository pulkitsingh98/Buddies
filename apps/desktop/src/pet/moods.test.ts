import { describe, expect, it } from 'vitest';
import { CARTOON_FRAMES } from '@deskpals/shared';
import { breathingSteps, MOODS, moodFromText, type MoodStep } from './moods';

const frames = new Set<string>(CARTOON_FRAMES);

function walk(step: MoodStep, depth: number, visit: (s: MoodStep, depth: number) => void) {
  visit(step, depth);
  for (const o of step.options) if (o.next) walk(o.next, depth + 1, visit);
}

describe('mood tree', () => {
  it('has 8 distinct moods with real pet frames', () => {
    expect(MOODS).toHaveLength(8);
    expect(new Set(MOODS.map((m) => m.emoji)).size).toBe(8);
    for (const m of MOODS) expect(frames.has(m.frame)).toBe(true);
  });

  it('every branch ends somewhere useful and stays shallow and bubble-sized', () => {
    for (const m of MOODS) {
      walk(m.step, 1, (s, depth) => {
        expect(depth).toBeLessThanOrEqual(3);
        expect(s.options.length).toBeGreaterThanOrEqual(2);
        expect(s.options.length).toBeLessThanOrEqual(3);
        for (const o of s.options) {
          expect(o.label.length).toBeLessThanOrEqual(20);
          expect(o.reply ?? o.action ?? o.next).toBeTruthy();
        }
      });
    }
  });

  it('recognises a shared mood from its text', () => {
    expect(moodFromText('😔 sad')?.id).toBe('sad');
    expect(moodFromText('🤷 meh')).toBeUndefined();
  });

  it('breathing lasts about half a minute', () => {
    const total = breathingSteps().reduce((s, x) => s + x.seconds, 0);
    expect(total).toBeGreaterThan(25);
    expect(total).toBeLessThan(45);
  });
});
