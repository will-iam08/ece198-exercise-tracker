// CSV download of workout sessions, one row per exercise.
import { bpmLabel, statusLabel } from './exerciseStatus.js';

const CRLF = '\r\n';

// Spreadsheet apps run a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString()) : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function quote(text) {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ key, label }], where key is a field name or row => value.
export function toCsv(columns, rows) {
  const cols = Array.isArray(columns) ? columns : [];
  const read = (row, key) => (typeof key === 'function' ? key(row) : row?.[key]);
  const line = values => values.map(value => quote(cellText(value))).join(',');
  const lines = [line(cols.map(col => col.label ?? (typeof col.key === 'string' ? col.key : '')))];
  for (const row of Array.isArray(rows) ? rows : []) lines.push(line(cols.map(col => read(row, col.key))));
  return lines.join(CRLF) + CRLF;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const bpm = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Why a heart rate is missing ("Skipped", "No reading", "Waiting"); empty when
// there is a number.
const readingNote = (workout, which) => (bpm(workout[`${which}_bpm`]) === null ? bpmLabel(workout, which) : '');

const SESSION_STATUS = { active: 'In progress', ended: 'Ended' };

export function sessionsToRows(sessions) {
  const rows = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const base = {
      session_at: iso(session.created_at),
      session_status: SESSION_STATUS[session.status] ?? session.status ?? null,
    };
    const workouts = Array.isArray(session.workouts) ? session.workouts : [];
    if (workouts.length === 0) {
      rows.push({
        ...base, exercise: null, target_reps: null, repetitions: null, before_bpm: null, before_note: null,
        after_bpm: null, after_note: null, status: null, started_at: null, ended_at: null,
      });
      continue;
    }
    for (const workout of workouts) {
      rows.push({
        ...base,
        exercise: workout.exercise_name ?? null,
        target_reps: workout.target_reps ?? null,
        repetitions: workout.repetitions ?? null,
        before_bpm: bpm(workout.before_bpm),
        before_note: readingNote(workout, 'before'),
        after_bpm: bpm(workout.after_bpm),
        after_note: readingNote(workout, 'after'),
        status: workout.status ? statusLabel(workout) : null,
        started_at: iso(workout.started_at),
        ended_at: iso(workout.ended_at),
      });
    }
  }
  return rows;
}

export const SESSION_CSV_COLUMNS = [
  { key: 'session_at', label: 'Session started' },
  { key: 'session_status', label: 'Session status' },
  { key: 'exercise', label: 'Exercise' },
  { key: 'target_reps', label: 'Target reps' },
  { key: 'repetitions', label: 'Reps done' },
  { key: 'before_bpm', label: 'Heart rate before (bpm)' },
  { key: 'before_note', label: 'Heart rate before note' },
  { key: 'after_bpm', label: 'Heart rate after (bpm)' },
  { key: 'after_note', label: 'Heart rate after note' },
  { key: 'status', label: 'Exercise status' },
  { key: 'started_at', label: 'Exercise started' },
  { key: 'ended_at', label: 'Exercise ended' },
];

// ("MotionTrack sessions", 19 Nov 2026) -> "motiontrack-sessions-2026-11-19.csv",
// using the local calendar date.
export function csvFilename(prefix, date = new Date()) {
  const slug = String(prefix ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export';
  const day = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${slug}-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.csv`;
}

// The BOM makes Excel read the file as UTF-8. Does nothing outside a browser.
export function downloadCsv(filename, csv) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
