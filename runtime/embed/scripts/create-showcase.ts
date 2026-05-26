/**
 * create-showcase.ts
 *
 * Generates showcase.xlsx for the Mog website frontpage embed.
 * Run with: npx tsx scripts/create-showcase.ts
 *
 * Uses ExcelJS to produce a polished XLSX that demonstrates
 * Mog's rendering fidelity across formatting, formulas, and data.
 */

import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'public', 'showcase.xlsx');

// ---------------------------------------------------------------------------
// Mog brand palette
// ---------------------------------------------------------------------------
const MOG_GOLD = 'C8A951';
const MOG_GOLD_LIGHT = 'F5EFD5';
const MOG_CREAM = 'FFFDF5';
const MOG_DARK = '1A1A2E';
const MOG_GRAY_100 = 'F7F7F8';
const MOG_GRAY_200 = 'EDEDF0';
const MOG_GRAY_400 = 'A0A0AB';
const MOG_GRAY_600 = '6B6B78';
const MOG_GREEN = '16A34A';
const MOG_GREEN_BG = 'DCFCE7';
const MOG_RED = 'DC2626';
const MOG_RED_BG = 'FEE2E2';
const MOG_AMBER = 'D97706';
const MOG_AMBER_BG = 'FEF3C7';
const MOG_BLUE = '2563EB';
const MOG_BLUE_BG = 'DBEAFE';
const WHITE = 'FFFFFF';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fill(color: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function font(opts: Partial<ExcelJS.Font> & { color?: string }): Partial<ExcelJS.Font> {
  const f: Partial<ExcelJS.Font> = { name: 'Inter', ...opts };
  if (opts.color) f.color = { argb: opts.color };
  return f;
}

function thinBorder(color = MOG_GRAY_200): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: color } };
  return { top: side, bottom: side, left: side, right: side };
}

// ---------------------------------------------------------------------------
// Sheet 1 — Dashboard
// ---------------------------------------------------------------------------

