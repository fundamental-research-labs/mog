/**
 * Rich Text Rendering Utility
 *
 * Shared logic for rendering rich text blocks with per-run inline formatting,
 * word wrapping, vertical alignment, underline, and strikethrough. Used by
 * both the textbox and shape renderers.
 *
 * @module @mog/drawing-canvas/renderers/rich-text
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { Rect } from '@mog/canvas-engine';
import type { TextRun } from '../scene/types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_FONT_SIZE = 13;
const DEFAULT_FONT_FAMILY = 'Inter, sans-serif';
const DEFAULT_TEXT_COLOR = '#1e293b';

// =============================================================================
// Types
// =============================================================================

export interface RichTextAlignment {
  readonly horizontal?: 'left' | 'center' | 'right';
  readonly vertical?: 'top' | 'middle' | 'bottom';
}

/** A wrapped line composed of segments, each with its own styling. */
interface WrappedLineSegment {
  readonly text: string;
  readonly run: TextRun;
}

interface WrappedLine {
  readonly segments: WrappedLineSegment[];
  readonly width: number;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Render a rich text block within the given bounds.
 *
 * Supports per-run font, size, bold, italic, color, underline, and
 * strikethrough. Falls back to plain text rendering when no richText runs
 * are provided.
 */
export function renderRichTextBlock(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  text: string,
  richText: ReadonlyArray<TextRun> | undefined,
  alignment: RichTextAlignment,
  textMeasurer: TextMeasurer | null,
): void {
  if (bounds.width <= 0 || bounds.height <= 0) return;

  ctx.save();

  // Clip text to bounds
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();

  ctx.textBaseline = 'top';

  const runs = richText && richText.length > 0 ? richText : [{ text } as TextRun];

  // Wrap runs into lines
  const { lines, lineHeight } = wrapRichTextRuns(ctx, runs, text, bounds.width, textMeasurer);
  const totalHeight = lines.length * lineHeight;

  // Vertical alignment
  let startY = bounds.y;
  const vAlign = alignment.vertical ?? 'top';
  if (vAlign === 'middle') {
    startY = bounds.y + (bounds.height - totalHeight) / 2;
  } else if (vAlign === 'bottom') {
    startY = bounds.y + bounds.height - totalHeight;
  }

  // Render each line
  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;

    // Skip lines outside visible area
    if (lineY + lineHeight < bounds.y || lineY > bounds.y + bounds.height) {
      continue;
    }

    renderLine(ctx, lines[i], bounds.x, lineY, lineHeight, bounds.width, alignment.horizontal);
  }

  ctx.restore();
}

// =============================================================================
// Line Wrapping
// =============================================================================

/**
 * Wrap rich text runs into lines that fit within maxWidth.
 *
 * Each run may have its own font/size, so we measure segments individually
 * and break across runs when a line exceeds the available width.
 */
function wrapRichTextRuns(
  ctx: CanvasRenderingContext2D,
  runs: ReadonlyArray<TextRun>,
  plainText: string,
  maxWidth: number,
  textMeasurer: TextMeasurer | null,
): { lines: WrappedLine[]; lineHeight: number } {
  // Determine a representative line height from the largest font in the runs
  let maxFontSize = 0;
  for (const run of runs) {
    const size = run.fontSize ?? DEFAULT_FONT_SIZE;
    if (size > maxFontSize) maxFontSize = size;
  }
  const lineHeight = maxFontSize * 1.3;

  // If there is only one run (or no richText), use simpler single-style wrapping
  if (runs.length <= 1) {
    const run = runs[0] ?? ({ text: plainText } as TextRun);
    const font = buildFontString(run);
    const textToWrap = run.text || plainText;
    const wrappedLines = wrapSingleStyleText(ctx, textToWrap, font, maxWidth, textMeasurer);
    const lines: WrappedLine[] = wrappedLines.map((lineText) => {
      ctx.font = font;
      return {
        segments: [{ text: lineText, run }],
        width: ctx.measureText(lineText).width,
      };
    });
    return { lines, lineHeight };
  }

  // Multi-run wrapping: break the concatenated text into words, track which
  // run each character belongs to, then wrap word by word.
  return wrapMultiRunText(ctx, runs, maxWidth, lineHeight);
}

/**
 * Wrap text with a single font style using TextMeasurer or canvas fallback.
 */
function wrapSingleStyleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number,
  textMeasurer: TextMeasurer | null,
): string[] {
  if (textMeasurer) {
    const result = textMeasurer.measureWrappedText(text, font, maxWidth);
    return result.lines as string[];
  }

  ctx.font = font;
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  if (lines.length === 0) {
    lines.push('');
  }

  return lines;
}

