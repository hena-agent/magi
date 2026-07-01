export function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const jsonText = extractJsonText(text).trim();

  try {
    const value = JSON.parse(jsonText) as unknown;

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Parsed JSON must be an object.");
    }

    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Failed to parse model JSON action: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractJsonText(text: string): string {
  const fencedMatch = /```(?:json)?\n(?<json>[\s\S]*?)```/.exec(text);

  return fencedMatch?.groups?.json ?? text;
}
