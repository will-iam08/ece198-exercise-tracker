import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { buildBuckets, filterDaily, METRICS, RANGES, sumRows } from '../lib/progress.js';
import { ProgressBarChart } from './Charts.jsx';
import { ErrorMessage, Loading, ScreenHeading } from './common.jsx';

const EXERCISE_NAMES = ['Arm Curl', 'Shoulder Press', 'Back Row'];

// Completed rep exercises and repetitions per day (or month), over a
// selectable range and for one exercise or all.
export function RepProgress({ refreshKey }) {
  const { api } = useAuth();
  const [exercise, setExercise] = useState('');
  const [range, setRange] = useState('30');
  const [metric, setMetric] = useState('workouts');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api('/api/progress', { query: { kind: 'reps', exercise_name: exercise }, signal: controller.signal })
      .then(setData)
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setError(failure);
      });
    return () => controller.abort();
  }, [api, exercise, refreshKey, attempt]);

  const days = RANGES.find(option => option.value === range).days;
  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const rows = filterDaily(data.daily, days, now);
    const totals = days ? sumRows(rows) : { workouts: data.completed_workouts, repetitions: data.total_repetitions };
    return { rows: [...rows].reverse(), totals, ...buildBuckets(data.daily, days, now) };
  }, [data, days]);

  const metricLabel = METRICS.find(option => option.value === metric).label;
  const rangeLabel = RANGES.find(option => option.value === range).label.toLowerCase();

  return (
    <section aria-labelledby="progress-heading">
      <div id="progress-heading"><ScreenHeading>My progress</ScreenHeading></div>
      <p>Progress counts complete exercises only: all target reps done, with heart rate taken before and after. Incomplete exercises are not included.</p>
      <div className="filters">
        <div className="field">
          <label htmlFor="progress-range">Time range</label>
          <select id="progress-range" value={range} onChange={e => setRange(e.target.value)}>
            {RANGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="progress-exercise">Exercise</label>
          <select id="progress-exercise" value={exercise} onChange={e => { setExercise(e.target.value); setData(null); }}>
            <option value="">All exercises</option>
            {EXERCISE_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="progress-metric">Show on chart</label>
          <select id="progress-metric" value={metric} onChange={e => setMetric(e.target.value)}>
            {METRICS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorMessage error={error} onRetry={() => setAttempt(n => n + 1)} />}
      {!view && !error && <Loading label="Loading progress…" />}
      {view && (
        <>
          <div className="tiles" role="group" aria-label={`Totals for ${rangeLabel}`}>
            <div className="tile"><p className="tile-label">Completed exercises</p><p className="tile-value">{view.totals.workouts}</p></div>
            <div className="tile"><p className="tile-label">Total repetitions</p><p className="tile-value">{view.totals.repetitions}</p></div>
          </div>
          {view.totals.workouts === 0 ? (
            <p className="empty">No completed exercises in this time range{exercise ? ` for ${exercise}` : ''} yet.</p>
          ) : (
            <>
              <h3>{metricLabel} per {view.monthly ? 'month' : 'day'}, {rangeLabel}</h3>
              <ProgressBarChart buckets={view.buckets} metric={metric} metricLabel={metricLabel} />
              <p className="hint">Days are counted in UTC (Coordinated Universal Time), so an exercise late in the evening may appear under the next day.</p>
              <details className="details">
                <summary>Show these numbers as a table</summary>
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Progress table">
                  <table>
                    <thead>
                      <tr><th scope="col">Date (UTC)</th><th scope="col">Exercise</th><th scope="col">Completed exercises</th><th scope="col">Repetitions</th></tr>
                    </thead>
                    <tbody>
                      {view.rows.map(row => (
                        <tr key={`${row.date}-${row.exercise_name}`}>
                          <td>{row.date}</td><td>{row.exercise_name}</td><td>{row.workouts}</td><td>{row.repetitions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
