// The message type next-intl checks keys against (next-intl.d.ts): the
// English catalogue, composed from its area files in apps/web/messages/en/.
// Each property is the area named like its file; only the types are imported,
// the files themselves are read from disk like all other catalogues.
// A new area file needs a line here. Forgetting it cannot go unnoticed: code
// using the area's keys does not type-check, and a line without its file
// fails as well.
export type Messages = {
  accountSecurity: typeof import("../../../messages/en/accountSecurity.json");
  auth: typeof import("../../../messages/en/auth.json");
  checkStatus: typeof import("../../../messages/en/checkStatus.json");
  codeInput: typeof import("../../../messages/en/codeInput.json");
  common: typeof import("../../../messages/en/common.json");
  errors: typeof import("../../../messages/en/errors.json");
  field: typeof import("../../../messages/en/field.json");
  flash: typeof import("../../../messages/en/flash.json");
  formAlert: typeof import("../../../messages/en/formAlert.json");
  home: typeof import("../../../messages/en/home.json");
  languageSwitch: typeof import("../../../messages/en/languageSwitch.json");
  locked: typeof import("../../../messages/en/locked.json");
  roles: typeof import("../../../messages/en/roles.json");
  secondFactor: typeof import("../../../messages/en/secondFactor.json");
  setup: typeof import("../../../messages/en/setup.json");
  setupComplete: typeof import("../../../messages/en/setupComplete.json");
  stepList: typeof import("../../../messages/en/stepList.json");
  toast: typeof import("../../../messages/en/toast.json");
  tokens: typeof import("../../../messages/en/tokens.json");
  twoFactor: typeof import("../../../messages/en/twoFactor.json");
};
