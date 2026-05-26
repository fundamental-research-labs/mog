/**
 * Ink Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/ink/types.
 */

import type {
  InkPoint,
  InkStroke,
  SerializedPoint,
  SerializedStroke,
  StrokeId,
} from '@mog-sdk/contracts/ink/types';

export function generateStrokeId(): StrokeId {
  const timestamp = Date.now();
  const timestampHex = timestamp.toString(16).padStart(12, '0');

  const randomBytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 10; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const uuid = [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    '7' + hex.slice(0, 3),
    ((parseInt(hex.slice(3, 4), 16) & 0x3) | 0x8).toString(16) + hex.slice(4, 7),
    hex.slice(7, 19),
  ].join('-');

  return uuid as StrokeId;
}

export function isStrokeId(value: unknown): value is StrokeId {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function serializeStroke(stroke: InkStroke): SerializedStroke {
  return {
    id: stroke.id,
    points: stroke.points.map((p: InkPoint): SerializedPoint => {
      const point: SerializedPoint = [p.x, p.y];
      if (p.pressure !== undefined) point[2] = p.pressure;
      if (p.tilt !== undefined) point[3] = p.tilt;
      if (p.timestamp !== undefined) point[4] = p.timestamp;
      return point;
    }),
    tool: stroke.tool,
    color: stroke.color,
    width: stroke.width,
    opacity: stroke.opacity,
    createdBy: stroke.createdBy,
    createdAt: stroke.createdAt,
  };
}

export function deserializeStroke(serialized: SerializedStroke): InkStroke {
  return {
    id: serialized.id,
    points: serialized.points.map(
      (p: SerializedPoint): InkPoint => ({
        x: p[0],
        y: p[1],
        ...(p[2] !== undefined && { pressure: p[2] }),
        ...(p[3] !== undefined && { tilt: p[3] }),
        ...(p[4] !== undefined && { timestamp: p[4] }),
      }),
    ),
    tool: serialized.tool,
    color: serialized.color,
    width: serialized.width,
    opacity: serialized.opacity,
    createdBy: serialized.createdBy,
    createdAt: serialized.createdAt,
  };
}
