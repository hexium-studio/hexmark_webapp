# Toasts

Feedback that does not belong to a single field appears as a toast; field
errors stay at the field. The rules (durations, colours, stacking, motion)
are described below; the code is in
`apps/web/src/components/toast/`.

## Showing a toast

From any client component or event handler:

```ts
import { toast } from "@/components/toast/toast-store";

toast.error({
  title: t("errors.x.title"),
  message: t("errors.x.detail"),
  // optional; the toast closes after the action ran
  action: { label: t("backToConnection"), onClick: () => goTo("connection") },
});
```

`toast.success | info | warning | error` show for 3 / 5 / 7 / 10 seconds.
Texts are passed already translated. The same title and message as the
newest toast is not stacked again: the toast shows a counter and starts its
time anew.

The `<Toaster>` is mounted once in the root layout, so toasts survive client
navigation, `router.refresh()` and redirects.

## After a server action redirects

A server action that calls `redirect()` replaces the page before the caller
can run any more code. Such an action queues the toast in a short-lived
cookie instead:

```ts
import { queueFlashToast } from "@/components/toast/flash-server";

await queueFlashToast("adminCreated");
redirect("/setup/complete");
```

The cookie (`hexmark_flash`, 60 s, not HttpOnly) holds only an id from
`FLASH_TOASTS` in `flash.ts`, never text. The Toaster reads and deletes it
after every navigation and on page load, and shows the toast in the language
of the page it lands on (messages `flash.<id>.title` and `.message`). To add
one, add the id and its type to `FLASH_TOASTS` and its texts to every
message file.

## Accessibility and rendering

- Two live regions (`role="status"` for success/info, `role="alert"` for
  warning/error) are always in the DOM and announce each toast; the visible
  stack is rendered only while toasts exist, because a fixed element is a
  compositing layer.
- Toasts never take focus. Tab reaches their buttons at the end of the page;
  Escape closes the focused toast and focus returns to where it came from.
- Hover or focus pauses the time; the progress bar animates its inline size
  and moves in one-second steps with reduced motion.
