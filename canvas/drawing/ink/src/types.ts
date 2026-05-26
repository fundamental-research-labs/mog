/**
 * Shared ink engine types.
 *
 * Extracted from stroke.ts to break the stroke.ts ↔ intersection.ts
 * import cycle. Pure type declarations: no runtime, no dependencies
 * beyond geometry/ink type imports from contracts.
 */
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';

/**
 * A point in a stroke with pressure and timestamp metadata.
 */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
  /** Pen pressure normalized to [0, 1]. 0.5 default for mouse. */
  readonly pressure: number;
  /** Timestamp in ms (relative to stroke start or absolute). */
  readonly timestamp: number;
}

/**
 * A complete stroke with rendering properties.
 */
export interface Stroke {
  readonly id: StrokeId;
  readonly points: readonly StrokePoint[];
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly bounds: BoundingBox;
}
