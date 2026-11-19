export const EXERCISES = [
  { id: 'arm_curl', name: 'Arm Curl', placement: 'forearm' },
  { id: 'shoulder_press', name: 'Shoulder Press', placement: 'upper arm' },
  { id: 'back_row', name: 'Back Row', placement: 'upper arm' },
];

// BLE wire codes sent by the tracker firmware: 1 = Biceps curl, 3 = Shoulder press, 4 = Back row.
// Code 2 (Lateral raise) is intentionally omitted and rejected by the API.
export const WIRE_EXERCISE_CODES = Object.freeze({
  1: 'arm_curl',
  3: 'shoulder_press',
  4: 'back_row',
});

export function resolveAppExercise(input) {
  let id = null;
  if (typeof input === 'number') {
    if (Number.isSafeInteger(input)) id = WIRE_EXERCISE_CODES[input] || null;
  } else if (typeof input === 'string') {
    id = input.trim();
  }
  return id ? EXERCISES.find(item => item.id === id) || null : null;
}
