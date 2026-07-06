export function readPositiveInteger(value: Record<string, unknown>, field: string): number {
  const fieldValue = value[field];

  if (typeof fieldValue !== "number" || !Number.isInteger(fieldValue) || fieldValue < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return fieldValue;
}

export function readOptionalPositiveInteger(
  value: Record<string, unknown>,
  field: string,
): number | undefined {
  if (value[field] === undefined) return undefined;

  return readPositiveInteger(value, field);
}
