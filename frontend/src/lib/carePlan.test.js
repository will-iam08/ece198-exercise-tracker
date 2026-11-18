import { describe, expect, it } from 'vitest';
import {
  bpmCheck, bpmRangeLabel, hasPlan, hasTargets, parsePlanForm, planFormValues, prescribedReps, repsCheck,
} from './carePlan.js';

const plan = {
  notes: 'Slow and steady.', arm_curl_reps: 12, shoulder_press_reps: null, back_row_reps: 8,
  target_bpm_min: 60, target_bpm_max: 120,
};
const workout = (fields) => ({ exercise_id: 'arm_curl', status: 'completed', repetitions: 12, after_bpm: 100, ...fields });

describe('care plan targets', () => {
  it('reads prescriptions and ranges', () => {
    expect(prescribedReps(plan, 'arm_curl')).toBe(12);
    expect(prescribedReps(plan, 'shoulder_press')).toBe(null);
    expect(prescribedReps(null, 'arm_curl')).toBe(null);
    expect(bpmRangeLabel(plan)).toBe('60–120 bpm');
    expect(bpmRangeLabel({ target_bpm_min: 60 })).toBe('at least 60 bpm');
    expect(bpmRangeLabel({ target_bpm_max: 120 })).toBe('at most 120 bpm');
    expect(bpmRangeLabel({})).toBe(null);
    expect(hasTargets(plan)).toBe(true);
    expect(hasTargets({ notes: 'x' })).toBe(false);
    expect(hasPlan({ notes: '  ' })).toBe(false);
    expect(hasPlan({ notes: 'Rest on Sunday' })).toBe(true);
    expect(hasPlan(null)).toBe(false);
  });

  it('compares reps with the prescription', () => {
    expect(repsCheck(workout(), plan)).toEqual({ state: 'met', label: '12 of 12 prescribed reps' });
    expect(repsCheck(workout({ repetitions: 15 }), plan).state).toBe('met');
    expect(repsCheck(workout({ repetitions: 9, status: 'incomplete' }), plan))
      .toEqual({ state: 'below', label: '9 of 12 prescribed reps' });
    expect(repsCheck(workout({ repetitions: 4, status: 'active' }), plan))
      .toEqual({ state: 'pending', label: '4 of 12 prescribed reps so far' });
    expect(repsCheck(workout({ exercise_id: 'shoulder_press' }), plan)).toBe(null);
    expect(repsCheck(workout({ exercise_id: undefined }), plan)).toBe(null);
  });

  it('compares the after-exercise heart rate with the range', () => {
    expect(bpmCheck(workout(), plan)).toEqual({ state: 'in', label: '100 bpm, target 60–120 bpm' });
    expect(bpmCheck(workout({ after_bpm: 120 }), plan).state).toBe('in');
    expect(bpmCheck(workout({ after_bpm: 121 }), plan).state).toBe('above');
    expect(bpmCheck(workout({ after_bpm: 59 }), plan)).toEqual({ state: 'below', label: '59 bpm, target 60–120 bpm' });
    expect(bpmCheck(workout({ after_bpm: null }), plan)).toEqual({ state: 'none', label: 'target 60–120 bpm' });
    expect(bpmCheck(workout({ after_bpm: null, status: 'active' }), plan).state).toBe('pending');
    expect(bpmCheck(workout({ after_bpm: 200 }), { target_bpm_min: 60 }).state).toBe('in');
    expect(bpmCheck(workout(), { arm_curl_reps: 10 })).toBe(null);
  });
});

describe('care plan form', () => {
  it('round-trips a saved plan', () => {
    const values = planFormValues(plan);
    expect(values).toEqual({
      notes: 'Slow and steady.', arm_curl_reps: '12', shoulder_press_reps: '', back_row_reps: '8',
      target_bpm_min: '60', target_bpm_max: '120',
    });
    expect(parsePlanForm(values)).toEqual({ body: { ...plan } });
    expect(planFormValues(null).notes).toBe('');
  });

  it('reports each invalid field', () => {
    const base = planFormValues(plan);
    expect(parsePlanForm({ ...base, arm_curl_reps: '0' }).errors.arm_curl_reps).toMatch(/1 to 50/);
    expect(parsePlanForm({ ...base, back_row_reps: '51' }).errors.back_row_reps).toMatch(/1 to 50/);
    expect(parsePlanForm({ ...base, shoulder_press_reps: '7.5' }).errors.shoulder_press_reps).toMatch(/whole number/);
    expect(parsePlanForm({ ...base, target_bpm_min: '29' }).errors.target_bpm_min).toMatch(/30 to 220/);
    expect(parsePlanForm({ ...base, target_bpm_max: '221' }).errors.target_bpm_max).toMatch(/30 to 220/);
    expect(parsePlanForm({ ...base, target_bpm_min: '130' }).errors.target_bpm_max).toMatch(/above the lowest/);
    expect(parsePlanForm({ ...base, notes: 'x'.repeat(1001) }).errors.notes).toMatch(/1000/);
    expect(parsePlanForm({ ...base, target_bpm_min: '', target_bpm_max: ' 90 ' }).body).toMatchObject({ target_bpm_min: null, target_bpm_max: 90 });
  });
});
