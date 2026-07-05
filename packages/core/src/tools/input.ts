export function readObject(
  input: unknown,
  requiredFields: string[],
  optionalFields: string[] = [],
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }

  const inputObject = input as Record<string, unknown>;

  for (const field of requiredFields) {
    if (inputObject[field] === undefined) {
      throw new Error(`Tool input requires field: ${field}`);
    }
  }

  for (const field of optionalFields) {
    const value = inputObject[field];

    if (
      value !== undefined &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`Tool input field must be string, number, or boolean: ${field}`);
    }
  }

  return inputObject;
}

export function getStringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string") {
    throw new Error(`Tool input requires string field: ${field}`);
  }

  return value;
}

export function getOptionalStringField(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Tool input field must be string: ${field}`);
  }

  return value;
}

export function getOptionalBooleanField(
  input: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Tool input field must be boolean: ${field}`);
  }

  return value;
}