/**
 * Multi-run word wrapping. Splits runs into word-level tokens, each tagged
 * with its source run, and wraps them into lines that fit maxWidth.
 */
function wrapMultiRunText(
  ctx: CanvasRenderingContext2D,
  runs: ReadonlyArray<TextRun>,
  maxWidth: number,
  lineHeight: number,
): { lines: WrappedLine[]; lineHeight: number } {
  // Build word tokens from runs, preserving run association
  interface WordToken {
    word: string;
    run: TextRun;
    /** Whether this token should be preceded by a space when appended */
    leadingSpace: boolean;
    /** Whether this token represents a newline break */
    isNewline: boolean;
  }

  const tokens: WordToken[] = [];

  for (const run of runs) {
    const runText = run.text;
    // Split on newlines first, then words
    const paragraphs = runText.split('\n');
    for (let p = 0; p < paragraphs.length; p++) {
      if (p > 0) {
        tokens.push({ word: '', run, leadingSpace: false, isNewline: true });
      }
      const words = paragraphs[p].split(/(\s+)/);
      let needSpace = tokens.length > 0 && !tokens[tokens.length - 1]?.isNewline;
      for (const segment of words) {
        if (/^\s+$/.test(segment)) {
          needSpace = true;
          continue;
        }
        if (segment === '') continue;
        tokens.push({ word: segment, run, leadingSpace: needSpace, isNewline: false });
        needSpace = false;
      }
    }
  }

  const lines: WrappedLine[] = [];
  let currentSegments: WrappedLineSegment[] = [];
  let currentWidth = 0;

  function flushLine(): void {
    lines.push({ segments: [...currentSegments], width: currentWidth });
    currentSegments = [];
    currentWidth = 0;
  }

  for (const token of tokens) {
    if (token.isNewline) {
      flushLine();
      continue;
    }

    const font = buildFontString(token.run);
    ctx.font = font;

    const wordText =
      token.leadingSpace && currentSegments.length > 0 ? ' ' + token.word : token.word;
    const wordWidth = ctx.measureText(wordText).width;

    if (currentWidth + wordWidth > maxWidth && currentSegments.length > 0) {
      flushLine();
      // Re-measure without leading space after line break
      const cleanText = token.word;
      const cleanWidth = ctx.measureText(cleanText).width;
      currentSegments.push({ text: cleanText, run: token.run });
      currentWidth = cleanWidth;
    } else {
      currentSegments.push({ text: wordText, run: token.run });
      currentWidth += wordWidth;
    }
  }

  // Flush remaining segments
  if (currentSegments.length > 0) {
    flushLine();
  }

  if (lines.length === 0) {
    lines.push({ segments: [], width: 0 });
  }

  return { lines, lineHeight };
}

// =============================================================================
// Line Rendering
// =============================================================================

/**
 * Render a single wrapped line, segment by segment, applying per-run styling.
 */
function renderLine(
  ctx: CanvasRenderingContext2D,
  line: WrappedLine,
  areaX: number,
  lineY: number,
  lineHeight: number,
  maxWidth: number,
  hAlign: 'left' | 'center' | 'right' | undefined,
): void {
  // Compute starting X based on horizontal alignment
  let x = areaX;
  if (hAlign === 'center') {
    x = areaX + (maxWidth - line.width) / 2;
  } else if (hAlign === 'right') {
    x = areaX + maxWidth - line.width;
  }

  for (const segment of line.segments) {
    if (!segment.text) continue;

    const font = buildFontString(segment.run);
    const color = segment.run.color ?? DEFAULT_TEXT_COLOR;

    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(segment.text, x, lineY);

    const segWidth = ctx.measureText(segment.text).width;

    // Underline
    if (segment.run.underline) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const underlineY = lineY + lineHeight - 2;
      ctx.beginPath();
      ctx.moveTo(x, underlineY);
      ctx.lineTo(x + segWidth, underlineY);
      ctx.stroke();
    }

    // Strikethrough
    if (segment.run.strikethrough) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const strikeY = lineY + lineHeight / 2;
      ctx.beginPath();
      ctx.moveTo(x, strikeY);
      ctx.lineTo(x + segWidth, strikeY);
      ctx.stroke();
    }

    x += segWidth;
  }
}

// =============================================================================
// Font Helper
// =============================================================================

/**
 * Build a CSS font string from a TextRun, falling back to defaults.
 */
export function buildFontString(run: TextRun | undefined): string {
  const fontSize = run?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = run?.font ?? DEFAULT_FONT_FAMILY;
  const fontWeight = run?.bold ? 'bold' : 'normal';
  const fontStyle = run?.italic ? 'italic' : 'normal';
  return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
}
