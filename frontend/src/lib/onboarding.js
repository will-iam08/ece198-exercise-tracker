// First-run checklist for a new patient.

export function onboardingSteps({ hasAccount = true, deviceCount, completedExercises } = {}) {
  return [
    { id: 'account', label: 'Account ready', done: Boolean(hasAccount) },
    { id: 'device', label: 'Add your exercise device', done: Number(deviceCount) > 0 },
    { id: 'exercise', label: 'Complete your first exercise', done: Number(completedExercises) > 0 },
  ];
}

export function onboardingProgress(steps) {
  const items = Array.isArray(steps) ? steps : [];
  const done = items.filter(step => step.done).length;
  return {
    done,
    total: items.length,
    complete: done === items.length,
    nextStepId: items.find(step => !step.done)?.id ?? null,
  };
}

export function shouldShowOnboarding({ steps, dismissed } = {}) {
  return !dismissed && !onboardingProgress(steps).complete;
}
