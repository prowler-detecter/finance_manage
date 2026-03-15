export function toISODateString(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function parseISODateOrThrow(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid`);
  }
  return date;
}

export function ensureDateTime(value, fallbackDate) {
  const date = value ? new Date(value) : new Date(`${toISODateString(fallbackDate)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return new Date(`${toISODateString(fallbackDate)}T00:00:00.000Z`);
  }
  return date;
}

export function getTimeMs(value) {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
