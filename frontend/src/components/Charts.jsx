import { useState } from 'react';
import { useWidth } from '../hooks/useWidth.js';
import { formatDurationWords } from '../lib/format.js';

function niceStep(range, targetTicks, steps) {
  const rough = range / targetTicks;
  return steps.find(step => step >= rough) ?? steps[steps.length - 1];
}

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
