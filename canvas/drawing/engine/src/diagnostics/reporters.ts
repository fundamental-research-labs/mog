/**
 * Diagnostic Reporters
 *
 * Generate human-readable summaries of drawing state.
 */

import type { GroupHierarchy } from '../grouping/group-manager';
import type { SpatialObject } from '../spatial/spatial-query';

// =============================================================================
// REPORTERS
// =============================================================================

/**
 * Generate a summary report of the drawing state.
 *
 * @param objects - All spatial objects
 * @param groups - Group hierarchy
 * @returns Human-readable summary string
 */
export function generateDrawingSummary(objects: SpatialObject[], groups: GroupHierarchy): string {
  const lines: string[] = [];

  lines.push('=== Drawing Summary ===');
  lines.push(`Total objects: ${objects.length}`);
  lines.push(`Total groups: ${groups.groups.size}`);

  if (objects.length > 0) {
    // Z-order range
    const zIndices = objects.map((o) => o.zIndex);
    const minZ = Math.min(...zIndices);
    const maxZ = Math.max(...zIndices);
    lines.push(`Z-index range: ${minZ} to ${maxZ}`);

    // Bounds summary
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const obj of objects) {
      minX = Math.min(minX, obj.bounds.x);
      minY = Math.min(minY, obj.bounds.y);
      maxX = Math.max(maxX, obj.bounds.x + obj.bounds.width);
      maxY = Math.max(maxY, obj.bounds.y + obj.bounds.height);
    }

    lines.push(`Bounding area: (${minX}, ${minY}) to (${maxX}, ${maxY})`);
  }

  if (groups.groups.size > 0) {
    lines.push('');
    lines.push('--- Groups ---');
    for (const [groupId, group] of groups.groups) {
      const parentId = groups.parentOf.get(groupId);
      const parentInfo = parentId ? ` (parent: ${parentId})` : ' (top-level)';
      lines.push(`  ${groupId}: ${group.childIds.length} children${parentInfo}`);
    }
  }

  // List objects sorted by z-index
  if (objects.length > 0) {
    lines.push('');
    lines.push('--- Objects (by z-order) ---');
    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    for (const obj of sorted) {
      const groupId = groups.parentOf.get(obj.id);
      const groupInfo = groupId ? ` [group: ${groupId}]` : '';
      lines.push(
        `  z=${obj.zIndex} ${obj.id}: (${obj.bounds.x}, ${obj.bounds.y}) ${obj.bounds.width}x${obj.bounds.height}${groupInfo}`,
      );
    }
  }

  return lines.join('\n');
}
