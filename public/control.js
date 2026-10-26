export function parseDurationSeconds(value) {
  if (typeof value !== "string") {
    throw new RangeError("Duration must be a whole number from 10 to 300.");
  }

  const normalizedValue = value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new RangeError("Duration must be a whole number from 10 to 300.");
  }

  const durationSeconds = Number(normalizedValue);
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 300) {
    throw new RangeError("Duration must be a whole number from 10 to 300.");
  }

  return durationSeconds;
}
