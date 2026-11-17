import { useState } from 'react';
import { useWidth } from '../hooks/useWidth.js';
import { formatClock, formatDurationWords } from '../lib/format.js';

function niceStep(range, targetTicks, steps) {
  const rough = range / targetTicks;
  return steps.find(step => step >= rough) ?? steps[steps.length - 1];
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 1000000];

function Tooltip({ x, y, width, lines }) {
  const boxWidth = Math.max(...lines.map(line => line.length)) * 8.4 + 20;
  const boxHeight = lines.length * 20 + 12;
  const left = Math.min(Math.max(x - boxWidth / 2, 2), width - boxWidth - 2);
  const top = Math.max(y - boxHeight - 12, 2);
  return (
    <g pointerEvents="none">
      <rect className="chart-tip-box" x={left} y={top} width={boxWidth} height={boxHeight} rx="6" />
      {lines.map((line, index) => (
        <text key={line} className={index === 0 ? 'chart-tip-strong' : 'chart-tip-text'} x={left + 10} y={top + 22 + index * 20}>{line}</text>
      ))}
    </g>
  );
}

// Heart rate against the device's own elapsed time. Samples without a heart
// rate break the line; nothing is drawn across the gap.
export function HeartRateChart({ readings }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const points = readings.filter(reading => reading.heart_rate_bpm != null);
  const missing = readings.length - points.length;

  if (points.length === 0) {
    return (
      <p className="empty" ref={ref}>
        {readings.length === 0 ? 'No readings have been received for this workout yet.' : 'No heart-rate readings were recorded for this workout.'}
      </p>
    );
  }

  const height = 280;
  const margin = { top: 16, right: 20, bottom: 48, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const maxX = Math.max(1, readings[readings.length - 1].elapsed_seconds);
  const values = points.map(point => point.heart_rate_bpm);
  const yStep = niceStep(Math.max(20, Math.max(...values) - Math.min(...values)), 4, [5, 10, 20, 25, 50, 100]);
  const yMin = Math.max(0, Math.floor((Math.min(...values) - 5) / yStep) * yStep);
  const yMax = Math.max(yMin + yStep, Math.ceil((Math.max(...values) + 5) / yStep) * yStep);
  const x = seconds => margin.left + (seconds / maxX) * plotW;
  const y = bpm => margin.top + plotH - ((bpm - yMin) / (yMax - yMin)) * plotH;

  // Consecutive non-null samples form one line segment.
  const segments = [];
  let current = [];
  for (const reading of readings) {
    if (reading.heart_rate_bpm == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(reading);
  }
  if (current.length) segments.push(current);

  const xStep = niceStep(maxX, Math.max(2, Math.floor(plotW / 90)), TIME_STEPS);
  const xTicks = [];
  for (let tick = 0; tick <= maxX; tick += xStep) xTicks.push(tick);
  const yTicks = [];
  for (let tick = yMin; tick <= yMax; tick += yStep) yTicks.push(tick);
  const showDots = points.length <= 40;

  function onMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    let nearest = points[0];
    for (const point of points) {
      if (Math.abs(x(point.elapsed_seconds) - pointerX) < Math.abs(x(nearest.elapsed_seconds) - pointerX)) nearest = point;
    }
    setHover(nearest);
  }

  const summary = `Heart rate chart. ${points.length} readings from ${Math.min(...values)} to ${Math.max(...values)} beats per minute`
    + `${missing ? `, with ${missing} samples that had no heart-rate reading` : ''}. The full values are in the table below.`;

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={summary} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map(tick => (
          <g key={tick}>
            <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={margin.left - 8} y={y(tick) + 5} textAnchor="end">{tick}</text>
          </g>
        ))}
        {xTicks.map(tick => (
          <text key={tick} className="chart-tick" x={x(tick)} y={height - margin.bottom + 20} textAnchor="middle">{formatClock(tick)}</text>
        ))}
        <text className="chart-axis-label" x={margin.left + plotW / 2} y={height - 6} textAnchor="middle">Workout time (minutes:seconds)</text>
        <text className="chart-axis-label" x={14} y={margin.top + plotH / 2} textAnchor="middle" transform={`rotate(-90 14 ${margin.top + plotH / 2})`}>Beats per minute</text>
        {segments.filter(segment => segment.length > 1).map(segment => (
          <polyline
            key={segment[0].sequence}
            className="chart-line"
            points={segment.map(point => `${x(point.elapsed_seconds)},${y(point.heart_rate_bpm)}`).join(' ')}
          />
        ))}
        {points.map((point, index) => {
          // Always mark isolated samples, which have no line to show them.
          const isolated = readings[readings.indexOf(point) - 1]?.heart_rate_bpm == null && readings[readings.indexOf(point) + 1]?.heart_rate_bpm == null;
          if (!showDots && !isolated && index !== points.length - 1) return null;
          return <circle key={point.sequence} className="chart-dot" cx={x(point.elapsed_seconds)} cy={y(point.heart_rate_bpm)} r="4.5" />;
        })}
        {hover && (
          <>
            <line className="chart-crosshair" x1={x(hover.elapsed_seconds)} x2={x(hover.elapsed_seconds)} y1={margin.top} y2={margin.top + plotH} />
            <circle className="chart-dot" cx={x(hover.elapsed_seconds)} cy={y(hover.heart_rate_bpm)} r="6" />
            <Tooltip x={x(hover.elapsed_seconds)} y={y(hover.heart_rate_bpm)} width={width} lines={[`${hover.heart_rate_bpm} bpm`, `at ${formatClock(hover.elapsed_seconds)}`]} />
          </>
        )}
      </svg>
      {missing > 0 && (
        <p className="hint">
          {missing} of {readings.length} samples had no heart-rate reading. Those moments are left blank; no values are filled in.
        </p>
      )}
    </div>
  );
}

