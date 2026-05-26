/**
 * Shared element type matching utility.
 *
 * Provides a single source-of-truth implementation of ST_ElementType matching
 * used by both DataModel and the Axis Navigator. This avoids duplicating the
 * matching logic and ensures both modules stay in sync (especially for semantic
 * types like nonAsst, norm, nonNorm).
 *
 * @module element-type-utils
 */

import type { ST_ElementType } from '@mog-sdk/contracts/diagram';

/**
 * A minimal point shape used for element type matching.
 * Both DataModelPoint and any point-like object satisfy this interface.
 */
export interface PointLike {
  readonly type: string;
}

/**
 * Check if a point matches an OOXML element type filter.
 *
 * Semantics per ECMA-376 Section 21.4.7.19 ST_ElementType:
 * - 'all': matches any point type
 * - 'doc': matches only doc root points
 * - 'node': matches only standard data nodes
 * - 'asst': matches only assistant nodes
 * - 'nonAsst': matches any point that is NOT an assistant
 * - 'parTrans': matches only parent-child transition nodes
 * - 'sibTrans': matches only sibling transition nodes
 * - 'pres': matches only presentation nodes
 * - 'norm': matches only normal (non-assistant, non-transition) data nodes
 * - 'nonNorm': matches everything except plain data nodes
 *
 * @param point - The point to check
 * @param elementType - The element type filter to match against
 * @returns True if the point matches the filter
 */
export function matchesElementType(point: PointLike, elementType: ST_ElementType): boolean {
  switch (elementType) {
    case 'all':
      return true;
    case 'doc':
      return point.type === 'doc';
    case 'node':
      return point.type === 'node';
    case 'asst':
      return point.type === 'asst';
    case 'nonAsst':
      // NOT an assistant — includes node, doc, parTrans, sibTrans, pres (per ECMA-376)
      return point.type !== 'asst';
    case 'parTrans':
      return point.type === 'parTrans';
    case 'sibTrans':
      return point.type === 'sibTrans';
    case 'pres':
      return point.type === 'pres';
    case 'norm':
      // Normal = node or norm type (excludes doc, asst, transitions, pres)
      // Both 'node' and 'norm' are interchangeable content nodes per ECMA-376.
      return point.type === 'node' || point.type === 'norm';
    case 'nonNorm':
      // Non-normal = everything except node and norm types
      return point.type !== 'node' && point.type !== 'norm';
    default:
      return false;
  }
}
