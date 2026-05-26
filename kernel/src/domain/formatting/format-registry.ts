/**
 * Format Property Registry
 *
 * This is the SINGLE SOURCE OF TRUTH for all Excel format properties.
 * Every format property in Excel is enumerated here with:
 * - The ExcelJS field path
 * - Whether it's in our contracts
 * - Whether import/export/render is implemented
 *
 * Following the "Solve Once, Not Forever" philosophy: we map ALL format
 * properties upfront rather than playing whack-a-mole with missing properties.
 *
 * Extracted from @mog-sdk/contracts/formatting (purity extraction).
 *
 */

import type {
  FormatCategory,
  FormatPropertyDef,
  FormatPropertyStatus,
} from '@mog-sdk/contracts/format-registry';

// Re-export types so consumers don't need to import from contracts
export type { FormatCategory, FormatPropertyDef, FormatPropertyStatus };

// =============================================================================
// Format Property Registry
// =============================================================================

/**
 * Complete registry of all Excel format properties.
 *
 * Status Legend:
 * - true = Implemented
 * - false = Not implemented (needs work)
 *
 * This registry is used to:
 * 1. Monitor feature completeness
 * 2. Generate documentation
 * 3. Drive automated testing
 * 4. Ensure no properties are missed
 */
export const FORMAT_PROPERTY_REGISTRY: FormatPropertyDef[] = [
  // ===========================================================================
  // FONT PROPERTIES
  // ===========================================================================
  {
    category: 'font',
    property: 'bold',
    excelJSField: 'font.bold',
    description: 'Bold text',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'font',
    property: 'italic',
    excelJSField: 'font.italic',
    description: 'Italic text',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'font',
    property: 'underlineType',
    excelJSField: 'font.underline',
    description: 'Underline type (none, single, double, singleAccounting, doubleAccounting)',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Now supports all Excel underline types. CSS rendering shows all as single underline.',
  },
  {
    category: 'font',
    property: 'strikethrough',
    excelJSField: 'font.strike',
    description: 'Strikethrough text',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'font',
    property: 'fontFamily',
    excelJSField: 'font.name',
    description: 'Font family name',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'font',
    property: 'fontSize',
    excelJSField: 'font.size',
    description: 'Font size in points',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'font',
    property: 'fontColor',
    excelJSField: 'font.color',
    description: 'Font color (hex or theme reference)',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Supports theme colors with tint',
  },
  {
    category: 'font',
    property: 'superscript',
    excelJSField: 'font.vertAlign=superscript',
    description: 'Superscript vertical alignment',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Renders with 70% font size and raised baseline.',
  },
  {
    category: 'font',
    property: 'subscript',
    excelJSField: 'font.vertAlign=subscript',
    description: 'Subscript vertical alignment',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Renders with 70% font size and lowered baseline.',
  },
  {
    category: 'font',
    property: 'fontOutline',
    excelJSField: 'font.outline',
    description: 'Outline effect on font',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Uses strokeText for outline effect.',
  },
  {
    category: 'font',
    property: 'fontShadow',
    excelJSField: 'font.shadow',
    description: 'Shadow effect on font',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Uses canvas shadow properties.',
  },

  // ===========================================================================
  // ALIGNMENT PROPERTIES
  // ===========================================================================
  {
    category: 'alignment',
    property: 'horizontalAlign',
    excelJSField: 'alignment.horizontal',
    description: 'Horizontal text alignment',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Excel has more options (fill, distributed, centerContinuous) - we map to closest',
  },
  {
    category: 'alignment',
    property: 'verticalAlign',
    excelJSField: 'alignment.vertical',
    description: 'Vertical text alignment',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Excel has distributed/justify - we map to closest',
  },
  {
    category: 'alignment',
    property: 'wrapText',
    excelJSField: 'alignment.wrapText',
    description: 'Wrap text within cell',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'alignment',
    property: 'textRotation',
    excelJSField: 'alignment.textRotation',
    description: 'Text rotation angle (0-180, 255 for vertical)',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Supports 0-90 (CCW), 91-180 (CW), and 255 (vertical stacked text).',
  },
  {
    category: 'alignment',
    property: 'indent',
    excelJSField: 'alignment.indent',
    description: 'Indent level (0-15)',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Each indent level adds 8px to text padding.',
  },
  {
    category: 'alignment',
    property: 'shrinkToFit',
    excelJSField: 'alignment.shrinkToFit',
    description: 'Shrink text to fit cell width',
    status: { contract: true, import: true, export: true, render: true },
    notes:
      'Fully implemented. Scales font to fit cell, minimum 6px. Mutually exclusive with wrapText.',
  },
  {
    category: 'alignment',
    property: 'readingOrder',
    excelJSField: 'alignment.readingOrder',
    description: 'Reading order (LTR, RTL, context)',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Sets canvas direction property for bidirectional text support.',
  },

  // ===========================================================================
  // FILL PROPERTIES
  // ===========================================================================
  {
    category: 'fill',
    property: 'backgroundColor',
    excelJSField: 'fill.fgColor (solid)',
    description: 'Solid background color',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'For solid fills, fgColor is the background color',
  },
  {
    category: 'fill',
    property: 'patternType',
    excelJSField: 'fill.pattern',
    description: 'Fill pattern type (18 Excel patterns)',
    status: { contract: true, import: true, export: true, render: true },
    notes:
      'Fully implemented. All 18 Excel pattern types rendered using excel-patterns.ts library.',
  },
  {
    category: 'fill',
    property: 'patternForegroundColor',
    excelJSField: 'fill.fgColor (pattern)',
    description: 'Pattern foreground color',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Used as the pattern color in pattern fills.',
  },
  {
    category: 'fill',
    property: 'patternBackgroundColor',
    excelJSField: 'fill.bgColor (pattern)',
    description: 'Pattern background color',
    status: { contract: false, import: true, export: true, render: true },
    notes: 'Uses backgroundColor for pattern background. Import maps to backgroundColor.',
  },
  {
    category: 'fill',
    property: 'gradientFill',
    excelJSField: 'fill.gradient',
    description: 'Gradient fill (linear or path)',
    status: { contract: true, import: true, export: true, render: true },
    notes:
      'Fully implemented. Supports linear gradients with degrees and path/radial gradients with center point.',
  },

  // ===========================================================================
  // BORDER PROPERTIES
  // ===========================================================================
  {
    category: 'borders',
    property: 'borders.top',
    excelJSField: 'border.top',
    description: 'Top border style and color',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'borders',
    property: 'borders.right',
    excelJSField: 'border.right',
    description: 'Right border style and color',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'borders',
    property: 'borders.bottom',
    excelJSField: 'border.bottom',
    description: 'Bottom border style and color',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'borders',
    property: 'borders.left',
    excelJSField: 'border.left',
    description: 'Left border style and color',
    status: { contract: true, import: true, export: true, render: true },
  },
  {
    category: 'borders',
    property: 'borders.diagonal',
    excelJSField: 'border.diagonal',
    description: 'Diagonal border style and color',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Fully implemented. Supports diagonal up, down, and both directions.',
  },

  // ===========================================================================
  // NUMBER FORMAT
  // ===========================================================================
  {
    category: 'numberFormat',
    property: 'numberFormat',
    excelJSField: 'numFmt',
    description: 'Number format string (Excel format codes)',
    status: { contract: true, import: true, export: true, render: true },
    notes: 'Full Excel format code support in calculator-engine',
  },

  // ===========================================================================
  // PROTECTION PROPERTIES
  // ===========================================================================
  {
    category: 'protection',
    property: 'locked',
    excelJSField: 'protection.locked',
    description: 'Cell is locked when sheet is protected',
    status: { contract: true, import: true, export: true, render: true },
    notes:
      'Fully implemented. No visual rendering needed - enforced at edit time when sheet protection is enabled.',
  },
  {
    category: 'protection',
    property: 'hidden',
    excelJSField: 'protection.hidden',
    description: 'Formula is hidden when sheet is protected',
    status: { contract: true, import: true, export: true, render: true },
    notes:
      'Fully implemented. No visual rendering needed - affects formula bar visibility when sheet protection is enabled.',
  },
];

