import { useEffect, useRef, useState } from 'react';
import { isFinished } from '../lib/format.js';

const POLL_MS = 1000;
const MAX_BACKOFF_MS = 10000;
const PAGE_SIZE = 500;

const initialState = { workout: null, readings: [], loading: true, disconnected: false, error: null, live: false };

// Polls one workout and its readings about once per second.
// - One awaited loop: the next request starts only after the previous cycle ends.
// - Readings are fetched from the stored offset, which advances by the number
//   actually received, and are de-duplicated by sequence.
// - Polling stops after the first snapshot that shows a finished workout; the
//   readings fetched after that snapshot include the final sample.
// - Changing workout or unmounting aborts in-flight requests and clears timers.
export function useLiveWorkout(api, workoutId, onFinished) {
  const [state, setState] = useState(initialState);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    setState(initialState);
    if (!workoutId) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    const bySequence = new Map();
    let offset = 0;
    let stopped = false;
    let timer;
    let failures = 0;
    let sawUnfinished = false;
    const wait = ms => new Promise(resolve => { timer = setTimeout(resolve, ms); });

    async function cycle() {
      const { workout } = await api(`/api/workouts/${workoutId}`, { signal });
      for (;;) {
        const page = await api(`/api/workouts/${workoutId}/readings`, { query: { limit: PAGE_SIZE, offset }, signal });
        for (const reading of page.readings) bySequence.set(reading.sequence, reading);
        offset += page.readings.length;
        if (page.readings.length === 0 || offset >= page.total) break;
      }
      return workout;
    }

    (async () => {
      while (!stopped) {
        try {
          const workout = await cycle();
          if (stopped) return;
          failures = 0;
          const finished = isFinished(workout.status);
          const readings = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
          setState({ workout, readings, loading: false, disconnected: false, error: null, live: !finished });
          if (finished) {
            if (sawUnfinished) onFinishedRef.current?.(workout);
            return;
          }
          sawUnfinished = true;
          await wait(POLL_MS);
        } catch (error) {
          if (stopped || error?.name === 'AbortError') return;
          const retryable = error?.status === 0 || error?.status === 429 || error?.status >= 500;
          if (!retryable) {
            // 401 is handled by the account layer; 403/404 mean access ended.
            setState(previous => ({ ...previous, loading: false, error, live: false }));
            return;
          }
          failures += 1;
          // Keep the last known values on screen; only flag the connection.
          setState(previous => ({ ...previous, loading: false, disconnected: true, error }));
          await wait(Math.min(POLL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS));
        }
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, workoutId]);

  return state;
}
