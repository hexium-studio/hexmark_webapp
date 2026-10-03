import type { StepListItem, StepState } from "@/components/step-list/StepList";

// The setup steps, in order, for the progress list on /setup and
// /setup/complete. Titles come from the messages ("setup.steps.<id>.title");
// the wizard pairs each id with its component (steps.tsx).

export const SETUP_STEP_IDS = ["language", "connection", "token", "account"] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

// Progress with the step at `currentIndex` in progress; an index past the
// last step marks every step as done (setup complete).
export function setupProgress(
  currentIndex: number,
  titleOf: (id: SetupStepId) => string,
): StepListItem[] {
  return SETUP_STEP_IDS.map((id, index) => {
    const state: StepState =
      index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
    return { id, title: titleOf(id), state };
  });
}
