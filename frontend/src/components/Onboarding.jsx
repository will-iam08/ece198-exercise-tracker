import { onboardingProgress, onboardingSteps, shouldShowOnboarding } from '../lib/onboarding.js';
import { Icon } from './common.jsx';

const STEP_HINTS = {
  account: 'You are signed in.',
  device: 'Add your ESP32 and copy its token into the device.',
  exercise: 'Start a session, pick an exercise and follow the device.',
};

// A short first-visit checklist. It disappears once every step is done, or
// for this visit when the patient hides it.
export function Onboarding({ deviceCount, completedExercises, dismissed, onDismiss, onGoToDevices, onGoToSession }) {
  if (deviceCount === null || completedExercises === null) return null;
  const steps = onboardingSteps({ deviceCount, completedExercises });
  if (!shouldShowOnboarding({ steps, dismissed })) return null;
  const { done, total, nextStepId } = onboardingProgress(steps);

  return (
    <section className="onboarding" aria-labelledby="onboarding-heading">
      <h2 id="onboarding-heading">Get set up</h2>
      <p>{done} of {total} steps done. This list goes away once you finish your first exercise.</p>
      <ol className="onboarding-steps">
        {steps.map((step, index) => {
          const state = step.done ? 'done' : step.id === nextStepId ? 'now' : 'todo';
          return (
            <li key={step.id} className="onboarding-step" data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="onboarding-mark" aria-hidden="true">{step.done ? <Icon name="check" /> : index + 1}</span>
              <span>
                <strong>{step.label}</strong>
                <span className="hint block">{step.done ? 'Done.' : STEP_HINTS[step.id]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="button-row">
        {nextStepId === 'device' && (
          <button type="button" className="button button-primary" onClick={onGoToDevices}><Icon name="device" />Add a device</button>
        )}
        {nextStepId === 'exercise' && (
          <button type="button" className="button button-primary" onClick={onGoToSession}><Icon name="play" />Start a session</button>
        )}
        <button type="button" className="button button-quiet" onClick={onDismiss}>Hide this list</button>
      </div>
    </section>
  );
}
