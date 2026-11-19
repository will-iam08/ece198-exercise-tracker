import { describe, expect, it } from 'vitest';
import { createChimePlayer, CUE_NOTES, cueEvents } from './soundCues.js';

const snap = fields => ({ id: 'w1', phase: 'counting', repetitions: 3, status: 'active', ...fields });

describe('cueEvents', () => {
  it('is silent on the first snapshot, for another exercise, and when nothing changed', () => {
    expect(cueEvents(null, snap())).toEqual([]);
    expect(cueEvents(undefined, snap())).toEqual([]);
    expect(cueEvents(snap(), null)).toEqual([]);
    expect(cueEvents(snap(), snap({ id: 'w2', repetitions: 4 }))).toEqual([]);
    expect(cueEvents(snap(), snap())).toEqual([]);
  });

  it('cues the end of the first reading', () => {
    expect(cueEvents(snap({ phase: 'before_bpm', repetitions: 0 }), snap({ repetitions: 0 }))).toEqual(['reading-done']);
  });

  it('cues one rep per change while counting', () => {
    expect(cueEvents(snap(), snap({ repetitions: 4 }))).toEqual(['rep']);
    expect(cueEvents(snap(), snap({ repetitions: 7 }))).toEqual(['rep']);
    expect(cueEvents(snap(), snap({ repetitions: 2 }))).toEqual([]);
  });

  it('cues reaching the target and finishing', () => {
    expect(cueEvents(snap({ repetitions: 9 }), snap({ repetitions: 10, phase: 'after_bpm' }))).toEqual(['target-reached']);
    expect(cueEvents(snap({ phase: 'after_bpm' }), snap({ phase: 'done', status: 'completed' }))).toEqual(['complete']);
    expect(cueEvents(snap({ phase: 'done', status: 'active' }), snap({ phase: 'done', status: 'completed' }))).toEqual(['complete']);
    expect(cueEvents(snap({ phase: 'done', status: 'completed' }), snap({ phase: 'done', status: 'completed' }))).toEqual([]);
  });

  it('gives every phase cue in order when steps are skipped or missed', () => {
    expect(cueEvents(snap({ phase: 'before_bpm', repetitions: 0 }), snap({ phase: 'counting', repetitions: 1 })))
      .toEqual(['reading-done', 'rep']);
    expect(cueEvents(snap({ phase: 'before_bpm', repetitions: 0 }), snap({ phase: 'after_bpm', repetitions: 10 })))
      .toEqual(['reading-done', 'target-reached']);
    expect(cueEvents(snap({ phase: 'before_bpm' }), snap({ phase: 'done', status: 'completed' })))
      .toEqual(['reading-done', 'complete']);
    expect(cueEvents(snap(), snap({ phase: 'done', status: 'incomplete' }))).toEqual(['complete']);
  });
});

function fakeAudio() {
  const log = { contexts: 0, oscillators: [], closed: 0, resumed: 0 };
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeContext {
    constructor() {
      log.contexts += 1;
      this.currentTime = 1;
      this.state = 'suspended';
      this.destination = {};
    }
    createOscillator() {
      const osc = { frequencies: [], started: null, stopped: null, connect() {} };
      osc.frequency = { setValueAtTime: value => osc.frequencies.push(value) };
      osc.start = at => { osc.started = at; };
      osc.stop = at => { osc.stopped = at; };
      log.oscillators.push(osc);
      return osc;
    }
    createGain() {
      return { gain: param(), connect() {} };
    }
    resume() {
      log.resumed += 1;
      return Promise.resolve();
    }
    close() {
      log.closed += 1;
      return Promise.resolve();
    }
  }
  return { log, FakeContext };
}

describe('createChimePlayer', () => {
  it('creates the context lazily and schedules one tone per note', () => {
    const { log, FakeContext } = fakeAudio();
    const player = createChimePlayer({ AudioContextImpl: FakeContext });
    expect(log.contexts).toBe(0);
    expect(player.play('complete')).toBe(true);
    expect(log.contexts).toBe(1);
    expect(log.resumed).toBe(1);
    expect(log.oscillators.map(osc => osc.frequencies[0])).toEqual(CUE_NOTES.complete.map(note => note.frequency));
    for (const osc of log.oscillators) {
      expect(osc.started).toBeGreaterThanOrEqual(1);
      expect(osc.stopped).toBeGreaterThan(osc.started);
    }
    player.play('rep');
    expect(log.contexts).toBe(1);
    expect(log.oscillators).toHaveLength(4);
    player.close();
    expect(log.closed).toBe(1);
  });

  it('uses a different sound for each cue', () => {
    const signature = cue => CUE_NOTES[cue].map(note => note.frequency).join(',');
    const cues = ['rep', 'reading-done', 'target-reached', 'complete'];
    expect(new Set(cues.map(signature)).size).toBe(cues.length);
    for (const cue of cues) {
      for (const note of CUE_NOTES[cue]) expect(note.peak).toBeLessThanOrEqual(0.1);
    }
  });

  it('ignores unknown cues', () => {
    const { log, FakeContext } = fakeAudio();
    const player = createChimePlayer({ AudioContextImpl: FakeContext });
    expect(player.play('fanfare')).toBe(false);
    expect(log.contexts).toBe(0);
  });

  it('is silent without Web Audio', () => {
    const player = createChimePlayer();
    expect(globalThis.AudioContext).toBeUndefined();
    expect(player.play('rep')).toBe(false);
    expect(() => player.close()).not.toThrow();
  });

  it('is silent when the context cannot be created', () => {
    let attempts = 0;
    class Broken {
      constructor() {
        attempts += 1;
        throw new Error('not allowed');
      }
    }
    const player = createChimePlayer({ AudioContextImpl: Broken });
    expect(player.play('rep')).toBe(false);
    expect(player.play('complete')).toBe(false);
    expect(attempts).toBe(1);
  });
});
