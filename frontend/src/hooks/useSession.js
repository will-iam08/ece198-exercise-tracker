import { useCallback, useEffect, useRef, useState } from 'react';
import { isOpen } from '../lib/exerciseStatus.js';

const POLL_MS = 1000;
const MAX_BACKOFF_MS = 10000;

const initialState = { session: null, serverTime: null, loading: true, disconnected: false, error: null };

// Loads one workout session with its exercises.
// - One awaited loop: the next request starts only after the previous one ends.
// - With `live`, it polls about once a second while any exercise is unfinished
//   and stops once none is; `reload()` starts it again (for example after
//   starting an exercise). Without `live` it loads once.
// - Network and server errors back off 1, 2, 4, 8, then 10 seconds, keeping
//   the last data on screen.
// - Changing session or unmounting aborts the request in flight.
// `reload(nextSession)` can show a session returned by an action right away,
// before the next request finishes.
export function useSession(api, sessionId, { live = false } = {}) {
  const [state, setState] = useState(initialState);
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);
  const shownId = useRef(null);

  const reload = useCallback(nextSession => {
    generation.current += 1;
    if (nextSession) setState(previous => ({ ...previous, session: nextSession, loading: false, error: null }));
    setReloadKey(key => key + 1);
  }, []);

  useEffect(() => {
    if (shownId.current !== sessionId) {
      shownId.current = sessionId;
      setState(initialState);
    }
    if (!sessionId) return undefined;

    generation.current += 1;
    const mine = generation.current;
    const controller = new AbortController();
    let stopped = false;
    let timer;
    let failures = 0;
    const current = () => !stopped && generation.current === mine;
    const wait = ms => new Promise(resolve => { timer = setTimeout(resolve, ms); });

    (async () => {
      while (current()) {
        try {
          const data = await api(`/api/sessions/${sessionId}`, { signal: controller.signal });
          if (!current()) return;
          failures = 0;
          setState({ session: data.session, serverTime: data.server_time, loading: false, disconnected: false, error: null });
          if (!live || !data.session.workouts.some(isOpen)) return;
          await wait(POLL_MS);
        } catch (error) {
          if (!current() || error?.name === 'AbortError') return;
          const retryable = error?.status === 0 || error?.status === 429 || error?.status >= 500;
          if (!retryable) {
            // 401 is handled by the account layer; 403/404 mean access ended.
            setState(previous => ({ ...previous, loading: false, disconnected: false, error }));
            return;
          }
          failures += 1;
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
  }, [api, sessionId, live, reloadKey]);

  return { ...state, reload };
}
