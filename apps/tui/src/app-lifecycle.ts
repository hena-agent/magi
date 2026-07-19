export type AppShutdownReason = "user_exit" | "sigint" | "sigterm";

export type AppLifecycle = {
  registerShutdown(handler: (reason: AppShutdownReason) => Promise<void>): () => void;
  shutdown(reason: AppShutdownReason): Promise<void>;
};

export function createAppLifecycle(): AppLifecycle {
  let handler: ((reason: AppShutdownReason) => Promise<void>) | undefined;
  let shutdownPromise: Promise<void> | undefined;

  return {
    registerShutdown(nextHandler) {
      handler = nextHandler;
      return () => {
        if (handler === nextHandler) handler = undefined;
      };
    },
    shutdown(reason) {
      shutdownPromise ??= handler?.(reason) ?? Promise.resolve();
      return shutdownPromise;
    },
  };
}
