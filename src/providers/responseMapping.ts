/**
 * Simple response projection for custom provider endpoints.
 *
 * Mapping paths are deliberately simple — no JSONPath:
 * - "total"          -> payload.total
 * - "summary.name"   -> nested object navigation
 * - "items[].hour"   -> map over the `items` array, collecting `hour`
 *
 * Array steps (`[]`) are written on the segment that selects the array;
 * subsequent segments are applied to every element.
 */

/** Resolve a single mapping path against a decoded JSON payload. */
export function resolveMappingPath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const token of path.split(".")) {
    const segment = token.trim();
    if (!segment) continue;
    if (current == null) return undefined;

    const arrayStep = segment.endsWith("[]");
    const key = arrayStep ? segment.slice(0, -2) : segment;
    if (key) {
      if (Array.isArray(current)) {
        current = current.map((item) =>
          item !== null && typeof item === "object"
            ? (item as Record<string, unknown>)[key]
            : undefined,
        );
      } else if (typeof current === "object") {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    if (arrayStep && !Array.isArray(current)) return undefined;
  }
  return current;
}

/**
 * Apply an endpoint's responseMapping: every output field is resolved from
 * the raw payload; fields that resolve to `undefined` are omitted.
 */
export function applyResponseMapping(
  payload: unknown,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(mapping)) {
    const value = resolveMappingPath(payload, path);
    if (value !== undefined) out[field] = value;
  }
  return out;
}
