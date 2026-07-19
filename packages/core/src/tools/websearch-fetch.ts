const timeoutMs = 25_000;

export async function fetchWebsearch(
  url: string | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`websearch timed out after ${timeoutMs / 1_000}s`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
