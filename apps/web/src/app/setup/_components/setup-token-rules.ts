import { SETUP_TOKEN_LENGTH, SETUP_TOKEN_PATTERN } from "@hexmark/shared";
import type { CodeRules } from "@/components/code-input/code-model";

// The setup token as cells of the code input. Length and the rule for a
// single character both come from the shared format the server enforces: a
// character is allowed when a token made only of it would be valid.

export const SETUP_TOKEN_RULES: CodeRules = {
  length: SETUP_TOKEN_LENGTH,
  allowed: (char) => SETUP_TOKEN_PATTERN.test(char.repeat(SETUP_TOKEN_LENGTH)),
  // The server upper-cases the token too (setupTokenSchema).
  normalise: (char) => char.toUpperCase(),
};
