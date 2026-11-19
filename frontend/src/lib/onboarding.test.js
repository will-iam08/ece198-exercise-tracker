import { describe, expect, it } from 'vitest';
import { onboardingProgress, onboardingSteps, shouldShowOnboarding } from './onboarding.js';

describe('onboarding steps', () => {
  it('starts with only the account done', () => {
    const steps = onboardingSteps({ deviceCount: 0, completedExercises: 0 });
    expect(steps.map(step => step.id)).toEqual(['account', 'device', 'exercise']);
    expect(steps.map(step => step.done)).toEqual([true, false, false]);
    expect(onboardingProgress(steps)).toEqual({ done: 1, total: 3, complete: false, nextStepId: 'device' });
    expect(shouldShowOnboarding({ steps, dismissed: false })).toBe(true);
  });

  it('treats missing counts as not done', () => {
    expect(onboardingSteps({}).map(step => step.done)).toEqual([true, false, false]);
    expect(onboardingSteps().map(step => step.done)).toEqual([true, false, false]);
    expect(onboardingSteps({ hasAccount: false, deviceCount: null }).map(step => step.done)).toEqual([false, false, false]);
  });

  it('points at the next unfinished step', () => {
    const steps = onboardingSteps({ deviceCount: 2, completedExercises: 0 });
    expect(onboardingProgress(steps).nextStepId).toBe('exercise');
    const outOfOrder = onboardingSteps({ deviceCount: 0, completedExercises: 1 });
    expect(onboardingProgress(outOfOrder)).toMatchObject({ done: 2, nextStepId: 'device' });
  });

  it('hides when complete or dismissed', () => {
    const steps = onboardingSteps({ deviceCount: 1, completedExercises: 3 });
    expect(onboardingProgress(steps)).toEqual({ done: 3, total: 3, complete: true, nextStepId: null });
    expect(shouldShowOnboarding({ steps, dismissed: false })).toBe(false);
    expect(shouldShowOnboarding({ steps: onboardingSteps({}), dismissed: true })).toBe(false);
    expect(shouldShowOnboarding({ steps: [] })).toBe(false);
    expect(onboardingProgress(null)).toEqual({ done: 0, total: 0, complete: true, nextStepId: null });
  });
});
