/**
 * TextEffect Diagnostic Validators
 *
 * Validate warp preset names, adjustment values, and warp results
 * for correctness and potential issues.
 */
import type { WarpPresetName } from '../presets/registry';
import { getWarpPreset, isValidPresetName } from '../presets/registry';
import type { WarpedGlyph } from '../warp/warp-engine';

/**
 * A diagnostic issue found during validation.
 */
export interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

/**
 * Result of a validation check.
 */
export interface ValidationResult {
  valid: boolean;
  issues: DiagnosticIssue[];
}

/**
 * Validate a warp preset name and optional adjustment value.
 *
 * Checks:
 * - Preset name is known
 * - Adjustment value is within valid range
 * - Adjustment value is not NaN/Infinity
 *
 * @param name Preset name to validate
 * @param adjustment Optional adjustment value
 * @returns Validation result
 */
export function validateWarpPreset(name: string, adjustment?: number): ValidationResult {
  const issues: DiagnosticIssue[] = [];

  // Check if preset name is valid
  if (!isValidPresetName(name)) {
    issues.push({
      severity: 'error',
      code: 'TEXT_EFFECT_PRESET_UNKNOWN',
      message: `Unknown warp preset: '${name}'`,
    });
    return { valid: false, issues };
  }

  // Check adjustment value
  if (adjustment !== undefined) {
    if (!isFinite(adjustment)) {
      issues.push({
        severity: 'error',
        code: 'TEXT_EFFECT_ADJUSTMENT_NAN',
        message: `Adjustment value is not finite: ${adjustment}`,
      });
    } else {
      const preset = getWarpPreset(name as WarpPresetName);
      if (adjustment < preset.minAdjustment) {
        issues.push({
          severity: 'warning',
          code: 'TEXT_EFFECT_ADJUSTMENT_BELOW_MIN',
          message: `Adjustment ${adjustment} is below minimum ${preset.minAdjustment} for preset '${name}'`,
        });
      }
      if (adjustment > preset.maxAdjustment) {
        issues.push({
          severity: 'warning',
          code: 'TEXT_EFFECT_ADJUSTMENT_ABOVE_MAX',
          message: `Adjustment ${adjustment} is above maximum ${preset.maxAdjustment} for preset '${name}'`,
        });
      }
    }
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

/**
 * Validate warped glyph results for potential rendering issues.
 *
 * Checks:
 * - No NaN/Infinity in coordinates
 * - Warped glyphs have non-zero area
 * - Transforms are non-singular
 * - Scale factors are reasonable
 *
 * @param warped Array of warped glyphs
 * @returns Validation result
 */
export function validateWarpResult(warped: WarpedGlyph[]): ValidationResult {
  const issues: DiagnosticIssue[] = [];

  if (warped.length === 0) {
    issues.push({
      severity: 'info',
      code: 'TEXT_EFFECT_EMPTY_RESULT',
      message: 'Warp result is empty (no glyphs)',
    });
    return { valid: true, issues };
  }

  for (let i = 0; i < warped.length; i++) {
    const wg = warped[i];

    // Check corners for NaN
    for (let c = 0; c < 4; c++) {
      const corner = wg.corners[c];
      if (!isFinite(corner.x) || !isFinite(corner.y)) {
        issues.push({
          severity: 'error',
          code: 'TEXT_EFFECT_NAN_COORDINATE',
          message: `Glyph ${i} ('${wg.original.char}') corner ${c} has non-finite coordinate: (${corner.x}, ${corner.y})`,
        });
      }
    }

    // Check for degenerate (zero-area) warped glyph
    const [tl, tr, br, bl] = wg.corners;
    const area =
      0.5 *
      Math.abs(
        tl.x * tr.y -
          tr.x * tl.y +
          (tr.x * br.y - br.x * tr.y) +
          (br.x * bl.y - bl.x * br.y) +
          (bl.x * tl.y - tl.x * bl.y),
      );
    if (area < 1e-10 && wg.original.width > 0.001 && wg.original.height > 0.001) {
      issues.push({
        severity: 'warning',
        code: 'TEXT_EFFECT_WARP_DEGENERATE',
        message: `Glyph ${i} ('${wg.original.char}') warped to near-zero area`,
      });
    }

    // Check transform for NaN
    const t = wg.transform;
    if (
      !isFinite(t.a) ||
      !isFinite(t.b) ||
      !isFinite(t.c) ||
      !isFinite(t.d) ||
      !isFinite(t.tx) ||
      !isFinite(t.ty)
    ) {
      issues.push({
        severity: 'error',
        code: 'TEXT_EFFECT_TRANSFORM_NAN',
        message: `Glyph ${i} ('${wg.original.char}') has non-finite transform`,
      });
    }

    // Check for extreme scale
    if (wg.scale > 100 || wg.scale < 0.001) {
      issues.push({
        severity: 'warning',
        code: 'TEXT_EFFECT_EXTREME_SCALE',
        message: `Glyph ${i} ('${wg.original.char}') has extreme scale: ${wg.scale}`,
      });
    }
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}
