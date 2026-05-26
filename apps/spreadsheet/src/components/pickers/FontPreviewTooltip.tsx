/**
 * FontPreviewTooltip Component
 *
 * WYSIWYG preview tooltip shown when hovering over fonts in FontPicker.
 * Displays sample text rendered in the hovered font.
 *
 * Non-Latin fonts show samples in their native script.
 * Enhanced CJK detection using font categories.
 *
 * Migrated to use Popover primitive for positioning.
 */

import { CJK_FONTS } from '../../infra/styles/fonts';
import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell/components/ui';

interface FontPreviewTooltipProps {
  /** The font family to preview */
  fontFamily: string;
  /** Position relative to the font item */
  position: { top: number; left: number };
  /** Whether the tooltip is visible */
  visible: boolean;
}

/**
 * Default preview text for Latin fonts.
 * Includes both uppercase and lowercase for better font evaluation.
 */
const DEFAULT_PREVIEW_TEXT = 'AaBbCcDdEeFf';

/**
 * Gets appropriate preview text for a font based on its category.
 * CJK and symbol fonts show samples in their native script.
 *
 * Enhanced detection using font category arrays for better accuracy.
 *
 * @param fontFamily - The font family name
 * @returns Preview text appropriate for the font
 */
function getPreviewTextForFont(fontFamily: string): string {
  // Check if font is in CJK_FONTS list (most reliable method)
  if (CJK_FONTS.includes(fontFamily as (typeof CJK_FONTS)[number])) {
    // Detect language from font name patterns
    const lowerName = fontFamily.toLowerCase();

    // Japanese fonts (Hiragana/Katakana mixed with Kanji)
    if (/gothic|mincho|meiryo|hiragino|yu\s/i.test(fontFamily)) {
      return '\u65E5\u672C\u8A9E\u30D5\u30A9\u30F3\u30C8'; // 日本語フォント (Japanese Font)
    }

    // Korean fonts (Hangul)
    if (/malgun|gulim|dotum|batang|nanum/i.test(fontFamily)) {
      return '\uD55C\uAE00 \uAE00\uAF34'; // 한글 글꼴 (Korean Font)
    }

    // Chinese Simplified fonts (Simplified characters)
    if (lowerName.includes('sim') || lowerName.includes('yahei') || lowerName.includes('hei')) {
      return '\u4E2D\u6587\u5B57\u4F53'; // 中文字体 (Chinese Font - Simplified)
    }

    // Chinese Traditional fonts (Traditional characters)
    if (/ming|pming|dfkai/i.test(fontFamily)) {
      return '\u4E2D\u6587\u5B57\u9AD4'; // 中文字體 (Chinese Font - Traditional)
    }

    // Fallback to generic Chinese for unrecognized CJK fonts
    return '\u4E2D\u6587\u5B57\u4F53'; // 中文字体
  }

  // Symbol/Wingdings fonts
  if (/symbol|wingding|webding|dingbat|marlett/i.test(fontFamily)) {
    return '\u2605 \u261E \u260E \u273F \u266B'; // ★ ☞ ☎ ✿ ♫
  }

  // Default for Latin fonts
  return DEFAULT_PREVIEW_TEXT;
}

export function FontPreviewTooltip({ fontFamily, position, visible }: FontPreviewTooltipProps) {
  const previewText = getPreviewTextForFont(fontFamily);

  return (
    <Popover open={visible} onOpenChange={() => {}}>
      <PopoverAnchor virtualRef={{ current: createVirtualRef(position.left, position.top) }} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        shadow="lg"
        rounded="default"
        closeOnClickOutside={false}
        closeOnEscape={false}
        closeOnScroll={false}
        width="auto"
        role="tooltip"
        aria-label={`Font preview for ${fontFamily}`}
        className="px-3 py-2 pointer-events-none"
      >
        <span
          className="text-text whitespace-nowrap"
          style={{
            fontFamily: `"${fontFamily}", sans-serif`,
            fontSize: '24px',
            lineHeight: 1.2,
          }}
        >
          {previewText}
        </span>
      </PopoverContent>
    </Popover>
  );
}
