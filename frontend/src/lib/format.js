export const PRESET_EXERCISES = ['Bicep curls', 'Squats', 'Arm raises'];
export const MAX_DURATION_SECONDS = 86400;

// 75 -> "1:15", 3725 -> "1:02:05"
export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// 75 -> "1 min 15 sec", 3720 -> "1 hr 2 min"
export function formatDurationWords(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
  if (m > 0) return s > 0 ? `${m} min ${s} sec` : `${m} min`;
  return `${s} sec`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

// "4 seconds ago", "3 minutes ago"
export function formatAge(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

// Planned minutes typed by the participant -> whole seconds for the API.
export function minutesToSeconds(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter the planned time in minutes, for example 10.' };
  const seconds = Math.round(Number(text) * 60);
  if (seconds < 1) return { error: 'The planned time must be longer than zero.' };
  if (seconds > MAX_DURATION_SECONDS) return { error: 'The planned time cannot be more than 1440 minutes (24 hours).' };
  return { seconds };
}

export const STATUS_LABELS = {
  pending: 'Ready to start',
  active: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function isFinished(status) {
  return status === 'completed' || status === 'cancelled';
}
