import { describe, expect, it } from 'vitest';
import { CARTOON_FRAMES } from '@deskpals/shared';
import { Expressions, type ExpressionInput } from './expressions';

const all = new Set<string>(CARTOON_FRAMES);
const idle: ExpressionInput = { state: 'idle', sleepy: false, sinceInteraction: 0, userIdle: 0 };
const rngHalf = () => 0.5;

describe('Expressions', () => {
  it('blinks briefly every few seconds when idle', () => {
    const e = new Expressions(all, rngHalf, 0); // first blink at 2 + 0.5*4 = 4s
    expect(e.frame(idle, 3.9)).toBe('neutral');
    expect(e.frame(idle, 4.0)).toBe('blink');
    expect(e.frame(idle, 4.2)).toBe('neutral');
  });

  it('alternates walk frames while walking', () => {
    const e = new Expressions(all, rngHalf, 0);
    const walk = { ...idle, state: 'walk' as const };
    expect(e.frame(walk, 0.1)).toBe('walk1');
    expect(e.frame(walk, 0.3)).toBe('walk2');
  });

  it('laughs when clicked, gets grumpy when spammed', () => {
    const e = new Expressions(all, () => 0, 0);
    e.react('click', 1);
    expect(e.frame(idle, 1.1)).toBe('laugh');
    for (let i = 0; i < 5; i++) e.react('click', 2 + i * 0.2);
    expect(e.frame(idle, 3)).toBe('grumpy');
    expect(e.frame(idle, 6)).not.toBe('grumpy');
  });

  it('shows love or a blush on hover', () => {
    const e = new Expressions(all, rngHalf, 0);
    e.react('hover', 0);
    expect(['love', 'blush']).toContain(e.frame(idle, 0.5));
  });

  it('is dizzy after being shaken', () => {
    const e = new Expressions(all, rngHalf, 0);
    e.react('shake', 0);
    expect(e.frame({ ...idle, state: 'drag' }, 0.5)).toBe('dizzy');
  });

  it('sleeps, is sleepy late at night, and gets lonely when ignored', () => {
    const e = new Expressions(all, rngHalf, 0);
    expect(e.frame({ ...idle, state: 'sleep' }, 1)).toBe('asleep');
    expect(e.frame({ ...idle, sleepy: true }, 1)).toBe('sleepy');
    const lonely = e.frame({ ...idle, sinceInteraction: 3600 }, 7);
    expect(['sad', 'wave', 'blink']).toContain(lonely);
  });

  it('falls back to neutral when a frame failed to generate', () => {
    const e = new Expressions(new Set(['neutral']), rngHalf, 0);
    e.react('click', 0);
    expect(e.frame({ ...idle, state: 'celebrate' }, 0.5)).toBe('neutral');
    expect(e.frame({ ...idle, state: 'sleep' }, 0.5)).toBe('neutral');
  });
});