// =============================================================================
// Registry Utilities
// =============================================================================

/**
 * Get all properties that are missing contract definitions.
 */
export function getMissingContractProperties(): FormatPropertyDef[] {
  return FORMAT_PROPERTY_REGISTRY.filter((p) => !p.status.contract);
}

/**
 * Get all properties that have contract but missing import.
 */
export function getMissingImportProperties(): FormatPropertyDef[] {
  return FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.contract && !p.status.import);
}

/**
 * Get all properties that have contract but missing export.
 */
export function getMissingExportProperties(): FormatPropertyDef[] {
  return FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.contract && !p.status.export);
}

/**
 * Get all properties that have contract but missing render.
 */
export function getMissingRenderProperties(): FormatPropertyDef[] {
  return FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.contract && !p.status.render);
}

/**
 * Get properties by category.
 */
export function getPropertiesByCategory(category: FormatCategory): FormatPropertyDef[] {
  return FORMAT_PROPERTY_REGISTRY.filter((p) => p.category === category);
}

/**
 * Get implementation summary statistics.
 */
export function getImplementationSummary(): {
  total: number;
  contractDefined: number;
  importImplemented: number;
  exportImplemented: number;
  renderImplemented: number;
  fullyImplemented: number;
} {
  const total = FORMAT_PROPERTY_REGISTRY.length;
  const contractDefined = FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.contract).length;
  const importImplemented = FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.import).length;
  const exportImplemented = FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.export).length;
  const renderImplemented = FORMAT_PROPERTY_REGISTRY.filter((p) => p.status.render).length;
  const fullyImplemented = FORMAT_PROPERTY_REGISTRY.filter(
    (p) => p.status.contract && p.status.import && p.status.export && p.status.render,
  ).length;

  return {
    total,
    contractDefined,
    importImplemented,
    exportImplemented,
    renderImplemented,
    fullyImplemented,
  };
}

