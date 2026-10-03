import type { ReactNode } from "react";

// Tags the messages may use with t.rich(), e.g. "<code>.env</code>".
export const RICH_TAGS = {
  code: (chunks: ReactNode) => <code>{chunks}</code>,
};
