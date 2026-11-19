import { bodyFields, fail, integer } from './validate.js';

// The care plan a doctor (or an admin) writes for one patient: notes, a rep
// count per exercise, and the heart-rate range to be in after exercise.
export const PLAN_REP_FIELDS = ['arm_curl_reps', 'shoulder_press_reps', 'back_row_reps'];
const PLAN_FIELDS = ['notes', ...PLAN_REP_FIELDS, 'target_bpm_min', 'target_bpm_max'];

const PLAN_SELECT = `SELECT p.*, a.name AS doctor_name FROM patient_plans p
  LEFT JOIN users a ON a.id = p.staff_id WHERE p.participant_id = ?`;

function optionalInteger(value, field, min, max) {
  return value === undefined || value === null ? null : integer(value, field, min, max);
}

// A PUT body -> the stored values. Fields that are left out are cleared.
export function planValues(body) {
  bodyFields(body, [], PLAN_FIELDS);
  const notes = body.notes === undefined || body.notes === null ? '' : body.notes;
  if (typeof notes !== 'string' || notes.length > 1000) fail(400, 'notes must be a string of at most 1000 characters');
  const values = { notes: notes.trim() };
  for (const field of PLAN_REP_FIELDS) values[field] = optionalInteger(body[field], field, 1, 50);
  values.target_bpm_min = optionalInteger(body.target_bpm_min, 'target_bpm_min', 30, 220);
  values.target_bpm_max = optionalInteger(body.target_bpm_max, 'target_bpm_max', 30, 220);
  if (values.target_bpm_min !== null && values.target_bpm_max !== null && values.target_bpm_min > values.target_bpm_max) {
    fail(400, 'target_bpm_min must not be greater than target_bpm_max');
  }
  return values;
}

export function registerPlanRoutes(app, { db, userAuth, participant, staffOrAdmin, assignedParticipant }) {
  const plan = async participantId => (await db.get(PLAN_SELECT, participantId)) ?? null;

  // Assigned doctors and admins only: patients get 403 from staffOrAdmin, and
  // an unassigned doctor gets the same 404 as for a patient who does not exist.
  app.get('/api/participants/:id/plan', userAuth, staffOrAdmin, assignedParticipant, async (req, res) => {
    res.json({ plan: await plan(req.params.id) });
  });

  app.put('/api/participants/:id/plan', userAuth, staffOrAdmin, assignedParticipant, async (req, res) => {
    const values = planValues(req.body);
    await db.run(`INSERT INTO patient_plans (participant_id, staff_id, notes, arm_curl_reps, shoulder_press_reps, back_row_reps,
        target_bpm_min, target_bpm_max, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (participant_id) DO UPDATE SET staff_id = excluded.staff_id, notes = excluded.notes,
        arm_curl_reps = excluded.arm_curl_reps, shoulder_press_reps = excluded.shoulder_press_reps,
        back_row_reps = excluded.back_row_reps, target_bpm_min = excluded.target_bpm_min,
        target_bpm_max = excluded.target_bpm_max, updated_at = excluded.updated_at`,
      req.params.id, req.user.id, values.notes, values.arm_curl_reps, values.shoulder_press_reps, values.back_row_reps,
      values.target_bpm_min, values.target_bpm_max, new Date().toISOString());
    res.json({ plan: await plan(req.params.id) });
  });

  // The signed-in patient's own plan, with the name of whoever last saved it.
  app.get('/api/plan', userAuth, participant, async (req, res) => res.json({ plan: await plan(req.user.id) }));
}
