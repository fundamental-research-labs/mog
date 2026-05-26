/**
 * Space Layout Algorithm
 *
 * The simplest OOXML layout algorithm. Allocates space as an invisible
 * placeholder but renders nothing. Used between visible nodes for
 * uniform gap distribution.
 *
 * The space algorithm:
 * - Returns an empty shapes array (nothing is rendered)
 * - Returns an empty connectors array
 * - Reports usedBounds matching the resolved constraints (w, h)
 *   or the parent bounds if constraints don't specify dimensions
 *
 * The space algorithm has no parameters (SpaceAlgorithmParams is empty).
 *
 * @see ECMA-376 Part 1, Section 21.4.4.10 (Space Algorithm)
 * @module space
 */

import type { AlgorithmTypeValue } from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type { AlgorithmContext, AlgorithmResult, ILayoutAlgorithm } from './algorithm-types';

// =============================================================================
// Space Algorithm
// =============================================================================

/**
 * Space layout algorithm.
 *
 * Allocates space but renders nothing. The usedBounds reflect the
 * space consumed by this invisible placeholder, as determined by
 * the constraint solver (w and h values).
 *
 * This algorithm is commonly used in linear and snake layouts to
 * create uniform gaps between visible nodes. For example, a layout
 * might alternate [node, space, node, space, node] to distribute
 * spacing evenly.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.10 (Space Algorithm)
 */
export class SpaceAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.sp;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { constraints, bounds } = context;

    // Get width and height from resolved constraints, falling back to bounds
    const width = constraints.values.get('w') ?? bounds.width;
    const height = constraints.values.get('h') ?? bounds.height;

    return {
      shapes: [],
      connectors: [],
      usedBounds: {
        width,
        height,
      },
    };
  }
}

/**
 * Create a new SpaceAlgorithm instance.
 */
export function createSpaceAlgorithm(): SpaceAlgorithm {
  return new SpaceAlgorithm();
}
