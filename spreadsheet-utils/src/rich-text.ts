/**
 * Rich Text Utility Functions
 *
 * Canonical runtime functions for rich text manipulation.
 * Types (RichText, RichTextSegment, TextFormat, CellTextContent) are defined in
 * @mog-sdk/contracts/rich-text.
 *
 */

import type {
  CellTextContent,
  RichText,
  RichTextSegment,
  TextFormat,
} from '@mog-sdk/contracts/rich-text';

/**
 * Check if content is rich text (array of segments).
 * Accepts unknown for use as a type guard on untyped values.
 *
 * @param content - Content to check (can be any value)
 * @returns True if content is RichText array
 */
export function isRichText(content: unknown): content is RichText {
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return false;
  // Check first element has 'text' property (RichTextSegment shape)
  const first = content[0];
  return typeof first === 'object' && first !== null && 'text' in first;
}

/**
 * Check if a RichTextSegment has any formatting applied.
 */
export function hasFormatting(segment: RichTextSegment): boolean {
  if (!segment.format) return false;
  return Object.keys(segment.format).length > 0;
}

/**
 * Check if rich text has any formatting (not just plain text).
 */
export function hasAnyFormatting(richText: RichText): boolean {
  return richText.some(hasFormatting);
}

/**
 * Convert rich text to plain string (for calculations).
 * Strips all formatting and concatenates segment text.
 */
export function toPlainText(content: CellTextContent): string {
  if (typeof content === 'string') return content;
  return content.map((s) => s.text).join('');
}

/**
 * Create rich text from plain string.
 * Returns a single segment with no formatting.
 */
export function fromPlainText(text: string): RichText {
  return [{ text }];
}

/**
 * Normalize rich text by merging adjacent segments with identical formatting.
 */
export function normalizeRichText(richText: RichText): RichText {
  if (richText.length === 0) return [];

  const result: RichTextSegment[] = [];
  let current = { ...richText[0] };

  for (let i = 1; i < richText.length; i++) {
    const segment = richText[i];
    const currentFormatKey = JSON.stringify(current.format ?? {});
    const segmentFormatKey = JSON.stringify(segment.format ?? {});

    if (currentFormatKey === segmentFormatKey) {
      current.text += segment.text;
    } else {
      if (current.text) result.push(current);
      current = { ...segment };
    }
  }

  if (current.text) result.push(current);

  return result;
}

/**
 * Apply formatting to a range within rich text.
 */
export function applyFormat(
  richText: RichText,
  startIndex: number,
  endIndex: number,
  format: Partial<TextFormat>,
): RichText {
  const plainText = toPlainText(richText);

  type CharFormat = Partial<TextFormat> | undefined;
  const charFormats: CharFormat[] = [];

  let charIndex = 0;
  for (const segment of richText) {
    for (let i = 0; i < segment.text.length; i++) {
      charFormats[charIndex++] = segment.format;
    }
  }

  for (let i = startIndex; i < endIndex && i < charFormats.length; i++) {
    charFormats[i] = { ...charFormats[i], ...format };
  }

  const result: RichTextSegment[] = [];
  let currentFormat: CharFormat = charFormats[0];
  let currentText = plainText[0] ?? '';

  for (let i = 1; i < plainText.length; i++) {
    const fmt = charFormats[i];
    const currentKey = JSON.stringify(currentFormat ?? {});
    const fmtKey = JSON.stringify(fmt ?? {});

    if (currentKey === fmtKey) {
      currentText += plainText[i];
    } else {
      if (currentText) {
        result.push({ text: currentText, format: currentFormat });
      }
      currentFormat = fmt;
      currentText = plainText[i];
    }
  }

  if (currentText) {
    result.push({ text: currentText, format: currentFormat });
  }

  return result;
}

/**
 * Get the total length of rich text in characters.
 */
export function getRichTextLength(richText: RichText): number {
  return richText.reduce((sum, segment) => sum + segment.text.length, 0);
}

/**
 * Check if rich text is empty (no content).
 */
export function isEmptyRichText(richText: RichText): boolean {
  return richText.every((segment) => segment.text === '');
}

/**
 * Convert a raw cell value (which may be RichText) to a primitive value.
 */
export function rawToCellValue(
  rawValue: string | number | boolean | null | RichText,
): string | number | boolean | null {
  if (Array.isArray(rawValue)) {
    return toPlainText(rawValue as RichText);
  }
  return rawValue;
}
