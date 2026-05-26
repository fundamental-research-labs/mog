#!/usr/bin/env node
/**
 * Fluent UI Icon Extraction Script
 *
 * Extracts Fluent UI icons from GitHub and saves them as standalone SVGs.
 * Fluent icon extraction helper.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, 'src');

// Fluent icon mapping: { exportName: { fluentName, size, category } }
// fluentName is the folder name in the GitHub repo (with spaces)
// size is 16 or 20 (the source size we'll download)
const FLUENT_ICONS = {
  // Text Formatting
  TextBold16Regular: {
    fluentName: 'Text Bold',
    size: 16,
    category: 'text-formatting',
    fileName: 'bold',
  },
  TextItalic16Regular: {
    fluentName: 'Text Italic',
    size: 16,
    category: 'text-formatting',
    fileName: 'italic',
  },
  TextUnderline16Regular: {
    fluentName: 'Text Underline',
    size: 16,
    category: 'text-formatting',
    fileName: 'underline',
  },
  TextStrikethrough16Regular: {
    fluentName: 'Text Strikethrough',
    size: 16,
    category: 'text-formatting',
    fileName: 'strikethrough',
  },
  TextT16Regular: { fluentName: 'Text T', size: 16, category: 'text-formatting', fileName: 'font' },
  ClearFormatting16Regular: {
    fluentName: 'Clear Formatting',
    size: 16,
    category: 'text-formatting',
    fileName: 'clear-formatting',
  },

  // Alignment - Horizontal
  TextAlignLeft16Regular: {
    fluentName: 'Text Align Left',
    size: 16,
    category: 'alignment',
    fileName: 'align-left',
  },
  TextAlignCenter16Regular: {
    fluentName: 'Text Align Center',
    size: 16,
    category: 'alignment',
    fileName: 'align-center',
  },
  TextAlignRight16Regular: {
    fluentName: 'Text Align Right',
    size: 16,
    category: 'alignment',
    fileName: 'align-right',
  },

  // Alignment - Vertical
  AlignTop16Regular: {
    fluentName: 'Align Top',
    size: 16,
    category: 'alignment',
    fileName: 'align-top',
  },
  AlignCenterVertical16Regular: {
    fluentName: 'Align Center Vertical',
    size: 16,
    category: 'alignment',
    fileName: 'align-middle',
  },
  AlignBottom16Regular: {
    fluentName: 'Align Bottom',
    size: 16,
    category: 'alignment',
    fileName: 'align-bottom',
  },

  // Text Wrap
  TextWrap16Regular: {
    fluentName: 'Text Wrap',
    size: 16,
    category: 'alignment',
    fileName: 'text-wrap',
  },

  // Clipboard
  Cut16Regular: { fluentName: 'Cut', size: 16, category: 'clipboard', fileName: 'cut' },
  Copy16Regular: { fluentName: 'Copy', size: 16, category: 'clipboard', fileName: 'copy' },
  ClipboardPaste16Regular: {
    fluentName: 'Clipboard Paste',
    size: 16,
    category: 'clipboard',
    fileName: 'paste',
  },

  // Borders
  BorderAll16Regular: {
    fluentName: 'Border All',
    size: 16,
    category: 'borders',
    fileName: 'border-all',
  },
  BorderTop20Regular: {
    fluentName: 'Border Top',
    size: 20,
    category: 'borders',
    fileName: 'border-top',
  },
  BorderBottom20Regular: {
    fluentName: 'Border Bottom',
    size: 20,
    category: 'borders',
    fileName: 'border-bottom',
  },
  BorderLeft20Regular: {
    fluentName: 'Border Left',
    size: 20,
    category: 'borders',
    fileName: 'border-left',
  },
  BorderRight20Regular: {
    fluentName: 'Border Right',
    size: 20,
    category: 'borders',
    fileName: 'border-right',
  },
  BorderNone16Regular: {
    fluentName: 'Border None',
    size: 16,
    category: 'borders',
    fileName: 'border-none',
  },
  BorderOutside20Regular: {
    fluentName: 'Border Outside',
    size: 20,
    category: 'borders',
    fileName: 'border-outside',
  },

  // Undo/Redo
  ArrowUndo16Regular: {
    fluentName: 'Arrow Undo',
    size: 16,
    category: 'navigation',
    fileName: 'undo',
  },
  ArrowRedo16Regular: {
    fluentName: 'Arrow Redo',
    size: 16,
    category: 'navigation',
    fileName: 'redo',
  },

  // Navigation/Arrows
  ArrowUp16Regular: {
    fluentName: 'Arrow Up',
    size: 16,
    category: 'navigation',
    fileName: 'arrow-up',
  },
  ArrowDown16Regular: {
    fluentName: 'Arrow Down',
    size: 16,
    category: 'navigation',
    fileName: 'arrow-down',
  },
  ArrowLeft16Regular: {
    fluentName: 'Arrow Left',
    size: 16,
    category: 'navigation',
    fileName: 'arrow-left',
  },
  ArrowRight16Regular: {
    fluentName: 'Arrow Right',
    size: 16,
    category: 'navigation',
    fileName: 'arrow-right',
  },
  ChevronDown16Regular: {
    fluentName: 'Chevron Down',
    size: 16,
    category: 'ui',
    fileName: 'chevron-down',
  },
  ChevronRight16Regular: {
    fluentName: 'Chevron Right',
    size: 16,
    category: 'ui',
    fileName: 'chevron-right',
  },

  // File Operations
  ArrowDownload16Regular: {
    fluentName: 'Arrow Download',
    size: 16,
    category: 'file-operations',
    fileName: 'download',
  },
  Print16Regular: { fluentName: 'Print', size: 16, category: 'file-operations', fileName: 'print' },
  DocumentPdf16Regular: {
    fluentName: 'Document Pdf',
    size: 16,
    category: 'file-operations',
    fileName: 'pdf',
  },

  // Data/Tables
  TableAdd16Regular: {
    fluentName: 'Table Add',
    size: 16,
    category: 'data-tables',
    fileName: 'table-add',
  },
  TableEdit16Regular: {
    fluentName: 'Table Edit',
    size: 16,
    category: 'data-tables',
    fileName: 'table-edit',
  },
  TableDismiss16Regular: {
    fluentName: 'Table Dismiss',
    size: 16,
    category: 'data-tables',
    fileName: 'table-dismiss',
  },
  TableCellsMerge16Regular: {
    fluentName: 'Table Cells Merge',
    size: 16,
    category: 'data-tables',
    fileName: 'cells-merge',
  },
  TableCellsSplit16Regular: {
    fluentName: 'Table Cells Split',
    size: 16,
    category: 'data-tables',
    fileName: 'cells-split',
  },
  TableDeleteRow16Regular: {
    fluentName: 'Table Delete Row',
    size: 16,
    category: 'data-tables',
    fileName: 'delete-row',
  },
  TableDeleteColumn16Regular: {
    fluentName: 'Table Delete Column',
    size: 16,
    category: 'data-tables',
    fileName: 'delete-column',
  },
  TableInsertRowRegular: {
    fluentName: 'Table Insert Row',
    size: 16,
    category: 'data-tables',
    fileName: 'insert-row',
  },
  TableInsertColumnRegular: {
    fluentName: 'Table Insert Column',
    size: 16,
    category: 'data-tables',
    fileName: 'insert-column',
  },
  TableFreezeRow16Regular: {
    fluentName: 'Table Freeze Row',
    size: 16,
    category: 'data-tables',
    fileName: 'freeze-row',
  },
  Grid16Regular: { fluentName: 'Grid', size: 16, category: 'data-tables', fileName: 'grid' },

  // Sort & Filter
  ArrowSortUp16Regular: {
    fluentName: 'Arrow Sort Up',
    size: 16,
    category: 'sort-filter',
    fileName: 'sort-ascending',
  },
  ArrowSortDown16Regular: {
    fluentName: 'Arrow Sort Down',
    size: 16,
    category: 'sort-filter',
    fileName: 'sort-descending',
  },
  Filter16Regular: { fluentName: 'Filter', size: 16, category: 'sort-filter', fileName: 'filter' },

  // Formulas
  MathFormula16Regular: {
    fluentName: 'Math Formula',
    size: 16,
    category: 'formulas',
    fileName: 'formula',
  },
  NumberSymbol16Regular: {
    fluentName: 'Number Symbol',
    size: 16,
    category: 'formulas',
    fileName: 'number',
  },

  // View/Zoom
  ZoomIn16Regular: { fluentName: 'Zoom In', size: 16, category: 'view-zoom', fileName: 'zoom-in' },
  ZoomOut16Regular: {
    fluentName: 'Zoom Out',
    size: 16,
    category: 'view-zoom',
    fileName: 'zoom-out',
  },
  PageFit16Regular: {
    fluentName: 'Page Fit',
    size: 16,
    category: 'view-zoom',
    fileName: 'page-fit',
  },

  // Drawing
  Pen16Regular: { fluentName: 'Pen', size: 16, category: 'drawing', fileName: 'pen' },
  Highlight16Regular: {
    fluentName: 'Highlight',
    size: 16,
    category: 'drawing',
    fileName: 'highlighter',
  },
  Eraser20Regular: { fluentName: 'Eraser', size: 20, category: 'drawing', fileName: 'eraser' },
  SelectObject20Regular: {
    fluentName: 'Select Object',
    size: 20,
    category: 'drawing',
    fileName: 'select-object',
  },
  PaintBrush16Regular: {
    fluentName: 'Paint Brush',
    size: 16,
    category: 'drawing',
    fileName: 'paint-brush',
  },

  // Shapes
  Shapes16Regular: { fluentName: 'Shapes', size: 16, category: 'shapes', fileName: 'shapes' },
  Square16Regular: { fluentName: 'Square', size: 16, category: 'shapes', fileName: 'square' },
  Circle16Regular: { fluentName: 'Circle', size: 16, category: 'shapes', fileName: 'circle' },
  Triangle16Regular: { fluentName: 'Triangle', size: 16, category: 'shapes', fileName: 'triangle' },
  Line20Regular: { fluentName: 'Line', size: 20, category: 'shapes', fileName: 'line' },
  Star16Regular: { fluentName: 'Star', size: 16, category: 'shapes', fileName: 'star' },

  // Insert/Illustrations
  Image16Regular: {
    fluentName: 'Image',
    size: 16,
    category: 'insert-illustrations',
    fileName: 'image',
  },
  Camera16Regular: {
    fluentName: 'Camera',
    size: 16,
    category: 'insert-illustrations',
    fileName: 'camera',
  },
  Textbox16Regular: {
    fluentName: 'Textbox',
    size: 16,
    category: 'insert-illustrations',
    fileName: 'textbox',
  },

  // Comments
  Comment16Regular: { fluentName: 'Comment', size: 16, category: 'comments', fileName: 'comment' },

  // Links
  Link16Regular: { fluentName: 'Link', size: 16, category: 'misc', fileName: 'link' },

  // Status/Validation
  CheckmarkCircle16Regular: {
    fluentName: 'Checkmark Circle',
    size: 16,
    category: 'misc',
    fileName: 'checkmark-circle',
  },
  LockClosed16Regular: { fluentName: 'Lock Closed', size: 16, category: 'misc', fileName: 'lock' },

  // Data Operations
  DataBarVertical16Regular: {
    fluentName: 'Data Bar Vertical',
    size: 16,
    category: 'data-tables',
    fileName: 'data-bar',
  },
  DataLine16Regular: {
    fluentName: 'Data Line',
    size: 16,
    category: 'data-tables',
    fileName: 'data-line',
  },

  // Misc
  ArrowSync16Regular: { fluentName: 'Arrow Sync', size: 16, category: 'misc', fileName: 'sync' },
  Bot16Regular: { fluentName: 'Bot', size: 16, category: 'misc', fileName: 'bot' },
  Code16Regular: { fluentName: 'Code', size: 16, category: 'misc', fileName: 'code' },
  Settings16Regular: { fluentName: 'Settings', size: 16, category: 'misc', fileName: 'settings' },
  Search16Regular: { fluentName: 'Search', size: 16, category: 'misc', fileName: 'search' },
  Add16Regular: { fluentName: 'Add', size: 16, category: 'misc', fileName: 'add' },
  Subtract16Regular: { fluentName: 'Subtract', size: 16, category: 'misc', fileName: 'subtract' },
  GroupList20Regular: {
    fluentName: 'Group List',
    size: 20,
    category: 'misc',
    fileName: 'group-list',
  },
  DocumentMargins20Regular: {
    fluentName: 'Document Margins',
    size: 20,
    category: 'file-operations',
    fileName: 'margins',
  },
};

/**
 * Build the GitHub raw URL for a Fluent UI icon
 */
