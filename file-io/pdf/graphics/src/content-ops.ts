/**
 * ContentOp — TypeScript mirror of the Rust ContentOp enum.
 *
 * These represent individual PDF content stream operators. PdfCanvas builds
 * a buffer of these ops, then flushes them to Rust via IpcBridge.
 *
 * The discriminated union uses `op` as the tag field.
 */

export type ContentOp =
  // Graphics state
  | { op: 'SaveState' }
  | { op: 'RestoreState' }

  // Coordinate transforms (cm operator)
  | { op: 'ConcatMatrix'; a: number; b: number; c: number; d: number; tx: number; ty: number }

  // Path construction
  | { op: 'MoveTo'; x: number; y: number }
  | { op: 'LineTo'; x: number; y: number }
  | { op: 'CurveTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Rectangle'; x: number; y: number; w: number; h: number }
  | { op: 'ClosePath' }

  // Path painting
  | { op: 'Fill' }
  | { op: 'Stroke' }
  | { op: 'FillAndStroke' }

  // Clipping
  | { op: 'ClipNonZero' }

  // Color
  | { op: 'SetFillColorRGB'; r: number; g: number; b: number }
  | { op: 'SetStrokeColorRGB'; r: number; g: number; b: number }

  // Line style
  | { op: 'SetLineWidth'; width: number }
  | { op: 'SetLineDash'; segments: number[]; phase: number }
  | { op: 'SetLineCap'; cap: number }
  | { op: 'SetLineJoin'; join: number }

  // Transparency (ExtGState)
  | { op: 'SetFillAlpha'; alpha: number }
  | { op: 'SetStrokeAlpha'; alpha: number }

  // Text
  | { op: 'BeginText' }
  | { op: 'EndText' }
  | { op: 'SetFont'; name: string; size: number }
  | { op: 'TextPosition'; x: number; y: number }
  | { op: 'TextMatrix'; a: number; b: number; c: number; d: number; tx: number; ty: number }
  | { op: 'ShowText'; bytes: number[] }
  | { op: 'SetTextFillColor'; r: number; g: number; b: number }
  | { op: 'SetTextRenderMode'; mode: number }

  // Images
  | { op: 'DrawImage'; data: number[]; format: string; x: number; y: number; w: number; h: number };

/**
 * Map line cap string to PDF integer value.
 * PDF spec: 0 = butt, 1 = round, 2 = projecting square
 */
export function lineCapToInt(cap: 'butt' | 'round' | 'square'): number {
  switch (cap) {
    case 'butt':
      return 0;
    case 'round':
      return 1;
    case 'square':
      return 2;
  }
}

/**
 * Map line join string to PDF integer value.
 * PDF spec: 0 = miter, 1 = round, 2 = bevel
 */
export function lineJoinToInt(join: 'miter' | 'round' | 'bevel'): number {
  switch (join) {
    case 'miter':
      return 0;
    case 'round':
      return 1;
    case 'bevel':
      return 2;
  }
}