function metricValue(metric, value) {
  return metric === 'duration_seconds' ? formatDurationWords(value) : String(value);
}

// One bar per day (or month) for the chosen progress measure.
export function ProgressBarChart({ buckets, metric, metricLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const height = 280;
  const margin = { top: 28, right: 12, bottom: 36, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  // Time is charted in minutes so the axis has clean numbers.
  const scaled = buckets.map(bucket => (metric === 'duration_seconds' ? bucket[metric] / 60 : bucket[metric]));
  const max = Math.max(1, ...scaled);
  const step = niceStep(max, 4, metric === 'duration_seconds' ? [0.5, ...COUNT_STEPS] : COUNT_STEPS);
  const top = Math.ceil(max / step) * step;
  const band = plotW / buckets.length;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = value => margin.top + plotH - (value / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 70))));
  const ticks = [];
  for (let tick = 0; tick <= top + step / 1000; tick += step) ticks.push(tick);
  const peak = scaled.indexOf(Math.max(...scaled));
  const unit = metric === 'duration_seconds' ? 'Minutes' : metricLabel;

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={`Bar chart of ${metricLabel.toLowerCase()} over time. The same numbers are in the table below.`} onPointerLeave={() => setHover(null)}>
        <text className="chart-axis-label" x={margin.left} y={14}>{unit}</text>
        {ticks.map(tick => (
          <g key={tick}>
            <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={margin.left - 8} y={y(tick) + 5} textAnchor="end">{tick}</text>
          </g>
        ))}
        {buckets.map((bucket, index) => {
          const value = scaled[index];
          const cx = margin.left + band * index + band / 2;
          const barH = (value / top) * plotH;
          const radius = Math.min(4, barW / 2, barH);
          const left = cx - barW / 2;
          const bottom = margin.top + plotH;
          return (
            <g key={bucket.key} onPointerEnter={() => setHover(index)}>
              <rect x={margin.left + band * index} y={margin.top} width={band} height={plotH} fill="transparent" />
              {value > 0 && (
                <path
                  className={hover === index ? 'chart-bar chart-bar-hover' : 'chart-bar'}
                  d={`M${left},${bottom} V${bottom - barH + radius} Q${left},${bottom - barH} ${left + radius},${bottom - barH} H${left + barW - radius} Q${left + barW},${bottom - barH} ${left + barW},${bottom - barH + radius} V${bottom} Z`}
                />
              )}
              {index === peak && value > 0 && hover === null && (
                <text className="chart-value" x={Math.min(Math.max(cx, margin.left + 30), width - 40)} y={bottom - barH - 6} textAnchor="middle">{metricValue(metric, bucket[metric])}</text>
              )}
              {index % labelEvery === 0 && (
                <text className="chart-tick" x={cx} y={height - margin.bottom + 22} textAnchor="middle">{bucket.label}</text>
              )}
            </g>
          );
        })}
        <line className="chart-axis" x1={margin.left} x2={width - margin.right} y1={margin.top + plotH} y2={margin.top + plotH} />
        {hover !== null && (
          <Tooltip
            x={margin.left + band * hover + band / 2}
            y={y(scaled[hover])}
            width={width}
            lines={[buckets[hover].label, `${metricLabel}: ${metricValue(metric, buckets[hover][metric])}`]}
          />
        )}
      </svg>
    </div>
  );
}
