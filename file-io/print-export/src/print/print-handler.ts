/**
 * PrintHandler - Handle browser print functionality
 *
 * Creates a hidden iframe with print content, injects HTML/CSS,
 * triggers print dialog, and cleans up.
 *
 * Uses PaginationEngine from @mog/pdf-layout for page break
 * calculation, ensuring browser print and PDF export produce the
 * same page breaks.
 */

import type { ContentMeasurer, PageSetupInput } from '@mog/pdf-layout';
import { PaginationEngine } from '@mog/pdf-layout';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import type {
  PageInfo,
  PageLayoutResult,
  PageSetup,
  PrintArea,
  PrintOptions,
  PrintRange,
  PrintResult,
} from '../contracts/types';
import { PAPER_SIZES, inchesToPixels } from '../contracts/types';
import { PageLayout, pageLayout } from '../html/page-layout';
import { StyleGenerator, styleGenerator } from '../html/style-generator';
import type { ITableDataProvider, TableGeneratorOptions } from '../html/table-generator';
import { TableGenerator, tableGenerator } from '../html/table-generator';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for print operation
 */
export interface PrintHandlerOptions {
  /** Data provider for cell data */
  dataProvider: ITableDataProvider;

  /** Print options */
  printOptions?: Partial<PrintOptions>;

  /** Page setup (headers, footers) */
  pageSetup?: PageSetup;

  /** Print areas (defaults to current sheet, used range) */
  areas?: PrintArea[];

  /** Sheet ID to print (if no areas specified) */
  sheetId: string;

  /** File name for header/footer placeholders */
  fileName?: string;

  /** Callback when print dialog opens */
  onPrintDialogOpen?: () => void;

  /** Callback when print dialog closes (may not fire in all browsers) */
  onPrintDialogClose?: () => void;

  /**
   * Header visibility configuration for dynamic header dimensions.
   * Controls whether row/column headers are visible and their dimensions.
   * If not provided, defaults to using showHeaders from printOptions.
   */
  headerVisibility?: HeaderVisibility;
}

/**
 * Default print options
 */
const DEFAULT_OPTIONS: PrintOptions = {
  paperSize: 'letter',
  orientation: 'portrait',
  margins: {
    top: 0.75,
    right: 0.7,
    bottom: 0.75,
    left: 0.7,
  },
  scale: 1.0,
  showGridlines: true,
  showHeaders: false,
  center: {
    horizontal: false,
    vertical: false,
  },
};

/**
 * Default page setup
 */
const DEFAULT_SETUP: PageSetup = {
  header: {
    center: '&[Sheet]',
  },
  footer: {
    center: 'Page &[Page] of &[Pages]',
  },
};

// ============================================================================
// PrintHandler
// ============================================================================

export class PrintHandler {
  private tableGen: TableGenerator;
  private pageLayoutGen: PageLayout;
  private styleGen: StyleGenerator;
  private paginationEngine: PaginationEngine;

  constructor(
    tableGen: TableGenerator = tableGenerator,
    pageLayoutGen: PageLayout = pageLayout,
    styleGen: StyleGenerator = styleGenerator,
  ) {
    this.tableGen = tableGen;
    this.pageLayoutGen = pageLayoutGen;
    this.styleGen = styleGen;
    this.paginationEngine = new PaginationEngine();
  }

