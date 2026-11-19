import { onboardingProgress, onboardingSteps, shouldShowOnboarding } from '../lib/onboarding.js';
import { Icon } from './common.jsx';

// Three steps for a first visit. Disappears once every step is done or dismissed.
export function Onboarding({ syncedSets, completedExercises, dismissed, onDismiss }) {
  const steps = onboardingSteps({ hasAccount: true, syncedSets, completedExercises });
  if (!shouldShowOnboarding({ steps, dismissed })) return null;
  const progress = onboardingProgress(steps);

  return (
    <section className="onboarding" aria-labelledby="onboarding-heading">
      <div className="console-head">
        <div>
          <h2 id="onboarding-heading">Getting started</h2>
          <p>{progress.done} of {progress.total} steps complete.</p>
        </div>
        <button type="button" className="button button-quiet" onClick={onDismiss}>Hide guide</button>
      </div>
      <ol className="onboarding-steps">
        {steps.map((step, index) => (
          <li key={step.id} className="onboarding-step" data-state={step.done ? 'done' : 'todo'}>
            <span className="onboarding-mark" aria-hidden="true">
              {step.done ? <Icon name="check" /> : index + 1}
            </span>
            <span>
              <strong>{step.title}</strong>
              <span className="hint block">{step.done ? 'Done' : step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
