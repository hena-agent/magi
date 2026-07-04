import os from "node:os";

export function copyHeadersWithoutAuthorization(
  headersInit: ConstructorParameters<typeof Headers>[0] | undefined,
): Headers {
  const headers = new Headers(headersInit);
  headers.delete("authorization");
  headers.delete("Authorization");

  return headers;
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64url");
}

export function userAgent(): string {
  return `magi/0.0.0 (${os.platform()} ${os.release()}; ${os.arch()})`;
}

export function successHtml(): string {
  return "<!doctype html><html><body><h1>Authorization Successful</h1><p>You can close this window and return to MAGI.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>";
}

export function errorHtml(error: string): string {
  return `<!doctype html><html><body><h1>Authorization Failed</h1><pre>${escapeHtml(error)}</pre></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