  /**
   * Open browser print dialog with spreadsheet content
   */
  async print(options: PrintHandlerOptions): Promise<PrintResult> {
    const startTime = performance.now();
    let cellsRendered = 0;
    let pagesGenerated = 0;

    try {
      // Merge options with defaults
      const printOptions: PrintOptions = {
        ...DEFAULT_OPTIONS,
        ...options.printOptions,
      };
      const pageSetup = options.pageSetup ?? DEFAULT_SETUP;

      // Determine print areas
      const areas = options.areas ?? [{ sheetId: options.sheetId }];
      // Generate HTML content for all pages
      const allPagesHtml: string[] = [];
      let totalPages = 0;

      for (const area of areas) {
        const layout = await this.calculateLayoutWithEngine(
          options.dataProvider,
          printOptions,
          pageSetup,
          area,
        );

        totalPages += layout.pageCount;
      }

      // Now generate content with correct total page count
      let currentPage = 1;

      for (const area of areas) {
        const layout = await this.calculateLayoutWithEngine(
          options.dataProvider,
          printOptions,
          pageSetup,
          area,
        );

        const sheetName = await options.dataProvider.getSheetName(area.sheetId);

        for (const page of layout.pages) {
          // Generate table for this page's range
          const tableOptions: TableGeneratorOptions = {
            sheetId: area.sheetId,
            range: {
              startRow: page.rowRange[0],
              startCol: page.colRange[0],
              endRow: page.rowRange[1],
              endCol: page.colRange[1],
            },
            printOptions,
            includeColumnWidths: true,
            includeRowHeights: true,
            headerVisibility: options.headerVisibility,
          };

          const tableResult = await this.tableGen.generate(options.dataProvider, tableOptions);
          cellsRendered += tableResult.stats.cellsWithContent;

          // Wrap with header/footer
          const wrappedContent = this.pageLayoutGen.wrapPageContent({
            printOptions,
            pageSetup,
            context: {
              pageNumber: currentPage,
              totalPages,
              sheetName,
              fileName: options.fileName,
              dateFormat: pageSetup.dateFormat,
            },
            content: tableResult.html,
          });

          allPagesHtml.push(wrappedContent);
          currentPage++;
        }

        pagesGenerated += layout.pageCount;
      }

      // Generate complete document
      const sheetName = await options.dataProvider.getSheetName(areas[0].sheetId);
      const documentHtml = this.generatePrintDocument(
        allPagesHtml,
        printOptions,
        pageSetup,
        sheetName,
        options.headerVisibility,
      );

      // Create and print iframe
      await this.printViaIframe(documentHtml, options);

      const endTime = performance.now();

      return {
        success: true,
        stats: {
          pagesGenerated,
          cellsRendered,
          timeMs: Math.round(endTime - startTime),
        },
      };
    } catch (error) {
      const endTime = performance.now();
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Print failed',
        stats: {
          pagesGenerated,
          cellsRendered,
          timeMs: Math.round(endTime - startTime),
        },
      };
    }
  }

  /**
   * Calculate layout using PaginationEngine.
   *
   * Bridges the old-style print inputs (ITableDataProvider, PrintOptions,
   * PageSetup, PrintArea) to the PaginationEngine interface, ensuring
   * browser print and PDF export produce identical page breaks.
   *
   * All dimensions are in pixels at 96 DPI (matching ITableDataProvider).
   * The PaginationEngine is unit-agnostic; it just does math on the dimensions.
   */
  async calculateLayoutWithEngine(
    dataProvider: ITableDataProvider,
    printOptions: PrintOptions,
    pageSetup: PageSetup | undefined,
    area: PrintArea,
  ): Promise<PageLayoutResult> {
    // Get the range to print
    const range = area.range ?? (await dataProvider.getUsedRange(area.sheetId));

    if (!range) {
      return {
        pageCount: 0,
        pageSize: { width: 0, height: 0 },
        printableArea: { width: 0, height: 0 },
        pages: [],
      };
    }

    // Convert print options to PageSetupInput (pixel space at 96 DPI)
    const setupInput = this.buildPageSetupInput(printOptions, pageSetup, range, area);

    // Build ContentMeasurer from ITableDataProvider
    const measurer = this.buildContentMeasurer(dataProvider, area.sheetId);

    // Run PaginationEngine
    const plan = this.paginationEngine.calculateLayout(measurer, setupInput);

    // Convert PaginationPlan -> PageLayoutResult (old-style output)
    const pages: PageInfo[] = plan.pages.map((pageSlice) => ({
      pageNumber: pageSlice.pageNumber,
      sheetId: area.sheetId,
      rowRange: [pageSlice.rowRange[0], pageSlice.rowRange[1]],
      colRange: [pageSlice.colRange[0], pageSlice.colRange[1]],
    }));

    // Get page dimensions for output
    let paperWidth: number;
    let paperHeight: number;
    if (printOptions.paperSize === 'custom' && printOptions.customSize) {
      paperWidth = printOptions.customSize.width;
      paperHeight = printOptions.customSize.height;
    } else {
      const size =
        PAPER_SIZES[printOptions.paperSize as keyof typeof PAPER_SIZES] || PAPER_SIZES.letter;
      paperWidth = size.width;
      paperHeight = size.height;
    }
    if (printOptions.orientation === 'landscape') {
      [paperWidth, paperHeight] = [paperHeight, paperWidth];
    }
    const pageWidth = inchesToPixels(paperWidth);
    const pageHeight = inchesToPixels(paperHeight);
    const { margins } = printOptions;
    const printableWidth = pageWidth - inchesToPixels(margins.left + margins.right);
    const printableHeight = pageHeight - inchesToPixels(margins.top + margins.bottom);

    return {
      pageCount: pages.length,
      pageSize: { width: pageWidth, height: pageHeight },
      printableArea: { width: printableWidth, height: printableHeight },
      pages,
    };
  }

  /**
   * Build PageSetupInput from print options (in pixel coordinate space).
   */
  private buildPageSetupInput(
    printOptions: PrintOptions,
    pageSetup: PageSetup | undefined,
    range: PrintRange,
    area: PrintArea,
  ): PageSetupInput {
    // Paper dimensions in inches
    let paperWidth: number;
    let paperHeight: number;
    if (printOptions.paperSize === 'custom' && printOptions.customSize) {
      paperWidth = printOptions.customSize.width;
      paperHeight = printOptions.customSize.height;
    } else {
      const size =
        PAPER_SIZES[printOptions.paperSize as keyof typeof PAPER_SIZES] || PAPER_SIZES.letter;
      paperWidth = size.width;
      paperHeight = size.height;
    }
    if (printOptions.orientation === 'landscape') {
      [paperWidth, paperHeight] = [paperHeight, paperWidth];
    }

    // Convert to pixels (96 DPI) to match ITableDataProvider coordinate space
    const pageWidthPx = inchesToPixels(paperWidth);
    const pageHeightPx = inchesToPixels(paperHeight);
    const { margins } = printOptions;

    return {
      pageWidth: pageWidthPx,
      pageHeight: pageHeightPx,
      margins: {
        top: inchesToPixels(margins.top),
        bottom: inchesToPixels(margins.bottom),
        left: inchesToPixels(margins.left),
        right: inchesToPixels(margins.right),
        header: 0,
        footer: 0,
      },
      orientation: printOptions.orientation,
      scale: printOptions.scale,
      fitTo: printOptions.fitTo,
      repeatRows: pageSetup?.repeatRows,
      repeatCols: pageSetup?.repeatCols,
      centerHorizontal: printOptions.center.horizontal,
      centerVertical: printOptions.center.vertical,
      printArea: {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.endCol,
      },
      rowPageBreaks: area.rowPageBreaks,
      colPageBreaks: area.colPageBreaks,
    };
  }

  /**
   * Build a ContentMeasurer from ITableDataProvider.
   */
  private buildContentMeasurer(dataProvider: ITableDataProvider, sheetId: string): ContentMeasurer {
    return {
      getRowHeight: (row) => dataProvider.getRowHeight(sheetId, row),
      getColumnWidth: (col) => dataProvider.getColumnWidth(sheetId, col),
      getMergedRegions: () => dataProvider.getMergedRegions?.(sheetId) ?? [],
      isRowHidden: (row) => dataProvider.isRowHidden?.(sheetId, row) ?? false,
      isColHidden: (col) => dataProvider.isColHidden?.(sheetId, col) ?? false,
    };
  }

  /**
   * Generate a complete HTML document for printing
   */
  generatePrintDocument(
    pagesHtml: string[],
    printOptions: PrintOptions,
    pageSetup: PageSetup,
    title: string,
    headerVisibility?: HeaderVisibility,
  ): string {
    const tableCSS = this.styleGen.generatePrintStylesheet(printOptions, headerVisibility);
    const pageLayoutCSS = this.pageLayoutGen.generatePageLayoutCSS(printOptions, pageSetup);

    // Additional print-specific styles
    const printCSS = this.generatePrintCSS(printOptions);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
${tableCSS}
${pageLayoutCSS}
${printCSS}
  </style>
</head>
<body>
${pagesHtml.join('\n')}
</body>
</html>`;
  }

  /**
   * Generate print-specific CSS
   */
  private generatePrintCSS(printOptions: PrintOptions): string {
    const { margins, orientation, paperSize, center } = printOptions;

    // Get paper dimensions
    let paperWidth = '8.5in';
    let paperHeight = '11in';

    switch (paperSize) {
      case 'letter':
        paperWidth = '8.5in';
        paperHeight = '11in';
        break;
      case 'legal':
        paperWidth = '8.5in';
        paperHeight = '14in';
        break;
      case 'a4':
        paperWidth = '210mm';
        paperHeight = '297mm';
        break;
      case 'a3':
        paperWidth = '297mm';
        paperHeight = '420mm';
        break;
      case 'custom':
        if (printOptions.customSize) {
          paperWidth = `${printOptions.customSize.width}in`;
          paperHeight = `${printOptions.customSize.height}in`;
        }
        break;
    }

    // Swap for landscape
    if (orientation === 'landscape') {
      [paperWidth, paperHeight] = [paperHeight, paperWidth];
    }

    return `
/* Print-specific styles */
@media print {
  @page {
    size: ${paperWidth} ${paperHeight} ${orientation};
    margin: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in;
  }

  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: Arial, sans-serif;
    font-size: 10pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page-container {
    page-break-after: always;
    ${center.horizontal ? 'display: flex; justify-content: center;' : ''}
    ${center.vertical ? 'align-items: center; min-height: 100vh;' : ''}
  }

  .page-container:last-child {
    page-break-after: auto;
  }

  .page-content {
    width: 100%;
  }

  /* Ensure tables don't break across pages */
  table {
    page-break-inside: auto;
  }

  tr {
    page-break-inside: avoid;
    page-break-after: auto;
  }

  thead {
    display: table-header-group;
  }

  tfoot {
    display: table-footer-group;
  }
}

/* Screen preview styles */
@media screen {
  body {
    background: #f5f5f5;
    margin: 0;
    padding: 20px;
    font-family: Arial, sans-serif;
  }

  .page-container {
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin: 0 auto 20px;
    padding: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in;
    width: calc(${paperWidth} - ${margins.left}in - ${margins.right}in);
    min-height: calc(${paperHeight} - ${margins.top}in - ${margins.bottom}in);
    box-sizing: content-box;
  }
}
`;
  }

  /**
   * Print via hidden iframe
   */
  private async printViaIframe(html: string, options: PrintHandlerOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';

      // Handle load event
      iframe.onload = () => {
        try {
          const iframeWindow = iframe.contentWindow;
          if (!iframeWindow) {
            throw new Error('Could not access iframe window');
          }

          // Write content to iframe
          const doc = iframeWindow.document;
          doc.open();
          doc.write(html);
          doc.close();

          // Wait for content to render
          setTimeout(() => {
            try {
              options.onPrintDialogOpen?.();

              // Focus iframe and print
              iframeWindow.focus();
              iframeWindow.print();

              // Clean up after print dialog
              // Note: We cannot reliably detect when print dialog closes
              // So we use a timeout as a fallback
              setTimeout(() => {
                options.onPrintDialogClose?.();
                document.body.removeChild(iframe);
                resolve();
              }, 1000);
            } catch (printError) {
              document.body.removeChild(iframe);
              reject(printError);
            }
          }, 100);
        } catch (error) {
          document.body.removeChild(iframe);
          reject(error);
        }
      };

      iframe.onerror = () => {
        document.body.removeChild(iframe);
        reject(new Error('Failed to create print iframe'));
      };

      // Add iframe to document
      document.body.appendChild(iframe);
    });
  }

  /**
   * Generate print preview HTML (for display in a modal or new window)
   */
  async generatePreview(options: PrintHandlerOptions): Promise<string> {
    const printOptions: PrintOptions = {
      ...DEFAULT_OPTIONS,
      ...options.printOptions,
    };
    const pageSetup = options.pageSetup ?? DEFAULT_SETUP;
    const areas = options.areas ?? [{ sheetId: options.sheetId }];

    const allPagesHtml: string[] = [];
    let totalPages = 0;

    // Calculate total pages first
    for (const area of areas) {
      const layout = await this.calculateLayoutWithEngine(
        options.dataProvider,
        printOptions,
        pageSetup,
        area,
      );
      totalPages += layout.pageCount;
    }

    // Generate content
    let currentPage = 1;

    for (const area of areas) {
      const layout = await this.calculateLayoutWithEngine(
        options.dataProvider,
        printOptions,
        pageSetup,
        area,
      );

      const sheetName = await options.dataProvider.getSheetName(area.sheetId);

      for (const page of layout.pages) {
        const tableOptions: TableGeneratorOptions = {
          sheetId: area.sheetId,
          range: {
            startRow: page.rowRange[0],
            startCol: page.colRange[0],
            endRow: page.rowRange[1],
            endCol: page.colRange[1],
          },
          printOptions,
          includeColumnWidths: true,
          includeRowHeights: true,
          headerVisibility: options.headerVisibility,
        };

        const tableResult = await this.tableGen.generate(options.dataProvider, tableOptions);

        const wrappedContent = this.pageLayoutGen.wrapPageContent({
          printOptions,
          pageSetup,
          context: {
            pageNumber: currentPage,
            totalPages,
            sheetName,
            fileName: options.fileName,
            dateFormat: pageSetup.dateFormat,
          },
          content: tableResult.html,
        });

        allPagesHtml.push(wrappedContent);
        currentPage++;
      }
    }

    const sheetName = await options.dataProvider.getSheetName(areas[0].sheetId);
    return this.generatePrintDocument(
      allPagesHtml,
      printOptions,
      pageSetup,
      sheetName,
      options.headerVisibility,
    );
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
}

/**
 * Singleton instance
 */
export const printHandler = new PrintHandler();