async function createDashboard(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Dashboard', {
    properties: { defaultColWidth: 14, defaultRowHeight: 20 },
    views: [{ showGridLines: false }],
  });

  // Column widths
  ws.columns = [
    { width: 3 }, // A — gutter
    { width: 18 }, // B
    { width: 16 }, // C
    { width: 16 }, // D
    { width: 16 }, // E
    { width: 16 }, // F
    { width: 16 }, // G
    { width: 16 }, // H
    { width: 3 }, // I — gutter
  ];

  // -- Header --
  ws.mergeCells('B1:H1');
  const header = ws.getCell('B1');
  header.value = 'Mog Analytics Dashboard';
  header.font = font({ size: 20, bold: true, color: MOG_DARK });
  header.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 40;

  // Subtitle
  ws.mergeCells('B2:H2');
  const subtitle = ws.getCell('B2');
  subtitle.value = 'Q1 2026 Performance Overview';
  subtitle.font = font({ size: 11, color: MOG_GRAY_600 });
  subtitle.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(2).height = 22;

  // -- KPI Cards (row 4-5) --
  const kpis = [
    { label: 'Revenue', value: 2400000, fmt: '$#,##0', col: 'B', color: MOG_GREEN },
    { label: 'Active Users', value: 156000, fmt: '#,##0', col: 'D', color: MOG_BLUE },
    { label: 'Growth', value: 0.24, fmt: '+0%', col: 'F', color: MOG_GOLD },
    { label: 'Satisfaction', value: 4.8, fmt: '0.0"/5.0"', col: 'H', color: MOG_AMBER },
  ];

  ws.getRow(3).height = 8; // spacer

  for (const kpi of kpis) {
    const col = kpi.col;
    // Label
    const labelCell = ws.getCell(`${col}4`);
    labelCell.value = kpi.label;
    labelCell.font = font({ size: 10, color: MOG_GRAY_600 });
    labelCell.alignment = { horizontal: 'left', vertical: 'bottom' };
    labelCell.fill = fill(MOG_CREAM);
    labelCell.border = {
      top: { style: 'medium', color: { argb: kpi.color } },
      left: { style: 'thin', color: { argb: MOG_GRAY_200 } },
      right: { style: 'thin', color: { argb: MOG_GRAY_200 } },
    };

    // Value
    const valCell = ws.getCell(`${col}5`);
    valCell.value = kpi.value;
    valCell.numFmt = kpi.fmt;
    valCell.font = font({ size: 22, bold: true, color: MOG_DARK });
    valCell.alignment = { horizontal: 'left', vertical: 'top' };
    valCell.fill = fill(MOG_CREAM);
    valCell.border = {
      bottom: { style: 'thin', color: { argb: MOG_GRAY_200 } },
      left: { style: 'thin', color: { argb: MOG_GRAY_200 } },
      right: { style: 'thin', color: { argb: MOG_GRAY_200 } },
    };
  }
  ws.getRow(4).height = 24;
  ws.getRow(5).height = 38;
  ws.getRow(6).height = 8; // spacer

  // -- Data Table (rows 7-18) --
  const tableHeader = ['', 'Month', 'Revenue', 'Users', 'Growth', 'MRR', 'Churn', 'Status'];
  const headerRow = ws.getRow(7);
  headerRow.values = tableHeader;
  headerRow.height = 28;
  for (let c = 2; c <= 8; c++) {
    const cell = headerRow.getCell(c);
    cell.font = font({ size: 10, bold: true, color: WHITE });
    cell.fill = fill(MOG_DARK);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder(MOG_DARK);
  }

  const months = [
    ['Jan 2026', 1850000, 128000, 0.12, 154000, 0.021, 'Good'],
    ['Feb 2026', 1920000, 132000, 0.15, 160000, 0.019, 'Good'],
    ['Mar 2026', 1780000, 129000, -0.07, 148000, 0.028, 'Fair'],
    ['Apr 2026', 2050000, 138000, 0.15, 171000, 0.017, 'Good'],
    ['May 2026', 2180000, 142000, 0.06, 182000, 0.015, 'Good'],
    ['Jun 2026', 1950000, 135000, -0.11, 163000, 0.032, 'Poor'],
    ['Jul 2026', 2240000, 148000, 0.15, 187000, 0.014, 'Good'],
    ['Aug 2026', 2350000, 151000, 0.05, 196000, 0.016, 'Good'],
    ['Sep 2026', 2280000, 149000, -0.03, 190000, 0.022, 'Fair'],
    ['Oct 2026', 2400000, 156000, 0.24, 200000, 0.012, 'Good'],
  ];

  const statusColors: Record<string, { font: string; bg: string }> = {
    Good: { font: MOG_GREEN, bg: MOG_GREEN_BG },
    Fair: { font: MOG_AMBER, bg: MOG_AMBER_BG },
    Poor: { font: MOG_RED, bg: MOG_RED_BG },
  };

  for (let i = 0; i < months.length; i++) {
    const r = 8 + i;
    const row = ws.getRow(r);
    const d = months[i]!;
    row.values = ['', d[0], d[1], d[2], d[3], d[4], d[5], d[6]];
    row.height = 26;

    const isAlt = i % 2 === 1;
    const bgColor = isAlt ? MOG_GRAY_100 : WHITE;

    for (let c = 2; c <= 8; c++) {
      const cell = row.getCell(c);
      cell.font = font({ size: 10, color: MOG_DARK });
      cell.fill = fill(bgColor);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder(MOG_GRAY_200);
    }

    // Formats
    row.getCell(3).numFmt = '$#,##0';
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).numFmt = '+0.0%;-0.0%';
    row.getCell(6).numFmt = '$#,##0';
    row.getCell(7).numFmt = '0.0%';

    // Growth color
    const growthVal = d[3] as number;
    row.getCell(5).font = font({
      size: 10,
      bold: true,
      color: growthVal >= 0 ? MOG_GREEN : MOG_RED,
    });

    // Status badge
    const status = d[6] as string;
    const sc = statusColors[status]!;
    const statusCell = row.getCell(8);
    statusCell.font = font({ size: 9, bold: true, color: sc.font });
    statusCell.fill = fill(sc.bg);
  }

  // Totals row
  const totalsRow = ws.getRow(18);
  totalsRow.height = 28;
  totalsRow.getCell(2).value = 'Total / Avg';
  totalsRow.getCell(3).value = { formula: 'SUM(C8:C17)' };
  totalsRow.getCell(4).value = { formula: 'AVERAGE(D8:D17)' };
  totalsRow.getCell(5).value = { formula: 'AVERAGE(E8:E17)' };
  totalsRow.getCell(6).value = { formula: 'SUM(F8:F17)' };
  totalsRow.getCell(7).value = { formula: 'AVERAGE(G8:G17)' };
  totalsRow.getCell(8).value = '';

  for (let c = 2; c <= 8; c++) {
    const cell = totalsRow.getCell(c);
    cell.font = font({ size: 10, bold: true, color: MOG_DARK });
    cell.fill = fill(MOG_GOLD_LIGHT);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'medium', color: { argb: MOG_GOLD } },
      bottom: { style: 'medium', color: { argb: MOG_GOLD } },
      left: { style: 'thin', color: { argb: MOG_GRAY_200 } },
      right: { style: 'thin', color: { argb: MOG_GRAY_200 } },
    };
  }
  totalsRow.getCell(3).numFmt = '$#,##0';
  totalsRow.getCell(4).numFmt = '#,##0';
  totalsRow.getCell(5).numFmt = '+0.0%;-0.0%';
  totalsRow.getCell(6).numFmt = '$#,##0';
  totalsRow.getCell(7).numFmt = '0.0%';

  // -- Progress bars section (rows 20-29) --
  ws.getRow(19).height = 8; // spacer

  ws.mergeCells('B20:H20');
  const progressTitle = ws.getCell('B20');
  progressTitle.value = 'Project Completion';
  progressTitle.font = font({ size: 14, bold: true, color: MOG_DARK });
  progressTitle.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(20).height = 30;

  const projects = [
    ['Frontend Redesign', 0.92],
    ['API Migration', 0.78],
    ['Data Pipeline', 0.65],
    ['Mobile App', 0.45],
    ['Security Audit', 1.0],
    ['Documentation', 0.55],
    ['Performance Opt.', 0.88],
    ['CI/CD Pipeline', 0.72],
  ];

  // Headers
  const progHeaderRow = ws.getRow(21);
  progHeaderRow.values = ['', 'Project', 'Progress', '', '', '', '', 'Pct'];
  progHeaderRow.height = 24;
  for (const c of [2, 3, 8]) {
    const cell = progHeaderRow.getCell(c);
    cell.font = font({ size: 10, bold: true, color: MOG_GRAY_600 });
    cell.alignment = { horizontal: c === 8 ? 'center' : 'left', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: MOG_GRAY_200 } } };
  }

  for (let i = 0; i < projects.length; i++) {
    const r = 22 + i;
    const row = ws.getRow(r);
    const [name, pct] = projects[i]!;
    row.height = 24;

    row.getCell(2).value = name;
    row.getCell(2).font = font({ size: 10, color: MOG_DARK });
    row.getCell(2).alignment = { vertical: 'middle' };

    // Percentage value in column H
    row.getCell(8).value = pct;
    row.getCell(8).numFmt = '0%';
    row.getCell(8).font = font({
      size: 10,
      bold: true,
      color: (pct as number) >= 0.8 ? MOG_GREEN : (pct as number) >= 0.5 ? MOG_AMBER : MOG_RED,
    });
    row.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };

    // Visual bar using merged cells C-G with partial fill
    ws.mergeCells(r, 3, r, 7);
    const barCell = row.getCell(3);
    barCell.value = pct;
    barCell.numFmt = '0%';
    barCell.font = font({ size: 9, bold: true, color: MOG_DARK });
    barCell.alignment = { horizontal: 'left', vertical: 'middle' };
  }

  // Data bars via conditional formatting (ExcelJS model)
  ws.addConditionalFormatting({
    ref: 'C22:G29',
    rules: [
      {
        type: 'dataBar',
        priority: 1,
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: 1 },
        ],
        color: { argb: MOG_GOLD },
      } as any,
    ],
  });

  // Growth conditional formatting (green/red)
  ws.addConditionalFormatting({
    ref: 'E8:E17',
    rules: [
      {
        type: 'cellIs',
        priority: 2,
        operator: 'greaterThanOrEqual',
        formulae: [0],
        style: {
          font: { color: { argb: MOG_GREEN } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: MOG_GREEN_BG } },
        },
      },
      {
        type: 'cellIs',
        priority: 3,
        operator: 'lessThan',
        formulae: [0],
        style: {
          font: { color: { argb: MOG_RED } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: MOG_RED_BG } },
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Sheet 2 — Data
// ---------------------------------------------------------------------------

async function createDataSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Data', {
    views: [{ showGridLines: true }],
  });

  ws.columns = [
    { width: 6, header: 'ID' },
    { width: 20, header: 'Employee' },
    { width: 16, header: 'Department' },
    { width: 14, header: 'Hire Date' },
    { width: 14, header: 'Salary' },
    { width: 12, header: 'Bonus %' },
    { width: 14, header: 'Total Comp' },
    { width: 12, header: 'Rating' },
    { width: 14, header: 'Grade' },
    { width: 18, header: 'Dept Avg Salary' },
  ];

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.height = 30;
  for (let c = 1; c <= 10; c++) {
    const cell = headerRow.getCell(c);
    cell.font = font({ size: 11, bold: true, color: WHITE });
    cell.fill = fill(MOG_DARK);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder(MOG_DARK);
  }

  // Enable auto-filter
  ws.autoFilter = { from: 'A1', to: 'J1' };

  const departments = ['Engineering', 'Marketing', 'Sales', 'Product', 'Finance'];
  const names = [
    'Alice Chen',
    'Bob Martinez',
    'Carol Tanaka',
    'David Kim',
    'Emma Wilson',
    'Frank Liu',
    'Grace Patel',
    "Henry O'Brien",
    'Iris Johansson',
    'Jack Nguyen',
    'Karen Schmidt',
    'Leo Costa',
    'Maya Thompson',
    'Noah Ibrahim',
    'Olivia Park',
    'Peter Volkov',
    'Quinn Murphy',
    'Rachel Weiss',
    'Sam Okafor',
    'Tina Larsson',
  ];

  const baseDate = new Date(2020, 0, 15);

  for (let i = 0; i < 20; i++) {
    const r = i + 2;
    const row = ws.getRow(r);
    const dept = departments[i % 5]!;
    const hireDate = new Date(baseDate.getTime() + i * 45 * 86400000);
    const salary = 65000 + Math.round((Math.sin(i * 1.3) + 1) * 30000);
    const bonus = 0.05 + (i % 7) * 0.03;
    const rating = [3.2, 4.1, 4.5, 3.8, 4.9, 3.5, 4.2, 4.7, 3.9, 4.4][i % 10]!;

    row.values = [
      i + 1,
      names[i],
      dept,
      hireDate,
      salary,
      bonus,
      { formula: `E${r}*(1+F${r})` }, // Total Comp
      rating,
      { formula: `IF(H${r}>=4.5,"A",IF(H${r}>=3.5,"B","C"))` }, // Grade
      { formula: `AVERAGEIF(C$2:C$21,C${r},E$2:E$21)` }, // Dept Avg
    ];

    row.height = 24;
    const isAlt = i % 2 === 1;

    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.font = font({ size: 10, color: MOG_DARK });
      cell.fill = fill(isAlt ? MOG_GRAY_100 : WHITE);
      cell.alignment = { horizontal: c <= 3 || c === 9 ? 'center' : 'right', vertical: 'middle' };
      cell.border = thinBorder(MOG_GRAY_200);
    }

    // Name left-aligned
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    // Formats
    row.getCell(4).numFmt = 'MMM D, YYYY';
    row.getCell(5).numFmt = '$#,##0';
    row.getCell(6).numFmt = '0.0%';
    row.getCell(7).numFmt = '$#,##0';
    row.getCell(8).numFmt = '0.0';
    row.getCell(10).numFmt = '$#,##0';

    // Grade color
    const gradeCell = row.getCell(9);
    gradeCell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // Summary row (row 23, after a gap)
  ws.getRow(22).height = 6; // spacer

  const summaryLabels = ['', '', '', 'Summary:', '', '', '', '', '', ''];
  const summaryRow = ws.getRow(23);
  summaryRow.values = summaryLabels;
  summaryRow.getCell(4).font = font({ size: 10, bold: true, color: MOG_DARK });
  summaryRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };

  const formulas = [
    { col: 5, formula: 'AVERAGE(E2:E21)', fmt: '$#,##0', label: 'Avg Salary' },
    { col: 6, formula: 'AVERAGE(F2:F21)', fmt: '0.0%', label: 'Avg Bonus' },
    { col: 7, formula: 'SUM(G2:G21)', fmt: '$#,##0', label: 'Total Comp' },
    { col: 8, formula: 'AVERAGE(H2:H21)', fmt: '0.0', label: 'Avg Rating' },
  ];

  for (const f of formulas) {
    const cell = summaryRow.getCell(f.col);
    cell.value = { formula: f.formula };
    cell.numFmt = f.fmt;
    cell.font = font({ size: 10, bold: true, color: MOG_GOLD });
    cell.fill = fill(MOG_GOLD_LIGHT);
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = {
      top: { style: 'medium', color: { argb: MOG_GOLD } },
      bottom: { style: 'medium', color: { argb: MOG_GOLD } },
    };
  }

  // Count and Min/Max
  const row24 = ws.getRow(24);
  row24.getCell(4).value = 'Count:';
  row24.getCell(4).font = font({ size: 10, bold: true, color: MOG_DARK });
  row24.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  row24.getCell(5).value = { formula: 'COUNTA(B2:B21)' };
  row24.getCell(5).font = font({ size: 10, bold: true, color: MOG_DARK });

  const row25 = ws.getRow(25);
  row25.getCell(4).value = 'Max Salary:';
  row25.getCell(4).font = font({ size: 10, bold: true, color: MOG_DARK });
  row25.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  row25.getCell(5).value = { formula: 'MAX(E2:E21)' };
  row25.getCell(5).numFmt = '$#,##0';
  row25.getCell(5).font = font({ size: 10, bold: true, color: MOG_GREEN });

  const row26 = ws.getRow(26);
  row26.getCell(4).value = 'Min Salary:';
  row26.getCell(4).font = font({ size: 10, bold: true, color: MOG_DARK });
  row26.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  row26.getCell(5).value = { formula: 'MIN(E2:E21)' };
  row26.getCell(5).numFmt = '$#,##0';
  row26.getCell(5).font = font({ size: 10, bold: true, color: MOG_RED });
}