function buildFluentUrl(fluentName, size) {
  // Folder name uses spaces: "Text Bold"
  // File name uses underscores: "ic_fluent_text_bold_16_regular.svg"
  const folderName = encodeURIComponent(fluentName);
  const fileName = `ic_fluent_${fluentName.toLowerCase().replace(/ /g, '_')}_${size}_regular.svg`;
  return `https://raw.githubusercontent.com/microsoft/fluentui-system-icons/main/assets/${folderName}/SVG/${fileName}`;
}

/**
 * Normalize SVG to 24x24 viewBox
 */
function normalizeTo24(svgContent, originalSize) {
  // Parse existing viewBox
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);

  // Update width/height to 24
  let normalized = svgContent
    .replace(/width="[^"]*"/, 'width="24"')
    .replace(/height="[^"]*"/, 'height="24"');

  // If no viewBox, add one based on original size
  if (!viewBoxMatch) {
    normalized = normalized.replace('<svg', `<svg viewBox="0 0 ${originalSize} ${originalSize}"`);
  }

  // Remove React-specific attributes
  normalized = normalized
    .replace(/class="[^"]*"/g, '')
    .replace(/xmlns:xlink="[^"]*"/g, '')
    .replace(/data-[a-z-]+="[^"]*"/g, '');

  // Clean up whitespace
  normalized = normalized.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

  return normalized;
}

