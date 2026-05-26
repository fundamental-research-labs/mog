/**
 * Text layout — word wrapping and measurement for single-string and rich text.
 *
 * Uses the scaffold AFM metrics. Will benefit transparently from
 * real TrueType metrics since it measures via FontHandle.
 */

import type { FontHandle, TextMeasurement, TextRun } from '../types';
import {
  createScaffoldFont,
  FONT_METRICS,
  measureTextWidth,
  resolveFontForRun,
} from './afm-metrics';

/**
 * Wrap a single string into lines that fit within maxWidth.
 *
 * @returns Array of line strings
 */
export function wrapText(text: string, font: FontHandle, size: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;

  for (const word of words) {
    if (word.length === 0) continue;

    const wordWidth = measureTextWidth(word, font, size);

    if (currentLine === '') {
      // First word on a line — always add it even if it exceeds maxWidth
      currentLine = word;
      currentWidth = wordWidth;
    } else if (currentWidth + wordWidth <= maxWidth) {
      currentLine += word;
      currentWidth += wordWidth;
    } else {
      // Word doesn't fit — start a new line
      // Trim trailing whitespace from the current line
      lines.push(currentLine.trimEnd());
      // If the word is just whitespace, skip it at line start
      if (word.trim().length === 0) {
        currentLine = '';
        currentWidth = 0;
      } else {
        currentLine = word;
        currentWidth = wordWidth;
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.trimEnd());
  }

  if (lines.length === 0) {
    lines.push('');
  }

  return lines;
}

/**
 * Measure the dimensions of a single string, possibly multi-line.
 */
export function measureSingleText(
  text: string,
  font: FontHandle,
  size: number,
  maxWidth: number,
  lineHeight: number,
): { width: number; height: number; lines: string[] } {
  const lines = wrapText(text, font, size, maxWidth);
  let maxLineWidth = 0;

  for (const line of lines) {
    const w = measureTextWidth(line, font, size);
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const height = lines.length * lineHeight;

  return { width: maxLineWidth, height, lines };
}

/**
 * Measure a block of TextRuns with word wrapping.
 *
 * Flattens the runs into words, measures each word per its run's font/size,
 * then performs line-breaking at maxWidth.
 */
export function measureTextRuns(
  runs: TextRun[],
  maxWidth: number,
  baseFont?: FontHandle,
  baseFontSize?: number,
): TextMeasurement {
  const defaultFont = baseFont ?? createScaffoldFont();
  const defaultSize = baseFontSize ?? 12;

  // Tokenize runs into measurable word segments
  interface WordSegment {
    text: string;
    font: FontHandle;
    size: number;
    width: number;
    run: TextRun;
    isWhitespace: boolean;
  }

  const segments: WordSegment[] = [];

  for (const run of runs) {
    const font = resolveFontForRun(run, defaultFont);
    let size = run.size ?? defaultSize;

    // Superscript/subscript: 0.7x size
    if (run.superscript || run.subscript) {
      size = size * 0.7;
    }

    // Split the run text into words (preserving whitespace)
    const parts = run.text.split(/(\s+)/);

    for (const part of parts) {
      if (part.length === 0) continue;
      const isWhitespace = /^\s+$/.test(part);
      const width = measureTextWidth(part, font, size);
      segments.push({ text: part, font, size, width, run, isWhitespace });
    }
  }

  // Line-breaking
  interface LineState {
    width: number;
    runs: TextRun[];
  }

  const lines: LineState[] = [];
  let currentLine: LineState = { width: 0, runs: [] };
  let currentRunText = '';
  let currentRunTemplate: TextRun | null = null;

  function flushCurrentRun(): void {
    if (currentRunText.length > 0 && currentRunTemplate) {
      currentLine.runs.push({ ...currentRunTemplate, text: currentRunText });
      currentRunText = '';
    }
  }

  function startNewLine(): void {
    flushCurrentRun();
    // Trim trailing whitespace from last run on the line
    if (currentLine.runs.length > 0) {
      const lastRun = currentLine.runs[currentLine.runs.length - 1];
      lastRun.text = lastRun.text.trimEnd();
      // Recalculate line width
      let size = lastRun.size ?? defaultSize;
      if (lastRun.superscript || lastRun.subscript) size = size * 0.7;
      // We need to recalculate the entire line width
      let w = 0;
      for (const r of currentLine.runs) {
        const rf = resolveFontForRun(r, defaultFont);
        let rs = r.size ?? defaultSize;
        if (r.superscript || r.subscript) rs = rs * 0.7;
        w += measureTextWidth(r.text, rf, rs);
      }
      currentLine.width = w;
    }
    lines.push(currentLine);
    currentLine = { width: 0, runs: [] };
  }

  for (const seg of segments) {
    // Check if run changed
    if (currentRunTemplate !== seg.run) {
      flushCurrentRun();
      currentRunTemplate = seg.run;
    }

    if (
      maxWidth > 0 &&
      currentLine.width + seg.width > maxWidth &&
      !seg.isWhitespace &&
      currentLine.width > 0
    ) {
      startNewLine();
      currentRunTemplate = seg.run;
    }

    if (seg.isWhitespace && currentLine.width === 0 && currentLine.runs.length === 0) {
      // Skip leading whitespace at start of a line
      continue;
    }

    currentRunText += seg.text;
    currentLine.width += seg.width;
  }

  // Flush remaining
  flushCurrentRun();
  if (currentLine.runs.length > 0 || lines.length === 0) {
    lines.push(currentLine);
  }

  // Calculate totals
  let totalWidth = 0;
  for (const line of lines) {
    if (line.width > totalWidth) totalWidth = line.width;
  }

  // Use the base font size for lineHeight calculation
  const lineHeight = defaultSize * 1.2; // Reasonable default
  const totalHeight = lines.length * lineHeight;

  return {
    width: totalWidth,
    height: totalHeight,
    lines: lines.map((l) => ({ width: l.width, runs: l.runs })),
  };
}

/**
 * Compute the X offset for horizontal alignment.
 */
export function computeAlignmentX(
  lineWidth: number,
  containerWidth: number,
  halign: 'left' | 'center' | 'right' | 'justify' | 'distributed',
): number {
  switch (halign) {
    case 'center':
      return (containerWidth - lineWidth) / 2;
    case 'right':
      return containerWidth - lineWidth;
    case 'left':
    case 'justify':
    case 'distributed':
    default:
      return 0;
  }
}

/**
 * Compute the Y offset for vertical alignment of a text block.
 */
export function computeAlignmentY(
  blockHeight: number,
  containerHeight: number,
  valign: 'top' | 'middle' | 'bottom',
): number {
  switch (valign) {
    case 'middle':
      return (containerHeight - blockHeight) / 2;
    case 'bottom':
      return containerHeight - blockHeight;
    case 'top':
    default:
      return 0;
  }
}

/**
 * Get the ascender height in points for the given font size.
 * SCAFFOLD: Uses AFM metrics constants.
 */
export function getAscender(size: number): number {
  return (FONT_METRICS.ascender / 1000) * size;
}

/**
 * Get the descender depth in points for the given font size (negative value).
 * SCAFFOLD: Uses AFM metrics constants.
 */
export function getDescender(size: number): number {
  return (FONT_METRICS.descender / 1000) * size;
}

/**
 * Get the x-height in points for the given font size.
 * SCAFFOLD: Uses AFM metrics constants.
 */
export function getXHeight(size: number): number {
  return (FONT_METRICS.xHeight / 1000) * size;
}
