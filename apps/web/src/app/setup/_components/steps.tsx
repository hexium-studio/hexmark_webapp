import type { ComponentType } from "react";
import { SETUP_STEP_IDS, type SetupStepId } from "@/lib/setup-steps";
import { AccountStep } from "./AccountStep";
import { ConnectionStep } from "./ConnectionStep";
import { LanguageStep } from "./LanguageStep";
import { TokenStep } from "./TokenStep";
import type { StepProps } from "./wizard-types";

// Order (lib/setup-steps.ts) and component of each wizard step. Title and
// intro are the messages "setup.steps.<id>.title" and ".intro". Add further
// steps there, here and in the message files.
export interface SetupStep {
  id: SetupStepId;
  Component: ComponentType<StepProps>;
}

const COMPONENTS: Record<SetupStepId, ComponentType<StepProps>> = {
  language: LanguageStep,
  connection: ConnectionStep,
  token: TokenStep,
  account: AccountStep,
};

export const SETUP_STEPS: readonly SetupStep[] = SETUP_STEP_IDS.map((id) => ({
  id,
  Component: COMPONENTS[id],
}));
