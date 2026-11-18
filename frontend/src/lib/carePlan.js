// The care plan a doctor sets for a patient, and how an exercise compares
// with it. Every result is written out in words; colour is only extra.

export const REP_FIELDS = {
  arm_curl: 'arm_curl_reps',
  shoulder_press: 'shoulder_press_reps',
  back_row: 'back_row_reps',
};

export const EXERCISE_NAMES = { arm_curl: 'Arm Curl', shoulder_press: 'Shoulder Press', back_row: 'Back Row' };

export const REPS_MIN = 1;
export const REPS_MAX = 50;
export const BPM_MIN = 30;
export const BPM_MAX = 220;
export const NOTES_MAX = 1000;

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

// Prescribed reps for one exercise, or null.
export function prescribedReps(plan, exerciseId) {
  const value = plan?.[REP_FIELDS[exerciseId]];
  return isNumber(value) ? value : null;
}

export function hasBpmTarget(plan) {
  return isNumber(plan?.target_bpm_min) || isNumber(plan?.target_bpm_max);
}

export function hasTargets(plan) {
  return Object.keys(REP_FIELDS).some(id => prescribedReps(plan, id) !== null) || hasBpmTarget(plan);
}

// Whether there is anything to show the patient.
export function hasPlan(plan) {
  return Boolean(plan && (plan.notes?.trim() || hasTargets(plan)));
}

// "60–120 bpm", "at least 60 bpm", "at most 120 bpm", or null.
export function bpmRangeLabel(plan) {
  const min = isNumber(plan?.target_bpm_min) ? plan.target_bpm_min : null;
  const max = isNumber(plan?.target_bpm_max) ? plan.target_bpm_max : null;
  if (min !== null && max !== null) return `${min}–${max} bpm`;
  if (min !== null) return `at least ${min} bpm`;
  if (max !== null) return `at most ${max} bpm`;
  return null;
}

const isOpen = workout => workout?.status === 'pending' || workout?.status === 'active';

// Reps done compared with the prescribed count. The label is read after the
// badge word ("Met", "Below", "Not yet").
// -> null (no prescription) | { state: 'met' | 'below' | 'pending', label }
export function repsCheck(workout, plan) {
  const target = prescribedReps(plan, workout?.exercise_id);
  if (target === null) return null;
  const done = workout.repetitions ?? 0;
  const label = `${done} of ${target} prescribed reps`;
  if (done >= target) return { state: 'met', label };
  if (isOpen(workout)) return { state: 'pending', label: `${label} so far` };
  return { state: 'below', label };
}

// The after-exercise heart rate compared with the target range.
// -> null (no range) | { state: 'in' | 'above' | 'below' | 'none' | 'pending', label }
export function bpmCheck(workout, plan) {
  if (!hasBpmTarget(plan)) return null;
  const range = bpmRangeLabel(plan);
  const bpm = workout?.after_bpm;
  if (!isNumber(bpm)) return { state: isOpen(workout) ? 'pending' : 'none', label: `target ${range}` };
  const label = `${bpm} bpm, target ${range}`;
  if (isNumber(plan.target_bpm_max) && bpm > plan.target_bpm_max) return { state: 'above', label };
  if (isNumber(plan.target_bpm_min) && bpm < plan.target_bpm_min) return { state: 'below', label };
  return { state: 'in', label };
}

// A saved plan -> the text in each form field.
export function planFormValues(plan) {
  const text = value => (isNumber(value) ? String(value) : '');
  return {
    notes: plan?.notes ?? '',
    arm_curl_reps: text(plan?.arm_curl_reps),
    shoulder_press_reps: text(plan?.shoulder_press_reps),
    back_row_reps: text(plan?.back_row_reps),
    target_bpm_min: text(plan?.target_bpm_min),
    target_bpm_max: text(plan?.target_bpm_max),
  };
}

function optionalWhole(text, min, max, label) {
  const value = String(text ?? '').trim();
  if (value === '') return { value: null };
  if (!/^\d+$/.test(value)) return { error: `${label} must be a whole number from ${min} to ${max}, or left empty.` };
  const number = Number(value);
  if (number < min || number > max) return { error: `${label} must be from ${min} to ${max}.` };
  return { value: number };
}

// The form's text -> { body } ready for PUT /api/participants/:id/plan, or
// { errors } keyed by field name.
export function parsePlanForm(values) {
  const errors = {};
  const body = {};
  const notes = String(values.notes ?? '').trim();
  if (notes.length > NOTES_MAX) errors.notes = `Notes can be at most ${NOTES_MAX} characters (now ${notes.length}).`;
  body.notes = notes;
  for (const [id, field] of Object.entries(REP_FIELDS)) {
    const result = optionalWhole(values[field], REPS_MIN, REPS_MAX, `${EXERCISE_NAMES[id]} reps`);
    if (result.error) errors[field] = result.error;
    else body[field] = result.value;
  }
  const min = optionalWhole(values.target_bpm_min, BPM_MIN, BPM_MAX, 'Lowest heart rate');
  const max = optionalWhole(values.target_bpm_max, BPM_MIN, BPM_MAX, 'Highest heart rate');
  if (min.error) errors.target_bpm_min = min.error;
  else body.target_bpm_min = min.value;
  if (max.error) errors.target_bpm_max = max.error;
  else body.target_bpm_max = max.value;
  if (!min.error && !max.error && min.value !== null && max.value !== null && min.value > max.value) {
    errors.target_bpm_max = 'The highest heart rate must be the same as or above the lowest.';
  }
  return Object.keys(errors).length ? { errors } : { body };
}
