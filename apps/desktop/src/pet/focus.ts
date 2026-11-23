/** Pomodoro-style focus timer. Pure: the caller passes time in and reacts to the returned event. */
export type FocusPhase = 'idle' | 'focus' | 'break';
export type FocusEvent = 'focusDone' | 'breakDone' | null;

export class FocusTimer {
  phase: FocusPhase = 'idle';
  endsAt = 0;

  startFocus(now: number, minutes: number) {
    this.phase = 'focus';
    this.endsAt = now + minutes * 60_000;
  }

  startBreak(now: number, minutes: number) {
    this.phase = 'break';
    this.endsAt = now + minutes * 60_000;
  }

  stop() {
    this.phase = 'idle';
  }

  tick(now: number): FocusEvent {
    if (this.phase === 'idle' || now < this.endsAt) return null;
    const ev: FocusEvent = this.phase === 'focus' ? 'focusDone' : 'breakDone';
    this.phase = 'idle';
    return ev;
  }

  /** "mm:ss" remaining. */
  remaining(now: number): string {
    const s = Math.max(0, Math.ceil((this.endsAt - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