/**
 * Print a markdown summary of implementation status.
 * Useful for documentation and progress tracking.
 */
export function printRegistrySummary(): string {
  const summary = getImplementationSummary();
  const lines: string[] = [
    '# Format Property Implementation Status',
    '',
    '## Summary',
    '',
    `- **Total Properties**: ${summary.total}`,
    `- **Contract Defined**: ${summary.contractDefined}/${summary.total} (${Math.round((summary.contractDefined / summary.total) * 100)}%)`,
    `- **Import Implemented**: ${summary.importImplemented}/${summary.total} (${Math.round((summary.importImplemented / summary.total) * 100)}%)`,
    `- **Export Implemented**: ${summary.exportImplemented}/${summary.total} (${Math.round((summary.exportImplemented / summary.total) * 100)}%)`,
    `- **Render Implemented**: ${summary.renderImplemented}/${summary.total} (${Math.round((summary.renderImplemented / summary.total) * 100)}%)`,
    `- **Fully Implemented**: ${summary.fullyImplemented}/${summary.total} (${Math.round((summary.fullyImplemented / summary.total) * 100)}%)`,
    '',
    '## By Category',
    '',
  ];

  const categories: FormatCategory[] = [
    'font',
    'alignment',
    'fill',
    'borders',
    'numberFormat',
    'protection',
  ];

  for (const category of categories) {
    const props = getPropertiesByCategory(category);
    lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push('');
    lines.push('| Property | ExcelJS Field | Contract | Import | Export | Render |');
    lines.push('|----------|---------------|----------|--------|--------|--------|');

    for (const prop of props) {
      const s = prop.status;
      lines.push(
        `| ${prop.property} | ${prop.excelJSField} | ${s.contract ? '✅' : '❌'} | ${s.import ? '✅' : '❌'} | ${s.export ? '✅' : '❌'} | ${s.render ? '✅' : '❌'} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
