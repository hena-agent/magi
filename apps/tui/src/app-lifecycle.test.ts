import { expect, it, vi } from "vitest";
import { createAppLifecycle } from "./app-lifecycle.js";

it("runs one registered shutdown exactly once", async () => {
  const lifecycle = createAppLifecycle();
  const shutdown = vi.fn(async () => undefined);
  lifecycle.registerShutdown(shutdown);

  const first = lifecycle.shutdown("sigint");
  const second = lifecycle.shutdown("sigterm");
  await Promise.all([first, second]);

  expect(first).toBe(second);
  expect(shutdown).toHaveBeenCalledOnce();
  expect(shutdown).toHaveBeenCalledWith("sigint");
});

it("allows shutdown registration to be removed", async () => {
  const lifecycle = createAppLifecycle();
  const shutdown = vi.fn(async () => undefined);
  const unregister = lifecycle.registerShutdown(shutdown);
  unregister();

  await lifecycle.shutdown("user_exit");

  expect(shutdown).not.toHaveBeenCalled();
});
