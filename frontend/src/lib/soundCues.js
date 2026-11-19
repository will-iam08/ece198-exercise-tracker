// Optional sound cues during a rep exercise, made with Web Audio (no files).

const PHASE_ORDER = { before_bpm: 0, counting: 1, after_bpm: 2, done: 3 };
const rank = phase => PHASE_ORDER[phase] ?? -1;

// The cues to play when the exercise changes from `previous` to `next`, in
// order. The first snapshot is silent so opening the page never beeps.
export function cueEvents(previous, next) {
  if (!previous || !next || previous.id !== next.id) return [];
  const cues = [];
  const before = rank(previous.phase);
  const after = rank(next.phase);
  if (before === PHASE_ORDER.before_bpm && after > before) cues.push('reading-done');
  if (next.phase === 'counting' && Number(next.repetitions) > Number(previous.repetitions)) cues.push('rep');
  if (next.phase === 'after_bpm' && before < PHASE_ORDER.after_bpm) cues.push('target-reached');
  const finished = (next.phase === 'done' && previous.phase !== 'done')
    || (next.status === 'completed' && previous.status !== 'completed');
  if (finished) cues.push('complete');
  return cues;
}

// Notes per cue: frequency (Hz), start offset and length (s), peak gain.
const C5 = 523.25;
const E5 = 659.25;
const G4 = 392;
const B4 = 493.88;
const B5 = 987.77;
const A5 = 880;

export const CUE_NOTES = {
  rep: [{ frequency: A5, at: 0, length: 0.07, peak: 0.04, type: 'sine' }],
  'reading-done': [
    { frequency: C5, at: 0, length: 0.16, peak: 0.07, type: 'sine' },
    { frequency: E5, at: 0.13, length: 0.22, peak: 0.07, type: 'sine' },
  ],
  'target-reached': [
    { frequency: E5, at: 0, length: 0.16, peak: 0.08, type: 'triangle' },
    { frequency: B5, at: 0.13, length: 0.26, peak: 0.07, type: 'triangle' },
  ],
  complete: [
    { frequency: G4, at: 0, length: 0.2, peak: 0.07, type: 'sine' },
    { frequency: B4, at: 0.16, length: 0.2, peak: 0.07, type: 'sine' },
    { frequency: C5, at: 0.32, length: 0.45, peak: 0.08, type: 'sine' },
  ],
};

const ATTACK = 0.012;
const SILENT = 0.0001;

export function createChimePlayer({ AudioContextImpl } = {}) {
  let context = null;
  let unavailable = false;

  function getContext() {
    if (context || unavailable) return context;
    try {
      const Impl = AudioContextImpl ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Impl) {
        unavailable = true;
        return null;
      }
      context = new Impl();
    } catch {
      unavailable = true;
      context = null;
    }
    return context;
  }

  function play(cue) {
    const notes = CUE_NOTES[cue];
    if (!notes) return false;
    const ctx = getContext();
    if (!ctx) return false;
    try {
      // Browsers start a context suspended until the page has had a click.
      if (ctx.state === 'suspended') Promise.resolve(ctx.resume?.()).catch(() => {});
      const now = ctx.currentTime ?? 0;
      for (const note of notes) {
        const start = now + note.at;
        const end = start + note.length;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.frequency, start);
        // Ramps from and back to near silence avoid audible clicks.
        gain.gain.setValueAtTime(SILENT, start);
        gain.gain.linearRampToValueAtTime(note.peak, start + ATTACK);
        gain.gain.exponentialRampToValueAtTime(SILENT, end);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
      }
      return true;
    } catch {
      return false;
    }
  }

  function close() {
    const ctx = context;
    context = null;
    if (!ctx) return;
    try {
      Promise.resolve(ctx.close?.()).catch(() => {});
    } catch {
      // Already closed.
    }
  }

  return { play, close };
}
