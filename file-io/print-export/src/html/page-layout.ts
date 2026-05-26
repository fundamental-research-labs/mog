/**
 * PageLayout - Generate headers, footers, and page layout HTML/CSS
 *
 * Handles header/footer generation with placeholder substitution
 * and page layout styling.
 */

import type { HeaderFooterSection, PageSetup, PrintOptions } from '../contracts/types';
import { HEADER_FOOTER_PLACEHOLDERS } from '../contracts/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Context for placeholder substitution
 */
export interface PlaceholderContext {
  /** Current page number */
  pageNumber: number;
  /** Total number of pages */
  totalPages: number;
  /** Sheet name */
  sheetName: string;
  /** File name (optional) */
  fileName?: string;
  /** Date format string (default: locale date) */
  dateFormat?: string;
}

/**
 * Rendered header/footer content
 */
export interface RenderedHeaderFooter {
  /** Left section content (HTML) */
  left: string;
  /** Center section content (HTML) */
  center: string;
  /** Right section content (HTML) */
  right: string;
}

/**
 * Page content wrapper options
 */
export interface PageWrapperOptions {
  /** Print options */
  printOptions: PrintOptions;
  /** Page setup */
  pageSetup?: PageSetup;
  /** Placeholder context */
  context: PlaceholderContext;
  /** Page content HTML */
  content: string;
}

// ============================================================================
// PageLayout
// ============================================================================

export class PageLayout {
  /**
   * Substitute placeholders in a text string
   */
  substitutePlaceholders(text: string, context: PlaceholderContext): string {
    if (!text) return '';

    let result = text;

    // Page number
    result = result.replace(
      new RegExp(this.escapeRegex(HEADER_FOOTER_PLACEHOLDERS.PAGE), 'g'),
      String(context.pageNumber),
    );

    // Total pages
    result = result.replace(
      new RegExp(this.escapeRegex(HEADER_FOOTER_PLACEHOLDERS.PAGES), 'g'),
      String(context.totalPages),
    );

    // Date
    result = result.replace(
      new RegExp(this.escapeRegex(HEADER_FOOTER_PLACEHOLDERS.DATE), 'g'),
      this.formatDate(context.dateFormat),
    );

    // Time
    result = result.replace(
      new RegExp(this.escapeRegex(HEADER_FOOTER_PLACEHOLDERS.TIME), 'g'),
      this.formatTime(),
    );

    // File name
    result = result.replace(
      new RegExp(this.escapeRegex(HEADER_FOOTER_PLACEHOLDERS.FILE), 'g'),
      context.fileName ?? '',
    );

    // Sheet name
    result = result.replace(
      new RegExp(this.escapeRegex(HEADER_FOOTER_PLACEHOLDERS.SHEET), 'g'),
      context.sheetName,
    );

    return result;
  }

  /**
   * Render a header or footer section
   */
  renderHeaderFooter(
    section: HeaderFooterSection | undefined,
    context: PlaceholderContext,
  ): RenderedHeaderFooter {
    if (!section) {
      return { left: '', center: '', right: '' };
    }

    return {
      left: this.escapeHtml(this.substitutePlaceholders(section.left ?? '', context)),
      center: this.escapeHtml(this.substitutePlaceholders(section.center ?? '', context)),
      right: this.escapeHtml(this.substitutePlaceholders(section.right ?? '', context)),
    };
  }

  /**
   * Generate CSS for page layout (headers, footers, margins)
   */
  generatePageLayoutCSS(_printOptions: PrintOptions, pageSetup?: PageSetup): string {
    const css: string[] = [];

    // Page container styles
    css.push(`
      .page-container {
        position: relative;
        width: 100%;
        min-height: 100%;
        box-sizing: border-box;
        page-break-after: always;
        page-break-inside: avoid;
      }

      .page-container:last-child {
        page-break-after: auto;
      }
    `);

    // Header styles
    if (pageSetup?.header) {
      css.push(`
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 0 8px 0;
          margin-bottom: 8px;
          border-bottom: 1px solid #ccc;
          font-size: 9pt;
          color: #666;
        }

        .page-header-left {
          text-align: left;
          flex: 1;
        }

        .page-header-center {
          text-align: center;
          flex: 1;
        }

        .page-header-right {
          text-align: right;
          flex: 1;
        }
      `);
    }

    // Footer styles
    if (pageSetup?.footer) {
      css.push(`
        .page-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0 0 0;
          margin-top: 8px;
          border-top: 1px solid #ccc;
          font-size: 9pt;
          color: #666;
        }

        .page-footer-left {
          text-align: left;
          flex: 1;
        }

        .page-footer-center {
          text-align: center;
          flex: 1;
        }

        .page-footer-right {
          text-align: right;
          flex: 1;
        }
      `);
    }

    // Print-specific styles
    css.push(`
      @media print {
        .page-header {
          position: running(header);
        }

        .page-footer {
          position: running(footer);
        }

        @page {
          @top-center {
            content: element(header);
          }
          @bottom-center {
            content: element(footer);
          }
        }
      }
    `);

    return css.join('\n');
  }

