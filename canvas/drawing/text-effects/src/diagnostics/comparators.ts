/**
 * TextEffect Diagnostic Comparators
 *
 * Compare source (XLSX) TextEffect configuration against stored
 * configuration to detect import/export fidelity issues.
 */

/**
 * A single difference found between source and stored data.
 */
export interface PropertyDifference {
  property: string;
  source: unknown;
  stored: unknown;
}

/**
 * Result of a comparison between source and stored TextEffect data.
 */
export interface ComparisonResult {
  match: boolean;
  differences: PropertyDifference[];
}

/**
 * Compare two TextEffect configurations (source vs stored).
 *
 * Performs a deep comparison of all properties, reporting any
 * differences found. Useful for verifying XLSX import fidelity.
 *
 * @param source The source TextEffect data (e.g., from XLSX)
 * @param stored The stored TextEffect data (e.g., in Yjs)
 * @returns Comparison result with list of differences
 */
export function compareTextEffect(source: unknown, stored: unknown): ComparisonResult {
  const differences: PropertyDifference[] = [];

  if (source === stored) {
    return { match: true, differences: [] };
  }

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

  compareObjects(
    source as Record<string, unknown>,
    stored as Record<string, unknown>,
    '',
    differences,
  );

  return {
    match: differences.length === 0,
    differences,
  };
}

/**
 * Recursively compare two objects and collect differences.
 */
function compareObjects(
  source: Record<string, unknown>,
  stored: Record<string, unknown>,
  prefix: string,
  differences: PropertyDifference[],
): void {
  const allKeys = new Set([...Object.keys(source), ...Object.keys(stored)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const srcVal = source[key];
    const stoVal = stored[key];

    if (srcVal === stoVal) continue;

    if (srcVal === undefined && stoVal !== undefined) {
      differences.push({ property: path, source: undefined, stored: stoVal });
    } else if (srcVal !== undefined && stoVal === undefined) {
      differences.push({ property: path, source: srcVal, stored: undefined });
    } else if (
      typeof srcVal === 'object' &&
      srcVal !== null &&
      typeof stoVal === 'object' &&
      stoVal !== null &&
      !Array.isArray(srcVal) &&
      !Array.isArray(stoVal)
    ) {
      compareObjects(
        srcVal as Record<string, unknown>,
        stoVal as Record<string, unknown>,
        path,
        differences,
      );
    } else if (Array.isArray(srcVal) && Array.isArray(stoVal)) {
      if (srcVal.length !== stoVal.length) {
        differences.push({
          property: `${path}.length`,
          source: srcVal.length,
          stored: stoVal.length,
        });
      }
      const minLen = Math.min(srcVal.length, stoVal.length);
      for (let i = 0; i < minLen; i++) {
        if (
          srcVal[i] !== null &&
          stoVal[i] !== null &&
          typeof srcVal[i] === 'object' &&
          typeof stoVal[i] === 'object'
        ) {
          compareObjects(
            srcVal[i] as Record<string, unknown>,
            stoVal[i] as Record<string, unknown>,
            `${path}[${i}]`,
            differences,
          );
        } else if (srcVal[i] !== stoVal[i]) {
          differences.push({ property: `${path}[${i}]`, source: srcVal[i], stored: stoVal[i] });
        }
      }
    } else {
      // Check for floating point near-equality
      if (typeof srcVal === 'number' && typeof stoVal === 'number') {
        if (Math.abs(srcVal - stoVal) > 1e-6) {
          differences.push({ property: path, source: srcVal, stored: stoVal });
        }
      } else {
        differences.push({ property: path, source: srcVal, stored: stoVal });
      }
    }
  }
}
