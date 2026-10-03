import type { Messages } from "./registry";

// Message keys are type-checked against English (messages.ts). The locale stays a plain
// string: the set of locales is decided at run time by the registry.
declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
