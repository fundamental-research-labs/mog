/**
 * Shape diagnostic reporters.
 *
 * Generates human-readable reports about shape configurations.
 */
import type { ShapeAdjustment } from '../presets/registry';
import { getDefaultAdjustments, getRegisteredShapeTypes, isValidShapeType } from '../shape-to-path';
import { validateShape } from './validators';

/**
 * Generate a diagnostic report for a specific shape.
 */
export function generateShapeReport(shapeType: string, adjustments?: ShapeAdjustment[]): string {
  const lines: string[] = [];
  lines.push(`Shape Report: ${shapeType}`);
  lines.push('='.repeat(40));

  if (!isValidShapeType(shapeType)) {
    lines.push(`ERROR: Shape type "${shapeType}" is not registered.`);
    lines.push(`Available types: ${getRegisteredShapeTypes().length} total`);
    return lines.join('\n');
  }

  // Default adjustments
  const defaults = getDefaultAdjustments(shapeType);
  lines.push(`\nDefault Adjustments (${defaults.length}):`);
  for (const d of defaults) {
    lines.push(`  ${d.name}: ${d.value} [${d.min ?? '-inf'}, ${d.max ?? '+inf'}]`);
  }

  // Validate at standard size
  const validation = validateShape({
    shapeType,
    width: 100,
    height: 100,
    adjustments,
  });

  lines.push(`\nValidation: ${validation.valid ? 'PASS' : 'FAIL'}`);
  for (const issue of validation.issues) {
    lines.push(`  [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
  }

  if (validation.geometry) {
    const { pathLength, pointCount, boundingBox } = validation.geometry;
    lines.push(`\nGeometry:`);
    lines.push(`  Path length: ${pathLength.toFixed(2)}`);
    lines.push(`  Point count: ${pointCount}`);
    lines.push(
      `  Bounding box: (${boundingBox.x.toFixed(1)}, ${boundingBox.y.toFixed(1)}) ${boundingBox.width.toFixed(1)}x${boundingBox.height.toFixed(1)}`,
    );
  }

  return lines.join('\n');
}

/**
 * Generate a summary report of all registered presets.
 */
export function generatePresetSummaryReport(): string {
  const types = getRegisteredShapeTypes();
  const lines: string[] = [];
  lines.push(`Shape Engine Preset Summary`);
  lines.push('='.repeat(40));
  lines.push(`Total registered presets: ${types.length}`);
  lines.push('');

  let validCount = 0;
  let issueCount = 0;

  for (const t of types) {
    const result = validateShape({ shapeType: t, width: 100, height: 100 });
    if (result.valid) {
      validCount++;
    } else {
      issueCount++;
      lines.push(`  FAIL: ${t} - ${result.issues.map((i) => i.code).join(', ')}`);
    }
  }

  lines.push('');
  lines.push(`Valid: ${validCount}/${types.length}`);
  if (issueCount > 0) {
    lines.push(`Issues: ${issueCount}/${types.length}`);
  }

  return lines.join('\n');
}