  /**
   * Generate HTML for page header
   */
  generateHeaderHTML(pageSetup: PageSetup | undefined, context: PlaceholderContext): string {
    if (!pageSetup?.header) {
      return '';
    }

    const rendered = this.renderHeaderFooter(pageSetup.header, context);

    // Only generate if at least one section has content
    if (!rendered.left && !rendered.center && !rendered.right) {
      return '';
    }

    return `<div class="page-header">
  <div class="page-header-left">${rendered.left}</div>
  <div class="page-header-center">${rendered.center}</div>
  <div class="page-header-right">${rendered.right}</div>
</div>`;
  }

  /**
   * Generate HTML for page footer
   */
  generateFooterHTML(pageSetup: PageSetup | undefined, context: PlaceholderContext): string {
    if (!pageSetup?.footer) {
      return '';
    }

    const rendered = this.renderHeaderFooter(pageSetup.footer, context);

    // Only generate if at least one section has content
    if (!rendered.left && !rendered.center && !rendered.right) {
      return '';
    }

    return `<div class="page-footer">
  <div class="page-footer-left">${rendered.left}</div>
  <div class="page-footer-center">${rendered.center}</div>
  <div class="page-footer-right">${rendered.right}</div>
</div>`;
  }

  /**
   * Wrap page content with header/footer
   */
  wrapPageContent(options: PageWrapperOptions): string {
    const { pageSetup, context, content } = options;

    const header = this.generateHeaderHTML(pageSetup, context);
    const footer = this.generateFooterHTML(pageSetup, context);

    return `<div class="page-container">
${header}
<div class="page-content">
${content}
</div>
${footer}
</div>`;
  }

  /**
   * Generate complete multi-page document HTML
   */
  generateMultiPageDocument(
    pages: Array<{ content: string; pageNumber: number }>,
    printOptions: PrintOptions,
    pageSetup: PageSetup | undefined,
    sheetName: string,
    fileName?: string,
  ): string {
    const totalPages = pages.length;
    const wrappedPages: string[] = [];

    for (const page of pages) {
      const context: PlaceholderContext = {
        pageNumber: page.pageNumber,
        totalPages,
        sheetName,
        fileName,
        dateFormat: pageSetup?.dateFormat,
      };

      wrappedPages.push(
        this.wrapPageContent({
          printOptions,
          pageSetup,
          context,
          content: page.content,
        }),
      );
    }

    const css = this.generatePageLayoutCSS(printOptions, pageSetup);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(pageSetup?.title ?? sheetName)}</title>
  <style>
${css}
  </style>
</head>
<body>
${wrappedPages.join('\n')}
</body>
</html>`;
  }

  /**
   * Format current date
   */
  formatDate(format?: string): string {
    const now = new Date();

    if (format) {
      // Simple format string support
      return format
        .replace('YYYY', String(now.getFullYear()))
        .replace('YY', String(now.getFullYear()).slice(-2))
        .replace('MM', String(now.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(now.getDate()).padStart(2, '0'))
        .replace('M', String(now.getMonth() + 1))
        .replace('D', String(now.getDate()));
    }

    // Default to locale date string
    return now.toLocaleDateString();
  }

  /**
   * Format current time
   */
  formatTime(): string {
    const now = new Date();
    return now.toLocaleTimeString();
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(str: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return str.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
  }

  /**
   * Escape string for use in regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Parse header/footer text with Excel-style codes
   * Excel uses &L, &C, &R for left/center/right sections
   */
  parseExcelHeaderFooter(text: string): HeaderFooterSection {
    const result: HeaderFooterSection = {};

    // Split by section markers
    const leftMatch = text.match(/&L([^&]*)/i);
    const centerMatch = text.match(/&C([^&]*)/i);
    const rightMatch = text.match(/&R([^&]*)/i);

    if (leftMatch) result.left = leftMatch[1].trim();
    if (centerMatch) result.center = centerMatch[1].trim();
    if (rightMatch) result.right = rightMatch[1].trim();

    // If no section markers, treat entire text as center
    if (!leftMatch && !centerMatch && !rightMatch) {
      result.center = text;
    }

    return result;
  }

  /**
   * Convert Excel header/footer codes to our placeholder format
   * Excel uses &P for page, &N for total pages, &D for date, &T for time
   */
  convertExcelCodes(text: string): string {
    if (!text) return '';

    return text
      .replace(/&P/gi, HEADER_FOOTER_PLACEHOLDERS.PAGE)
      .replace(/&N/gi, HEADER_FOOTER_PLACEHOLDERS.PAGES)
      .replace(/&D/gi, HEADER_FOOTER_PLACEHOLDERS.DATE)
      .replace(/&T/gi, HEADER_FOOTER_PLACEHOLDERS.TIME)
      .replace(/&F/gi, HEADER_FOOTER_PLACEHOLDERS.FILE)
      .replace(/&A/gi, HEADER_FOOTER_PLACEHOLDERS.SHEET);
  }
}

/**
 * Singleton instance
 */
export const pageLayout = new PageLayout();