/**
 * Fetch an icon from GitHub
 */
async function fetchIcon(exportName, config) {
  const url = buildFluentUrl(config.fluentName, config.size);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  Failed to fetch ${exportName}: ${response.status} ${response.statusText}`);
      console.error(`  URL: ${url}`);
      return null;
    }

    const svg = await response.text();
    return normalizeTo24(svg, config.size);
  } catch (error) {
    console.error(`  Error fetching ${exportName}:`, error.message);
    return null;
  }
}

/**
 * Save SVG to file
 */
function saveIcon(category, fileName, svgContent) {
  const dir = join(SRC_DIR, category);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, `${fileName}.svg`);
  writeFileSync(filePath, svgContent);
  return filePath;
}

/**
 * Main extraction function
 */
async function extractIcons() {
  console.log('Fluent UI Icon Extraction');
  console.log('=========================\n');

  const total = Object.keys(FLUENT_ICONS).length;
  let success = 0;
  let failed = 0;
  const failedIcons = [];

  console.log(`Extracting ${total} icons...\n`);

  for (const [exportName, config] of Object.entries(FLUENT_ICONS)) {
    process.stdout.write(`Fetching ${config.fileName} (${config.category})... `);

    const svg = await fetchIcon(exportName, config);

    if (svg) {
      const path = saveIcon(config.category, config.fileName, svg);
      console.log('OK');
      success++;
    } else {
      console.log('FAILED');
      failed++;
      failedIcons.push({ exportName, config });
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log('\n=========================');
  console.log(`Done! ${success}/${total} icons extracted successfully.`);

  if (failed > 0) {
    console.log(`\nFailed icons (${failed}):`);
    for (const { exportName, config } of failedIcons) {
      console.log(`  - ${exportName} -> ${config.fluentName}`);
    }
  }

  // Summary by category
  console.log('\nIcons by category:');
  const byCategory = {};
  for (const [, config] of Object.entries(FLUENT_ICONS)) {
    byCategory[config.category] = (byCategory[config.category] || 0) + 1;
  }
  for (const [category, count] of Object.entries(byCategory).sort()) {
    console.log(`  ${category}: ${count}`);
  }
}

// Run
extractIcons().catch(console.error);
