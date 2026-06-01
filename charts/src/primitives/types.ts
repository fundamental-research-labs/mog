/**
 * Mark primitive types for the chart rendering engine.
 *
 * The bridge contract owns the canonical renderable mark IR so browser
 * rendering, kernel caches, and Node image export share one shape.
 */

import type { ChartMark } from '@mog-sdk/contracts/bridges';

export type AnyMark = ChartMark;
export type Mark = ChartMark;
export type RectMark = Extract<AnyMark, { type: 'rect' }>;
export type PathMark = Extract<AnyMark, { type: 'path' }>;
export type ArcMark = Extract<AnyMark, { type: 'arc' }>;
export type TextMark = Extract<AnyMark, { type: 'text' }>;
export type SymbolMark = Extract<AnyMark, { type: 'symbol' }>;

export type MarkStyle = AnyMark['style'];
export type MarkClip = NonNullable<AnyMark['clip']>;
export type PaintSpec = NonNullable<MarkStyle['fillPaint']>;
export type LineStyleSpec = NonNullable<MarkStyle['line']>;
export type ShadowSpec = NonNullable<MarkStyle['shadow']>;
export type EffectSpec = NonNullable<MarkStyle['effects']>;
export type TextRunSpec = NonNullable<TextMark['richText']>[number];
export type TextAlign = TextMark['textAlign'];
export type TextBaseline = TextMark['textBaseline'];
export type SymbolShape = SymbolMark['shape'];
