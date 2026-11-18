import { useEffect, useState } from 'react';

const REFRESH_MS = 5000;

// One page of a list, refreshed every 5 seconds with an awaited loop.
// Stops on errors that will not fix themselves; aborts on change or unmount.
// Returns { data, error, page, setPage, retry }.
export function usePagedList(api, path, query, pageSize, refreshKey) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    (async () => {
      while (!stopped) {
        try {
          const result = await api(path, {
            query: { ...JSON.parse(queryKey), limit: pageSize, offset: page * pageSize },
            signal: controller.signal,
          });
          if (stopped) return;
          const items = result.sessions ?? result.workouts;
          if (items.length === 0 && result.total > 0) {
            // The page emptied (for example after deletions); go to the last page.
            setPage(Math.max(0, Math.ceil(result.total / pageSize) - 1));
            return;
          }
          setData(result);
          setError(null);
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setError(failure);
          if (failure.status !== 0 && failure.status !== 429 && failure.status < 500) return;
        }
        await new Promise(resolve => { timer = setTimeout(resolve, REFRESH_MS); });
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, path, queryKey, pageSize, page, refreshKey, attempt]);

  return { data, error, page, setPage, retry: () => setAttempt(n => n + 1) };
}
