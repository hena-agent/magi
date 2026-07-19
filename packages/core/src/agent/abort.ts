export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;

  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function rethrowIfAbortError(error: unknown, signal?: AbortSignal): void {
  if (isAbortError(error, signal)) throw error;
}
