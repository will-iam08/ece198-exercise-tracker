// Lookups over GET /api/admin/overview for the admin screens.

// -> { patientsByDoctor: Map(doctorId -> patients[]), doctorsByPatient: Map(patientId -> doctors[]) }
export function assignmentMaps(overview) {
  const patients = new Map((overview?.patients ?? []).map(patient => [patient.id, patient]));
  const doctors = new Map((overview?.doctors ?? []).map(doctor => [doctor.id, doctor]));
  const patientsByDoctor = new Map([...doctors.keys()].map(id => [id, []]));
  const doctorsByPatient = new Map([...patients.keys()].map(id => [id, []]));
  for (const { staff_id: staffId, participant_id: participantId } of overview?.assignments ?? []) {
    const patient = patients.get(participantId);
    const doctor = doctors.get(staffId);
    if (!patient || !doctor) continue;
    patientsByDoctor.get(staffId).push(patient);
    doctorsByPatient.get(participantId).push(doctor);
  }
  return { patientsByDoctor, doctorsByPatient };
}

export function isAssigned(overview, staffId, participantId) {
  return (overview?.assignments ?? []).some(item => item.staff_id === staffId && item.participant_id === participantId);
}

// -> { body } for POST /api/admin/doctors, or { error }.
export function parseDoctorForm({ name = '', email = '', password = '' }) {
  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim();
  if (!cleanName || cleanName.length > 80) return { error: 'Enter the doctor’s name (up to 80 characters).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { error: 'Enter a valid email address, for example name@example.com.' };
  if (password.length < 12 || password.length > 128) return { error: 'The password must be 12 to 128 characters long.' };
  return { body: { name: cleanName, email: cleanEmail, password } };
}
