import type { LocaleBlock, LocaleInfo } from "@/lib/locales/locale-info";
import type { SetupStatusResult } from "@/lib/setup-status";

// Contract between the wizard and its steps. A new step only needs a
// component taking StepProps and an entry in SETUP_STEPS (steps.tsx).

// Data collected by earlier steps and needed by later ones.
export interface WizardData {
  // Verified, normalised setup token (step "token"); sent again on submit.
  setupToken?: string;
}

export interface WizardControls {
  status: SetupStatusResult;
  // Languages the pickers offer, in display order (lib/locales/picker-locales.ts):
  // as one list, and in the blocks the language step shows.
  locales: readonly LocaleInfo[];
  localeBlocks: readonly LocaleBlock[];
  data: WizardData;
  update(patch: Partial<WizardData>): void;
  next(): void;
  back(): void;
  goTo(stepId: string): void;
}

export interface StepProps {
  wizard: WizardControls;
}
