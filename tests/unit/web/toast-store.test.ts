import { beforeEach, describe, expect, it, vi } from "vitest";

// The toast store: durations per type, newest first, collapsing a repeated
// message into a counter, the size cap, dismissing and subscribers. The
// pause on hover is CSS (Toast.module.css) and covered by the e2e tests.

type Store = typeof import("@/components/toast/toast-store");
let store: Store;

beforeEach(async () => {
  // The store is module state; every test gets a fresh copy.
  vi.resetModules();
  store = await import("@/components/toast/toast-store");
});

const summary = () =>
  store.getToasts().map(({ id, type, title, count }) => `${id} ${type} ${title} x${count}`);

describe("toast store", () => {
  it("keeps success 3 s, info 5 s, warning 7 s and error 10 s", () => {
    expect(store.TOAST_DURATION_MS).toEqual({
      success: 3_000,
      info: 5_000,
      warning: 7_000,
      error: 10_000,
    });
  });

  it("lists the newest toast first", () => {
    store.toast.info({ title: "first" });
    store.toast.error({ title: "second" });
    store.toast.success({ title: "third" });
    expect(summary()).toEqual(["3 success third x1", "2 error second x1", "1 info first x1"]);
  });

  it("counts the same message again on the newest toast instead of stacking it", () => {
    const first = store.toast.error({ title: "Wrong token", message: "Try again" });
    const action = { label: "Retry", onClick: () => {} };
    const again = store.toast.error({ title: "Wrong token", message: "Try again", action });
    expect(again).toBe(first);
    expect(summary()).toEqual(["1 error Wrong token x2"]);
    // The latest action wins.
    expect(store.getToasts()[0]?.action).toBe(action);
  });

  it("stacks a repeat when anything differs or it is not the newest", () => {
    store.toast.error({ title: "A" });
    store.toast.warning({ title: "A" });
    store.toast.warning({ title: "A", message: "detail" });
    store.toast.error({ title: "A" });
    expect(summary()).toEqual(["4 error A x1", "3 warning A x1", "2 warning A x1", "1 error A x1"]);
  });

  it("keeps at most 10 toasts, dropping the oldest", () => {
    for (let n = 1; n <= 12; n += 1) store.toast.info({ title: `t${n}` });
    const titles = store.getToasts().map((entry) => entry.title);
    expect(titles).toHaveLength(10);
    expect(titles[0]).toBe("t12");
    expect(titles.at(-1)).toBe("t3");
  });

  it("dismisses by id and notifies subscribers on every change", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribeToasts(listener);
    const id = store.toast.info({ title: "x" });
    store.toast.info({ title: "x" });
    store.toast.dismiss(id);
    expect(store.getToasts()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    store.dismissToast(999);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.toast.info({ title: "y" });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("returns a stable empty list on the server", () => {
    expect(store.getServerToasts()).toBe(store.getServerToasts());
    expect(store.getServerToasts()).toEqual([]);
  });
});
