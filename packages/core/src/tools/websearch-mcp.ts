export function parseMcpTextResponse(body: string): string | undefined {
  const trimmed = body.trim();
  const direct = trimmed ? parseMcpPayload(trimmed) : undefined;
  if (direct) return direct;

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const parsed = parseMcpPayload(line.slice("data: ".length));
    if (parsed) return parsed;
  }

  return undefined;
}

function parseMcpPayload(payload: string): string | undefined {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return undefined;

  try {
    const data = JSON.parse(trimmed) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;

    const result = (data as Record<string, unknown>).result;
    if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined;

    const content = (result as Record<string, unknown>).content;
    if (!Array.isArray(content)) return undefined;

    for (const item of content) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const text = (item as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) return text.trim();
    }
  } catch {
    return undefined;
  }

  return undefined;
}