// ---------------------------------------------------------------------------
// Sheet 3 — Formatting
// ---------------------------------------------------------------------------

async function createFormattingSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Formatting', {
    views: [{ showGridLines: false }],
  });

  ws.columns = [
    { width: 3 }, // A — gutter
    { width: 18 }, // B
    { width: 18 }, // C
    { width: 18 }, // D
    { width: 18 }, // E
    { width: 18 }, // F
    { width: 18 }, // G
    { width: 18 }, // H
    { width: 3 }, // I — gutter
  ];

  // -- Section 1: Text Styles --
  ws.mergeCells('B1:H1');
  ws.getCell('B1').value = 'Text Styles';
  ws.getCell('B1').font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(1).height = 32;

  const textStyles: [string, Partial<ExcelJS.Font>][] = [
    ['Bold Text', { bold: true, size: 12 }],
    ['Italic Text', { italic: true, size: 12 }],
    ['Underline', { underline: true, size: 12 }],
    ['Strikethrough', { strike: true, size: 12 }],
    ['Bold + Italic', { bold: true, italic: true, size: 12 }],
    ['Double Underline', { underline: 'double' as any, size: 12 }],
  ];

  for (let i = 0; i < textStyles.length; i++) {
    const col = i < 3 ? 2 + i : 2 + (i - 3);
    const row = i < 3 ? 2 : 3;
    const cell = ws.getCell(row, col);
    cell.value = textStyles[i]![0];
    cell.font = { name: 'Inter', color: { argb: MOG_DARK }, ...textStyles[i]![1] };
    cell.alignment = { vertical: 'middle' };
  }
  ws.getRow(2).height = 28;
  ws.getRow(3).height = 28;

  // -- Section 2: Font Sizes --
  ws.getRow(4).height = 8; // spacer
  ws.mergeCells('B5:H5');
  ws.getCell('B5').value = 'Font Sizes';
  ws.getCell('B5').font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(5).height = 32;

  const sizes = [8, 10, 12, 14, 18, 24, 28];
  for (let i = 0; i < sizes.length; i++) {
    const cell = ws.getCell(6, 2 + i);
    cell.value = `${sizes[i]}px`;
    cell.font = font({ size: sizes[i]!, color: MOG_DARK });
    cell.alignment = { vertical: 'bottom' };
  }
  ws.getRow(6).height = 40;

  // -- Section 3: Colors --
  ws.getRow(7).height = 8;
  ws.mergeCells('B8:H8');
  ws.getCell('B8').value = 'Color Palette';
  ws.getCell('B8').font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(8).height = 32;

  const paletteRows = [
    // Row 1: Blues
    ['003F88', '0066CC', '2563EB', '60A5FA', '93C5FD', 'BFDBFE', 'DBEAFE'],
    // Row 2: Greens
    ['14532D', '166534', '16A34A', '4ADE80', '86EFAC', 'BBF7D0', 'DCFCE7'],
    // Row 3: Golds (Mog brand)
    ['78650A', '9A7D1A', MOG_GOLD, 'D4B96A', 'E0CC8F', MOG_GOLD_LIGHT, MOG_CREAM],
    // Row 4: Reds
    ['7F1D1D', '991B1B', 'DC2626', 'F87171', 'FCA5A5', 'FECACA', 'FEE2E2'],
    // Row 5: Purples
    ['3B0764', '581C87', '7C3AED', 'A78BFA', 'C4B5FD', 'DDD6FE', 'EDE9FE'],
  ];

  for (let r = 0; r < paletteRows.length; r++) {
    const rowNum = 9 + r;
    ws.getRow(rowNum).height = 28;
    for (let c = 0; c < paletteRows[r]!.length; c++) {
      const color = paletteRows[r]![c]!;
      const cell = ws.getCell(rowNum, 2 + c);
      cell.fill = fill(color);
      // Light text on dark colors, dark text on light colors
      const isLight = r >= 0 && c >= 3;
      cell.value = `#${color}`;
      cell.font = font({ size: 8, color: isLight ? MOG_DARK : WHITE });
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder(MOG_GRAY_200);
    }
  }

  // -- Section 4: Borders --
  const borderStart = 15;
  ws.getRow(14).height = 8;
  ws.mergeCells(`B${borderStart}:H${borderStart}`);
  ws.getCell(`B${borderStart}`).value = 'Border Styles';
  ws.getCell(`B${borderStart}`).font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(borderStart).height = 32;

  const borderStyles: [string, ExcelJS.BorderStyle][] = [
    ['Thin', 'thin'],
    ['Medium', 'medium'],
    ['Thick', 'thick'],
    ['Double', 'double'],
    ['Dotted', 'dotted'],
    ['Dashed', 'dashed'],
  ];

  ws.getRow(borderStart + 1).height = 36;
  for (let i = 0; i < borderStyles.length; i++) {
    const cell = ws.getCell(borderStart + 1, 2 + i);
    cell.value = borderStyles[i]![0];
    cell.font = font({ size: 10, color: MOG_DARK });
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    const side: Partial<ExcelJS.Border> = {
      style: borderStyles[i]![1],
      color: { argb: MOG_DARK },
    };
    cell.border = { top: side, bottom: side, left: side, right: side };
  }

  // -- Section 5: Alignment --
  const alignStart = 18;
  ws.getRow(17).height = 8;
  ws.mergeCells(`B${alignStart}:H${alignStart}`);
  ws.getCell(`B${alignStart}`).value = 'Text Alignment';
  ws.getCell(`B${alignStart}`).font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(alignStart).height = 32;

  // Alignment grid
  const hAligns: ExcelJS.Alignment['horizontal'][] = ['left', 'center', 'right'];
  const vAligns: ExcelJS.Alignment['vertical'][] = ['top', 'middle', 'bottom'];

  // Column headers
  for (let c = 0; c < 3; c++) {
    const cell = ws.getCell(alignStart + 1, 3 + c);
    cell.value = hAligns[c];
    cell.font = font({ size: 9, bold: true, color: MOG_GRAY_600 });
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getRow(alignStart + 1).height = 20;

  for (let r = 0; r < 3; r++) {
    const rowNum = alignStart + 2 + r;
    ws.getRow(rowNum).height = 36;
    // Row label
    const label = ws.getCell(rowNum, 2);
    label.value = vAligns[r];
    label.font = font({ size: 9, bold: true, color: MOG_GRAY_600 });
    label.alignment = { horizontal: 'right', vertical: 'middle' };

    for (let c = 0; c < 3; c++) {
      const cell = ws.getCell(rowNum, 3 + c);
      cell.value = `${vAligns[r]}-${hAligns[c]}`;
      cell.font = font({ size: 9, color: MOG_DARK });
      cell.alignment = {
        horizontal: hAligns[c],
        vertical: vAligns[r],
      };
      cell.fill = fill(MOG_CREAM);
      cell.border = thinBorder(MOG_GRAY_200);
    }
  }

  // -- Section 6: Text Wrapping & Merge --
  const wrapStart = 24;
  ws.getRow(23).height = 8;
  ws.mergeCells(`B${wrapStart}:H${wrapStart}`);
  ws.getCell(`B${wrapStart}`).value = 'Text Wrapping & Merged Cells';
  ws.getCell(`B${wrapStart}`).font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(wrapStart).height = 32;

  // Wrapped text
  const wrapCell = ws.getCell(`B${wrapStart + 1}`);
  wrapCell.value =
    'This is a long text that demonstrates text wrapping within a cell. The text should wrap to multiple lines automatically.';
  wrapCell.font = font({ size: 10, color: MOG_DARK });
  wrapCell.alignment = { wrapText: true, vertical: 'top' };
  wrapCell.fill = fill(MOG_CREAM);
  wrapCell.border = thinBorder(MOG_GRAY_200);
  ws.getRow(wrapStart + 1).height = 56;

  // Merged cells demo
  ws.mergeCells(`D${wrapStart + 1}:F${wrapStart + 2}`);
  const mergeCell = ws.getCell(`D${wrapStart + 1}`);
  mergeCell.value = 'Merged 3x2 Cell';
  mergeCell.font = font({ size: 14, bold: true, color: MOG_GOLD });
  mergeCell.alignment = { horizontal: 'center', vertical: 'middle' };
  mergeCell.fill = fill(MOG_GOLD_LIGHT);
  mergeCell.border = {
    top: { style: 'medium', color: { argb: MOG_GOLD } },
    bottom: { style: 'medium', color: { argb: MOG_GOLD } },
    left: { style: 'medium', color: { argb: MOG_GOLD } },
    right: { style: 'medium', color: { argb: MOG_GOLD } },
  };

  ws.mergeCells(`G${wrapStart + 1}:H${wrapStart + 1}`);
  const merge2 = ws.getCell(`G${wrapStart + 1}`);
  merge2.value = 'Horizontal Merge';
  merge2.font = font({ size: 10, bold: true, color: MOG_BLUE });
  merge2.alignment = { horizontal: 'center', vertical: 'middle' };
  merge2.fill = fill(MOG_BLUE_BG);
  merge2.border = thinBorder(MOG_BLUE);

  ws.getRow(wrapStart + 2).height = 28;

  // -- Section 7: Number Formats --
  const numStart = 28;
  ws.getRow(27).height = 8;
  ws.mergeCells(`B${numStart}:H${numStart}`);
  ws.getCell(`B${numStart}`).value = 'Number Formats';
  ws.getCell(`B${numStart}`).font = font({ size: 16, bold: true, color: MOG_DARK });
  ws.getRow(numStart).height = 32;

  const numFormats: [string, number, string][] = [
    ['Currency', 1234567.89, '$#,##0.00'],
    ['Accounting', -1234567.89, '_($* #,##0.00_)'],
    ['Percentage', 0.8525, '0.00%'],
    ['Scientific', 123456789, '0.00E+00'],
    ['Fraction', 0.375, '# ?/?'],
    ['Custom Date', 46120, 'YYYY-MM-DD'],
    ['Thousands', 1234567, '#,##0,"K"'],
  ];

  // Headers
  const nfHeaderRow = ws.getRow(numStart + 1);
  for (const [c, label] of [
    [2, 'Format'],
    [3, 'Value'],
    [4, 'Pattern'],
  ] as const) {
    nfHeaderRow.getCell(c).value = label;
    nfHeaderRow.getCell(c).font = font({ size: 10, bold: true, color: MOG_GRAY_600 });
    nfHeaderRow.getCell(c).border = {
      bottom: { style: 'thin', color: { argb: MOG_GRAY_200 } },
    };
  }
  ws.getRow(numStart + 1).height = 24;

  for (let i = 0; i < numFormats.length; i++) {
    const r = numStart + 2 + i;
    const [label, value, fmt] = numFormats[i]!;
    ws.getRow(r).height = 24;

    ws.getCell(r, 2).value = label;
    ws.getCell(r, 2).font = font({ size: 10, color: MOG_DARK });

    ws.getCell(r, 3).value = value;
    ws.getCell(r, 3).numFmt = fmt;
    ws.getCell(r, 3).font = font({ size: 10, bold: true, color: MOG_DARK });
    ws.getCell(r, 3).alignment = { horizontal: 'right' };

    ws.getCell(r, 4).value = fmt;
    ws.getCell(r, 4).font = font({ size: 9, color: MOG_GRAY_400 });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mog';
  wb.created = new Date();

  await createDashboard(wb);
  await createDataSheet(wb);
  await createFormattingSheet(wb);

  await wb.xlsx.writeFile(OUTPUT);
  console.log(`Showcase written to: ${OUTPUT}`);
  console.log(`File size: ${((await import('fs')).statSync(OUTPUT).size / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('Failed to create showcase:', err);
  process.exit(1);
});
