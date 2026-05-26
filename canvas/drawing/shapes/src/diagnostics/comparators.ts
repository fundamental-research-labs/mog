/**
 * Shape comparison diagnostics.
 *
 * Compares two shape representations (e.g., XLSX source vs stored data).
 */

export interface ShapeDifference {
  property: string;
  source: unknown;
  stored: unknown;
}

export interface ShapeComparisonResult {
  match: boolean;
  differences: ShapeDifference[];
}

/**
 * Compare two shape data objects.
 *
 * Performs a deep comparison of relevant shape properties
 * to detect import/storage fidelity issues.
 */
export function compareShapes(source: unknown, stored: unknown): ShapeComparisonResult {
  const differences: ShapeDifference[] = [];

  if (source === null || source === undefined || stored === null || stored === undefined) {
    if (source !== stored) {
      differences.push({ property: '(root)', source, stored });
    }
    return { match: differences.length === 0, differences };
  }

  if (typeof source !== 'object' || typeof stored !== 'object') {
    if (source !== stored) {
      differences.push({ property: '(root)', source, stored });
    }
    return { match: differences.length === 0, differences };
  }

  const s = source as Record<string, unknown>;
  const t = stored as Record<string, unknown>;

  // Compare all properties from source
  const allKeys = new Set([...Object.keys(s), ...Object.keys(t)]);

  for (const key of allKeys) {
    const sv = s[key];
    const tv = t[key];

    if (sv === tv) continue;

    // Handle numbers with tolerance
    if (typeof sv === 'number' && typeof tv === 'number') {
      // Guard: NaN never matches anything, including another NaN
      if (isNaN(sv) || isNaN(tv) || Math.abs(sv - tv) > 1e-6) {
        differences.push({ property: key, source: sv, stored: tv });
      }
      continue;
    }

    // Handle arrays (must come before generic object check since arrays are objects)
    if (Array.isArray(sv) && Array.isArray(tv)) {
      if (sv.length !== tv.length) {
        differences.push({ property: `${key}.length`, source: sv.length, stored: tv.length });
      } else {
        for (let i = 0; i < sv.length; i++) {
          if (sv[i] !== tv[i]) {
            const nested = compareShapes(sv[i], tv[i]);
            for (const diff of nested.differences) {
              differences.push({
                property: `${key}[${i}].${diff.property}`,
                source: diff.source,
                stored: diff.stored,
              });
            }
          }
        }
      }
      continue;
    }

    // Handle nested objects
    if (typeof sv === 'object' && typeof tv === 'object' && sv !== null && tv !== null) {
      const nested = compareShapes(sv, tv);
      for (const diff of nested.differences) {
        differences.push({
          property: `${key}.${diff.property}`,
          source: diff.source,
          stored: diff.stored,
        });
      }
      continue;
    }

    // Simple inequality
    if (sv !== tv) {
      differences.push({ property: key, source: sv, stored: tv });
    }
  }

  return { match: differences.length === 0, differences };
}
