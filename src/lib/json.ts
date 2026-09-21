/**
 * Structured payloads live in TEXT columns so the schema runs unchanged on
 * SQLite and Postgres. These helpers are the only place that boundary is
 * crossed, and they never throw on malformed data.
 */
export function packJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function readJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}
