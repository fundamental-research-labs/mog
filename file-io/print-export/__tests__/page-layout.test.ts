/**
 * PageLayout Unit Tests
 */

import {
  DEFAULT_PAGE_SETUP,
  DEFAULT_PRINT_OPTIONS,
  HEADER_FOOTER_PLACEHOLDERS,
  type PageSetup,
} from '../src/contracts/types';
import { PageLayout, pageLayout, type PlaceholderContext } from '../src/html/page-layout';

describe('PageLayout', () => {
  let layout: PageLayout;

  beforeEach(() => {
    layout = new PageLayout();
  });

  describe('substitutePlaceholders', () => {
    const context: PlaceholderContext = {
      pageNumber: 3,
      totalPages: 10,
      sheetName: 'Sales Data',
      fileName: 'report.xlsx',
    };

    it('should substitute page number placeholder', () => {
      const text = 'Page &[Page]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toBe('Page 3');
    });

    it('should substitute total pages placeholder', () => {
      const text = 'Page &[Page] of &[Pages]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toBe('Page 3 of 10');
    });

    it('should substitute date placeholder', () => {
      const text = 'Printed: &[Date]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toContain('Printed: ');
      // Date format varies by locale, just check it's not empty
      expect(result.length).toBeGreaterThan('Printed: '.length);
    });

    it('should substitute time placeholder', () => {
      const text = 'Time: &[Time]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toContain('Time: ');
      // Time format varies by locale
      expect(result.length).toBeGreaterThan('Time: '.length);
    });

    it('should substitute file name placeholder', () => {
      const text = 'File: &[File]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toBe('File: report.xlsx');
    });

    it('should substitute sheet name placeholder', () => {
      const text = 'Sheet: &[Sheet]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toBe('Sheet: Sales Data');
    });

    it('should handle multiple placeholders', () => {
      const text = '&[Sheet] - Page &[Page] of &[Pages]';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toBe('Sales Data - Page 3 of 10');
    });

    it('should handle missing file name', () => {
      const contextNoFile: PlaceholderContext = {
        ...context,
        fileName: undefined,
      };
      const text = 'File: &[File]';
      const result = layout.substitutePlaceholders(text, contextNoFile);
      expect(result).toBe('File: ');
    });

    it('should handle empty text', () => {
      const result = layout.substitutePlaceholders('', context);
      expect(result).toBe('');
    });

    it('should handle text with no placeholders', () => {
      const text = 'Plain text';
      const result = layout.substitutePlaceholders(text, context);
      expect(result).toBe('Plain text');
    });
  });

  describe('formatDate', () => {
    it('should format with custom format string', () => {
      const result = layout.formatDate('YYYY-MM-DD');
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(result).toBe(expected);
    });

    it('should support MM/DD/YYYY format', () => {
      const result = layout.formatDate('MM/DD/YYYY');
      expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });

    it('should support short year format', () => {
      const result = layout.formatDate('M/D/YY');
      expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);
    });

    it('should use locale date when no format provided', () => {
      const result = layout.formatDate();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatTime', () => {
    it('should return formatted time', () => {
      const result = layout.formatTime();
      expect(result.length).toBeGreaterThan(0);
      // Should contain time separator (: or .)
      expect(result).toMatch(/[:.]/);
    });
  });

  describe('renderHeaderFooter', () => {
    const context: PlaceholderContext = {
      pageNumber: 1,
      totalPages: 5,
      sheetName: 'TestSheet',
    };

    it('should render all three sections', () => {
      const section = {
        left: 'Left',
        center: 'Center',
        right: 'Right',
      };

      const result = layout.renderHeaderFooter(section, context);

      expect(result.left).toBe('Left');
      expect(result.center).toBe('Center');
      expect(result.right).toBe('Right');
    });

    it('should render with placeholders substituted', () => {
      const section = {
        left: 'Page &[Page]',
        center: '&[Sheet]',
        right: '&[Pages] pages',
      };

      const result = layout.renderHeaderFooter(section, context);

      expect(result.left).toBe('Page 1');
      expect(result.center).toBe('TestSheet');
      expect(result.right).toBe('5 pages');
    });

    it('should handle undefined sections', () => {
      const section = {
        center: 'Only center',
      };

      const result = layout.renderHeaderFooter(section, context);

      expect(result.left).toBe('');
      expect(result.center).toBe('Only center');
      expect(result.right).toBe('');
    });

    it('should return empty strings for undefined section object', () => {
      const result = layout.renderHeaderFooter(undefined, context);

      expect(result.left).toBe('');
      expect(result.center).toBe('');
      expect(result.right).toBe('');
    });

    it('should escape HTML in content', () => {
      const section = {
        center: '<script>alert("xss")</script>',
      };

      const result = layout.renderHeaderFooter(section, context);

      expect(result.center).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
  });

  describe('generateHeaderHTML', () => {
    const context: PlaceholderContext = {
      pageNumber: 1,
      totalPages: 5,
      sheetName: 'TestSheet',
    };

    it('should generate header HTML with all sections', () => {
      const pageSetup: PageSetup = {
        header: {
          left: 'Left',
          center: 'Center',
          right: 'Right',
        },
      };

      const html = layout.generateHeaderHTML(pageSetup, context);

      expect(html).toContain('class="page-header"');
      expect(html).toContain('class="page-header-left"');
      expect(html).toContain('class="page-header-center"');
      expect(html).toContain('class="page-header-right"');
      expect(html).toContain('Left');
      expect(html).toContain('Center');
      expect(html).toContain('Right');
    });

    it('should return empty string when no header defined', () => {
      const pageSetup: PageSetup = {};
      const html = layout.generateHeaderHTML(pageSetup, context);
      expect(html).toBe('');
    });

    it('should return empty string when all sections empty', () => {
      const pageSetup: PageSetup = {
        header: {},
      };
      const html = layout.generateHeaderHTML(pageSetup, context);
      expect(html).toBe('');
    });

    it('should generate header with placeholders substituted', () => {
      const pageSetup: PageSetup = {
        header: DEFAULT_PAGE_SETUP.header,
      };

      const html = layout.generateHeaderHTML(pageSetup, context);

      expect(html).toContain('TestSheet');
    });
  });

  describe('generateFooterHTML', () => {
    const context: PlaceholderContext = {
      pageNumber: 2,
      totalPages: 5,
      sheetName: 'TestSheet',
    };

    it('should generate footer HTML with all sections', () => {
      const pageSetup: PageSetup = {
        footer: {
          left: 'Left',
          center: 'Center',
          right: 'Right',
        },
      };

      const html = layout.generateFooterHTML(pageSetup, context);

      expect(html).toContain('class="page-footer"');
      expect(html).toContain('class="page-footer-left"');
      expect(html).toContain('class="page-footer-center"');
      expect(html).toContain('class="page-footer-right"');
    });

    it('should generate footer with page numbers', () => {
      const pageSetup: PageSetup = {
        footer: DEFAULT_PAGE_SETUP.footer,
      };

      const html = layout.generateFooterHTML(pageSetup, context);

      expect(html).toContain('Page 2 of 5');
    });

    it('should return empty string when no footer defined', () => {
      const pageSetup: PageSetup = {};
      const html = layout.generateFooterHTML(pageSetup, context);
      expect(html).toBe('');
    });
  });

  describe('generatePageLayoutCSS', () => {
    it('should generate page container styles', () => {
      const css = layout.generatePageLayoutCSS(DEFAULT_PRINT_OPTIONS);

      expect(css).toContain('.page-container');
      expect(css).toContain('page-break-after');
    });

    it('should generate header styles when header defined', () => {
      const pageSetup: PageSetup = {
        header: { center: 'Header' },
      };

      const css = layout.generatePageLayoutCSS(DEFAULT_PRINT_OPTIONS, pageSetup);

      expect(css).toContain('.page-header');
      expect(css).toContain('.page-header-left');
      expect(css).toContain('.page-header-center');
      expect(css).toContain('.page-header-right');
    });

    it('should generate footer styles when footer defined', () => {
      const pageSetup: PageSetup = {
        footer: { center: 'Footer' },
      };

      const css = layout.generatePageLayoutCSS(DEFAULT_PRINT_OPTIONS, pageSetup);

      expect(css).toContain('.page-footer');
      expect(css).toContain('.page-footer-left');
      expect(css).toContain('.page-footer-center');
      expect(css).toContain('.page-footer-right');
    });

    it('should include print media query', () => {
      const css = layout.generatePageLayoutCSS(DEFAULT_PRINT_OPTIONS);

      expect(css).toContain('@media print');
    });
  });

  describe('wrapPageContent', () => {
    it('should wrap content with header and footer', () => {
      const pageSetup: PageSetup = {
        header: { center: 'Header' },
        footer: { center: 'Footer' },
      };

      const context: PlaceholderContext = {
        pageNumber: 1,
        totalPages: 1,
        sheetName: 'Sheet1',
      };

      const html = layout.wrapPageContent({
        printOptions: DEFAULT_PRINT_OPTIONS,
        pageSetup,
        context,
        content: '<p>Content</p>',
      });

      expect(html).toContain('class="page-container"');
      expect(html).toContain('class="page-header"');
      expect(html).toContain('Header');
      expect(html).toContain('class="page-content"');
      expect(html).toContain('<p>Content</p>');
      expect(html).toContain('class="page-footer"');
      expect(html).toContain('Footer');
    });

    it('should work without header/footer', () => {
      const context: PlaceholderContext = {
        pageNumber: 1,
        totalPages: 1,
        sheetName: 'Sheet1',
      };

      const html = layout.wrapPageContent({
        printOptions: DEFAULT_PRINT_OPTIONS,
        pageSetup: undefined,
        context,
        content: '<p>Content</p>',
      });

      expect(html).toContain('class="page-container"');
      expect(html).toContain('class="page-content"');
      expect(html).toContain('<p>Content</p>');
      expect(html).not.toContain('class="page-header"');
      expect(html).not.toContain('class="page-footer"');
    });
  });

  describe('generateMultiPageDocument', () => {
    it('should generate complete HTML document', () => {
      const pages = [
        { content: '<table>Page 1</table>', pageNumber: 1 },
        { content: '<table>Page 2</table>', pageNumber: 2 },
      ];

      const html = layout.generateMultiPageDocument(
        pages,
        DEFAULT_PRINT_OPTIONS,
        DEFAULT_PAGE_SETUP,
        'TestSheet',
        'test.xlsx',
      );

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<title>TestSheet</title>');
      expect(html).toContain('<style>');
      expect(html).toContain('<body>');
      expect(html).toContain('Page 1</table>');
      expect(html).toContain('Page 2</table>');
      expect(html).toContain('</body>');
      expect(html).toContain('</html>');
    });

    it('should use title from pageSetup when provided', () => {
      const pageSetup: PageSetup = {
        title: 'Custom Title',
      };

      const html = layout.generateMultiPageDocument(
        [{ content: '', pageNumber: 1 }],
        DEFAULT_PRINT_OPTIONS,
        pageSetup,
        'SheetName',
      );

      expect(html).toContain('<title>Custom Title</title>');
    });

    it('should escape title in HTML', () => {
      const pageSetup: PageSetup = {
        title: '<script>alert("xss")</script>',
      };

      const html = layout.generateMultiPageDocument(
        [{ content: '', pageNumber: 1 }],
        DEFAULT_PRINT_OPTIONS,
        pageSetup,
        'SheetName',
      );

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('should generate correct page numbers in headers/footers', () => {
      const pageSetup: PageSetup = {
        footer: { center: 'Page &[Page] of &[Pages]' },
      };

      const pages = [
        { content: 'P1', pageNumber: 1 },
        { content: 'P2', pageNumber: 2 },
        { content: 'P3', pageNumber: 3 },
      ];

      const html = layout.generateMultiPageDocument(
        pages,
        DEFAULT_PRINT_OPTIONS,
        pageSetup,
        'Sheet',
      );

      expect(html).toContain('Page 1 of 3');
      expect(html).toContain('Page 2 of 3');
      expect(html).toContain('Page 3 of 3');
    });
  });

  describe('parseExcelHeaderFooter', () => {
    it('should parse left section', () => {
      const result = layout.parseExcelHeaderFooter('&LLeft Text');
      expect(result.left).toBe('Left Text');
    });

    it('should parse center section', () => {
      const result = layout.parseExcelHeaderFooter('&CCenter Text');
      expect(result.center).toBe('Center Text');
    });

    it('should parse right section', () => {
      const result = layout.parseExcelHeaderFooter('&RRight Text');
      expect(result.right).toBe('Right Text');
    });

    it('should parse all sections', () => {
      const result = layout.parseExcelHeaderFooter('&LLeft&CCenter&RRight');
      expect(result.left).toBe('Left');
      expect(result.center).toBe('Center');
      expect(result.right).toBe('Right');
    });

    it('should handle text without section markers as center', () => {
      const result = layout.parseExcelHeaderFooter('Plain text');
      expect(result.center).toBe('Plain text');
    });

    it('should handle case-insensitive markers', () => {
      const result = layout.parseExcelHeaderFooter('&lLower&cCase&rTest');
      expect(result.left).toBe('Lower');
      expect(result.center).toBe('Case');
      expect(result.right).toBe('Test');
    });
  });

  describe('convertExcelCodes', () => {
    it('should convert &P to page placeholder', () => {
      const result = layout.convertExcelCodes('Page &P');
      expect(result).toBe(`Page ${HEADER_FOOTER_PLACEHOLDERS.PAGE}`);
    });

    it('should convert &N to pages placeholder', () => {
      const result = layout.convertExcelCodes('of &N');
      expect(result).toBe(`of ${HEADER_FOOTER_PLACEHOLDERS.PAGES}`);
    });

    it('should convert &D to date placeholder', () => {
      const result = layout.convertExcelCodes('Date: &D');
      expect(result).toBe(`Date: ${HEADER_FOOTER_PLACEHOLDERS.DATE}`);
    });

    it('should convert &T to time placeholder', () => {
      const result = layout.convertExcelCodes('Time: &T');
      expect(result).toBe(`Time: ${HEADER_FOOTER_PLACEHOLDERS.TIME}`);
    });

    it('should convert &F to file placeholder', () => {
      const result = layout.convertExcelCodes('File: &F');
      expect(result).toBe(`File: ${HEADER_FOOTER_PLACEHOLDERS.FILE}`);
    });

    it('should convert &A to sheet placeholder', () => {
      const result = layout.convertExcelCodes('Sheet: &A');
      expect(result).toBe(`Sheet: ${HEADER_FOOTER_PLACEHOLDERS.SHEET}`);
    });

    it('should handle multiple codes', () => {
      const result = layout.convertExcelCodes('&A - Page &P of &N');
      expect(result).toBe(
        `${HEADER_FOOTER_PLACEHOLDERS.SHEET} - Page ${HEADER_FOOTER_PLACEHOLDERS.PAGE} of ${HEADER_FOOTER_PLACEHOLDERS.PAGES}`,
      );
    });

    it('should handle case-insensitive codes', () => {
      const result = layout.convertExcelCodes('&p &n');
      expect(result).toBe(`${HEADER_FOOTER_PLACEHOLDERS.PAGE} ${HEADER_FOOTER_PLACEHOLDERS.PAGES}`);
    });

    it('should handle empty string', () => {
      const result = layout.convertExcelCodes('');
      expect(result).toBe('');
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(pageLayout).toBeInstanceOf(PageLayout);
    });
  });
});
