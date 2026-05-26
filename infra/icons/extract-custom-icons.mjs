#!/usr/bin/env node
/**
 * Custom Icon Extraction Script
 *
 * Extracts inline SVG icons from ToolbarIcons.tsx that aren't from Fluent UI.
 * Custom icon extraction helper.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, 'src');

/**
 * Custom icons extracted from ToolbarIcons.tsx
 * Each entry has the SVG content normalized to 24x24 with currentColor
 */
const CUSTOM_ICONS = {
  // ==========================================================================
  // Text Formatting
  // ==========================================================================
  'text-formatting/font-size': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 13H4.5l3-8h1l3 8H10l-.6-1.7H6.6L6 13zm.9-2.7h2.2L8 6.8l-1.1 3.5z"/>
  <text x="11" y="14" font-size="6" font-weight="500">12</text>
</svg>`,

  'text-formatting/font-size-increase': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 13H4.5l3-8h1l3 8H10l-.6-1.7H6.6L6 13zm.9-2.7h2.2L8 6.8l-1.1 3.5z"/>
  <path d="M13 6V3h-1v3h-1.5l2 2.5 2-2.5H13z"/>
</svg>`,

  'text-formatting/font-size-decrease': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 13H4.5l3-8h1l3 8H10l-.6-1.7H6.6L6 13zm.9-2.7h2.2L8 6.8l-1.1 3.5z"/>
  <path d="M13 3v3h1.5l-2 2.5-2-2.5H12V3h1z"/>
</svg>`,

  // ==========================================================================
  // Colors
  // ==========================================================================
  'colors/font-color': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M7.5 2L4 12h1.5l.75-2.25h3.5L10.5 12H12L8.5 2h-1zm.5 2.5l1.25 3.75h-2.5L7 4.5h1z"/>
  <rect x="2" y="13" width="12" height="2" fill="currentColor" rx="0.5"/>
</svg>`,

  'colors/fill-color': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.5 6.5L5.5 0.5 4.4 1.6 5.9 3.1 1.1 7.9c-.4.4-.4 1 0 1.4l4 4c.2.2.5.3.7.3.3 0 .5-.1.7-.3l4-4c.4-.4.4-1 0-1.4L6.6 3.9l.9-.9 4 4zm-8.3 2l3.3-3.3L9.8 8.5H3.2z"/>
  <path d="M12.5 9s-1.5 1.5-1.5 2.5c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5c0-1-1.5-2.5-1.5-2.5z"/>
  <rect x="2" y="13" width="12" height="2" fill="currentColor" rx="0.5"/>
</svg>`,

  // ==========================================================================
  // Number Formatting
  // ==========================================================================
  'formulas/percent': `<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
  <circle cx="5" cy="5" r="2"/>
  <circle cx="11" cy="11" r="2"/>
  <line x1="12" y1="4" x2="4" y2="12"/>
</svg>`,

  'formulas/currency': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1v1.5c-1.7.2-3 1.4-3 2.9 0 1.7 1.4 2.5 3.2 3 1.8.5 2 1 2 1.5 0 .6-.5 1.2-1.7 1.2-1.3 0-1.8-.6-1.9-1.4H4.5c.1 1.4 1 2.6 3 2.9V14h1v-1.4c1.8-.2 3-1.3 3-2.8 0-1.8-1.5-2.5-3.2-3-1.8-.5-2-.9-2-1.4 0-.4.4-1.1 1.7-1.1 1.2 0 1.6.6 1.7 1.2h2.1c-.1-1.3-1-2.4-2.8-2.7V1H8z"/>
</svg>`,

  'formulas/decimal-increase': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="1" y="11" font-size="8" font-weight="600">.0</text>
  <path d="M11 5l3 3-3 3v-2H8V7h3V5z"/>
</svg>`,

  'formulas/decimal-decrease': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="5" y="11" font-size="8" font-weight="600">.0</text>
  <path d="M5 5l-3 3 3 3v-2h3V7H5V5z"/>
</svg>`,

  'formulas/comma-style': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 5c1.1 0 2 .9 2 2 0 1.6-1.2 3.2-2.5 4.2l-.7-.9c.9-.7 1.7-1.8 1.7-2.8 0-.3-.2-.5-.5-.5s-.5.2-.5.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5c0-1.1.9-2 2-2z"/>
  <text x="8" y="11" font-size="7" font-weight="500">00</text>
</svg>`,

  'formulas/autosum': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3H4v1.5l4 3.5-4 3.5V13h8v-2H7l3-2.5L7 6h5V3z"/>
</svg>`,

  'formulas/name-manager': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 11v2h4v-2H2zm0-7v2h7V4H2zm7 11v-2h5v-2H9v-2H7v6h2zm-5-4v2H2v2h2v2h2V9H4zm10 0v-2H9v2h5zM9 4v2h2V4h2V2h-2V0H9v4z"/>
</svg>`,

  'formulas/trace-precedents': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 2L3 5h2v5H2v1.5h3V16l3-3-3-3v2H6.5V5H9L6 2z"/>
  <rect x="9" y="5" width="5" height="6" rx="0.5"/>
</svg>`,

  'formulas/trace-dependents': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2l3 3h-2v5h3v1.5h-3V16l-3-3 3-3v2H9.5V5H7l3-3z"/>
  <rect x="2" y="5" width="5" height="6" rx="0.5"/>
</svg>`,

  // ==========================================================================
  // Data Operations
  // ==========================================================================
  'data-tables/text-to-columns': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3v10h12V3H2zm5 8H3V5h4v6zm5 0H9V5h3v6z"/>
  <path d="M8 4v8" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.5,1.5"/>
</svg>`,

  'data-tables/remove-duplicates': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="9" height="3" rx="0.5"/>
  <rect x="2" y="6.5" width="9" height="3" rx="0.5" opacity="0.4"/>
  <rect x="2" y="11" width="9" height="3" rx="0.5"/>
  <circle cx="13" cy="8" r="2.5" fill="#d32f2f"/>
  <rect x="11.25" y="7.5" width="3.5" height="1" fill="#fff"/>
</svg>`,

  'data-tables/flash-fill': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 1L4 9h4l-1 6 6-8H9l1-6z"/>
</svg>`,

  'data-tables/consolidate': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="5" height="5" rx="0.5" opacity="0.5"/>
  <rect x="10" y="1" width="5" height="5" rx="0.5" opacity="0.5"/>
  <path d="M3.5 7v2M13.5 7v2" stroke="currentColor" stroke-width="1.2"/>
  <path d="M3.5 9l5 2 5-2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <rect x="5" y="11" width="6" height="4" rx="0.5"/>
</svg>`,

  // ==========================================================================
  // Sort & Filter
  // ==========================================================================
  'sort-filter/clear-filter': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3h12l-4 5v4l-2 1V8L2 3z" opacity="0.6"/>
  <circle cx="12" cy="11" r="3" fill="#d32f2f"/>
  <path d="M10.5 9.5l3 3M13.5 9.5l-3 3" stroke="#fff" stroke-width="1.2"/>
</svg>`,

  'sort-filter/reapply-filter': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3h12l-4 5v4l-2 1V8L2 3z" opacity="0.6"/>
  <path d="M14 10a3 3 0 1 1-1-2.2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M13.5 7v2h-2" fill="none" stroke="currentColor" stroke-width="1.2"/>
</svg>`,

  'sort-filter/advanced-filter': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3h12l-4 5v4l-2 1V8L2 3z" opacity="0.6"/>
  <circle cx="12" cy="11" r="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <circle cx="12" cy="11" r="1"/>
</svg>`,

  // ==========================================================================
  // Cells Group
  // ==========================================================================
  'data-tables/insert-sheet': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2h7l3 3v9c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3c0-.6.4-1 1-1zm6 1v3h3l-3-3z" fill-opacity="0.6"/>
  <circle cx="12" cy="12" r="3.5" fill="var(--color-primary, #0078D4)"/>
  <path d="M12 10v4M10 12h4" stroke="#fff" stroke-width="1.5"/>
</svg>`,

  'data-tables/delete-sheet': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2h7l3 3v9c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3c0-.6.4-1 1-1zm6 1v3h3l-3-3z" fill-opacity="0.6"/>
  <circle cx="12" cy="12" r="3.5" fill="#d32f2f"/>
  <path d="M10 12h4" stroke="#fff" stroke-width="1.5"/>
</svg>`,

  'data-tables/row-height': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 6h12v4H2V6zm1 1v2h10V7H3z"/>
  <path d="M8 2l2 2H6l2-2zm0 12l-2-2h4l-2 2z"/>
</svg>`,

  'data-tables/column-width': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 2v12h4V2H6zm1 1h2v10H7V3z"/>
  <path d="M2 8l2-2v4l-2-2zm12 0l-2 2V6l2 2z"/>
</svg>`,

  'data-tables/hide-row': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 6h12v4H2V6z" opacity="0.3"/>
  <path d="M3 7h10v2H3z"/>
  <path d="M2 3l12 10" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  'data-tables/hide-column': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 2v12h4V2z" opacity="0.3"/>
  <path d="M7 3v10h2V3z"/>
  <path d="M3 2l10 12" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  // ==========================================================================
  // Editing Group
  // ==========================================================================
  'misc/fill-series': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="1" y="8" font-size="6" font-weight="600">1</text>
  <text x="6" y="8" font-size="6" font-weight="600">2</text>
  <text x="11" y="8" font-size="6" font-weight="600">3</text>
  <path d="M3 10h10v1H3z"/>
  <path d="M3 12h6" stroke="currentColor" stroke-width="1" stroke-dasharray="1,1"/>
</svg>`,

  'misc/clear-contents': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3h12v10H2V3zm1 1v8h10V4H3z"/>
  <path d="M5 6l6 4M11 6l-6 4" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  'misc/clear-comments': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 2h12v9H6l-3 3v-3H2V2z" fill-opacity="0.6"/>
  <path d="M5 5l6 4M11 5l-6 4" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  'misc/go-to': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="6" width="6" height="6" rx="0.5"/>
  <path d="M2 6l4 3-4 3V6z"/>
  <path d="M6 9h3" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  'misc/select-all': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
  <rect x="4" y="4" width="8" height="8" fill="var(--color-primary, #0078D4)" fill-opacity="0.3"/>
</svg>`,

  // ==========================================================================
  // Review Tab
  // ==========================================================================
  'comments/spell-check': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 10.5h1.5L6 2H4.5L1 10.5h1.5l.8-2.1h3.9l.8 2.1zm-4-3.3L5.25 4l1.25 3.2H4z"/>
  <path d="M13.5 6.5l-4.5 4.5-2-2-.7.7 2.7 2.7 5.2-5.2-.7-.7z"/>
</svg>`,

  'misc/protect-workbook': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 7V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h1zm2 0h4V5a2 2 0 10-4 0v2z"/>
  <rect x="10" y="10" width="4" height="5" rx="0.5" fill="#fff"/>
  <rect x="11" y="11" width="2" height="3" fill="currentColor" opacity="0.6"/>
</svg>`,

  // ==========================================================================
  // Page Layout
  // ==========================================================================
  'file-operations/orientation': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2H4c-.5 0-1 .5-1 1v10c0 .5.5 1 1 1h8c.5 0 1-.5 1-1V3c0-.5-.5-1-1-1zm-1 10H5V4h6v8z"/>
  <path d="M7 6l2-2 2 2h-1.5v2.5h-1V6H7z"/>
</svg>`,

  'file-operations/page-breaks': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3v10h12V3H2zm10 8H4V5h8v6z"/>
  <path d="M3 7.5h1.5v1H3zm3 0h1.5v1H6zm3 0h1.5v1H9zm3 0h1.5v1H12z"/>
</svg>`,

  'file-operations/print-titles': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3v10h12V3H2zm10 8H4V6h8v5zM4 5V4h8v1H4z"/>
</svg>`,

  'file-operations/scale-width': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 4v8h12V4H2zm10 6H4V6h8v4z"/>
  <path d="M4 8h2l-1-1.5L4 8zm8 0h-2l1-1.5L12 8z"/>
</svg>`,

  'file-operations/scale-height': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2h8v12H4V2zm6 10V4H6v8h4z"/>
  <path d="M8 4v2l1.5-1L8 4zm0 8V10l1.5 1L8 12z"/>
</svg>`,

  // ==========================================================================
  // Themes
  // ==========================================================================
  'misc/themes': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v10c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3zm1 0v10h10V3H3z"/>
  <rect x="4" y="4" width="3" height="3" fill="#0078D4"/>
  <rect x="9" y="4" width="3" height="3" fill="#107C10"/>
  <rect x="4" y="9" width="3" height="3" fill="#D83B01"/>
  <rect x="9" y="9" width="3" height="3" fill="#8661C5"/>
</svg>`,

  'misc/theme-colors': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <circle cx="5" cy="5" r="2.5" fill="#0078D4"/>
  <circle cx="11" cy="5" r="2.5" fill="#107C10"/>
  <circle cx="5" cy="11" r="2.5" fill="#D83B01"/>
  <circle cx="11" cy="11" r="2.5" fill="#8661C5"/>
</svg>`,

  'misc/theme-fonts': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="2" y="12" font-size="11" font-weight="600" font-family="serif">A</text>
  <text x="9" y="12" font-size="8" font-weight="400" font-family="sans-serif">a</text>
</svg>`,

  // ==========================================================================
  // Automate
  // ==========================================================================
  'misc/extension': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M13.5 7H13V5c0-.6-.4-1-1-1h-2v-.5c0-.8-.7-1.5-1.5-1.5S7 2.7 7 3.5V4H5c-.6 0-1 .4-1 1v2.5h.5c.8 0 1.5.7 1.5 1.5S5.3 10.5 4.5 10.5H4V13c0 .6.4 1 1 1h2.5v-.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v.5H13c.6 0 1-.4 1-1v-2h.5c.8 0 1.5-.7 1.5-1.5S14.3 7 13.5 7z"/>
</svg>`,

  // ==========================================================================
  // Draw Tab
  // ==========================================================================
  'drawing/select-objects': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2l8 6-3.5.5L9 13l-1.5.5-1.5-4.5L3 11V2z"/>
</svg>`,

  'drawing/ink-to-shape': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 8c1-2 2 1 3-1s1 2 2 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M8 8h2l-1-1v2l1-1" fill="none" stroke="currentColor" stroke-width="1"/>
  <rect x="11" y="5" width="4" height="6" rx="0.5"/>
</svg>`,

  'drawing/ink-to-math': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 8c1-2 2 1 3-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M6 8h2l-1-1v2l1-1" fill="none" stroke="currentColor" stroke-width="1"/>
  <text x="9" y="11" font-size="8" font-weight="500" font-family="serif">Σx</text>
</svg>`,

  // ==========================================================================
  // Merge Cells
  // ==========================================================================
  'data-tables/merge-center': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 2h12v12H2V2zm10 10V4H4v8h8z"/>
  <path d="M5 7h6v2H5z"/>
</svg>`,

  'data-tables/merge-across': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 2h12v12H2V2zm10 10V4H4v8h8z"/>
  <path d="M4 6h8v0.5H4zm0 3.5h8v0.5H4z"/>
  <path d="M6 8l1.5-1.5v1h1v-1L10 8 8.5 9.5v-1h-1v1L6 8z"/>
</svg>`,

  // ==========================================================================
  // Data Connections
  // ==========================================================================
  'data-tables/connections': `<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="8" cy="4" rx="5" ry="2"/>
  <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4"/>
  <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`,

  'data-tables/get-data': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="8" cy="4" rx="5" ry="2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M3 4v6c0 1.1 2.24 2 5 2s5-.9 5-2V4" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M3 7c0 1.1 2.24 2 5 2s5-.9 5-2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M12 10l2 2-2 2" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <path d="M14 12H10" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  // ==========================================================================
  // Z-Order (Floating Objects)
  // ==========================================================================
  'shapes/bring-to-front': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="8" height="8" rx="1"/>
  <path d="M2 2v8h2V4h6V2H2z" opacity="0.4"/>
</svg>`,

  'shapes/send-to-back': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="8" height="8" rx="1" opacity="0.4"/>
  <path d="M6 6v8h8V6H6zm6 6H8V8h4v4z"/>
</svg>`,

  'shapes/bring-forward': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 2H3c-.6 0-1 .4-1 1v3h1.5V3.5H6V2zm6 12h3c.6 0 1-.4 1-1v-3h-1.5v2.5H12V14z"/>
  <rect x="4" y="5" width="8" height="8" rx="1" opacity="0.7"/>
</svg>`,

  'shapes/send-backward': `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2h3c.6 0 1 .4 1 1v3h-1.5V3.5H10V2zM6 14H3c-.6 0-1-.4-1-1v-3h1.5v2.5H6V14z"/>
  <rect x="4" y="3" width="8" height="8" rx="1" opacity="0.7"/>
</svg>`,

  'shapes/rounded-rect': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="5" width="18" height="14" rx="4"/>
</svg>`,

  'shapes/diamond': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
  <polygon points="12,2 22,12 12,22 2,12" stroke-linejoin="round"/>
</svg>`,

  // ==========================================================================
  // Sparklines
  // ==========================================================================
  'data-tables/sparkline-line': `<svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
  <polyline points="2,14 6,8 10,12 14,4 18,10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  'data-tables/sparkline-column': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="10" width="3" height="8" rx="0.5"/>
  <rect x="6" y="6" width="3" height="12" rx="0.5"/>
  <rect x="10" y="8" width="3" height="10" rx="0.5"/>
  <rect x="14" y="4" width="3" height="14" rx="0.5"/>
</svg>`,

  'data-tables/sparkline-winloss': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="5" width="3" height="5" rx="0.5" fill="#107C10"/>
  <rect x="10" y="5" width="3" height="5" rx="0.5" fill="#107C10"/>
  <rect x="14" y="5" width="3" height="5" rx="0.5" fill="#107C10"/>
  <rect x="6" y="10" width="3" height="5" rx="0.5" fill="#D83B01"/>
</svg>`,

  // ==========================================================================
  // Insert Tab - Illustrations
  // ==========================================================================
  'insert-illustrations/icons': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <circle cx="5" cy="5" r="2"/>
  <rect x="10" y="3" width="4" height="4" rx="0.5"/>
  <polygon points="5,12 3,16 7,16"/>
  <path d="M12 12l2 4 2-4z"/>
</svg>`,

  'insert-illustrations/3d-models': `<svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2l7 4v8l-7 4-7-4V6l7-4z"/>
  <path d="M10 10v8M10 10l7-4M10 10L3 6"/>
</svg>`,

  'insert-illustrations/smartart': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="7" y="2" width="6" height="4" rx="1"/>
  <rect x="2" y="14" width="5" height="4" rx="1"/>
  <rect x="13" y="14" width="5" height="4" rx="1"/>
  <path d="M10 6v4M10 10L4.5 14M10 10l5.5 4" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`,

  'insert-illustrations/screenshot': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 4h14v10H3V4zm1 1v8h12V5H4z"/>
  <path d="M6 16h8v1H6z" opacity="0.5"/>
  <path d="M10 14v2" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="15" cy="7" r="2" fill="var(--color-primary, #0078D4)"/>
</svg>`,

  // ==========================================================================
  // Insert Tab - Text Group
  // ==========================================================================
  'insert-illustrations/header-footer': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 3h14v2H3zm0 12h14v2H3z"/>
  <path d="M3 7h14v6H3V7zm1 1v4h12V8H4z" opacity="0.5"/>
</svg>`,

  'insert-illustrations/wordart': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="3" y="15" font-size="14" font-weight="bold" font-style="italic" font-family="serif">A</text>
  <path d="M12 5c3 0 5 2 5 5s-2 5-5 5" fill="none" stroke="var(--color-primary, #0078D4)" stroke-width="2"/>
</svg>`,

  'insert-illustrations/object': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="6" y="6" width="8" height="8" rx="1" opacity="0.6"/>
  <path d="M8 10h4M10 8v4" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  'insert-illustrations/equation': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <text x="2" y="14" font-size="12" font-style="italic" font-family="serif">π</text>
  <path d="M10 6h7M10 10h7M10 14h7" stroke="currentColor" stroke-width="1" opacity="0.5"/>
</svg>`,

  'comments/new-comment': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 3h14v11H8l-3 3v-3H3V3zm1 1v9h3v2l2-2h7V4H4z"/>
  <path d="M10 7v4M8 9h4" stroke="currentColor" stroke-width="1.5"/>
</svg>`,

  // ==========================================================================
  // Insert Tab - Filters (Slicer, Timeline)
  // ==========================================================================
  'insert-illustrations/slicer': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="2" width="14" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="3" y="2" width="14" height="4" fill="currentColor" fill-opacity="0.2"/>
  <rect x="5" y="8" width="2" height="2"/>
  <rect x="9" y="8" width="6" height="2" fill-opacity="0.5"/>
  <rect x="5" y="12" width="2" height="2"/>
  <rect x="9" y="12" width="6" height="2" fill-opacity="0.5"/>
</svg>`,

  'insert-illustrations/timeline': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="4" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="4" y="12" width="12" height="2" fill-opacity="0.3"/>
  <rect x="6" y="12" width="4" height="2"/>
  <circle cx="5" cy="8" r="1.5"/>
  <circle cx="10" cy="8" r="1.5"/>
  <circle cx="15" cy="8" r="1.5"/>
</svg>`,

  // ==========================================================================
  // Insert Tab - Charts
  // ==========================================================================
  'insert-illustrations/recommended-charts': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="11" width="3" height="6"/>
  <rect x="8" y="7" width="3" height="10"/>
  <rect x="13" y="9" width="3" height="8"/>
  <path d="M16 2l.7 1.5L18.2 4l-1.5.7-.7 1.5-.7-1.5L13.8 4l1.5-.7L16 2z"/>
</svg>`,

  'insert-illustrations/pivot-chart': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="2" y="2" width="16" height="4" fill-opacity="0.2"/>
  <rect x="5" y="10" width="2" height="5"/>
  <rect x="9" y="8" width="2" height="7"/>
  <rect x="13" y="11" width="2" height="4"/>
</svg>`,

  // ==========================================================================
  // Insert Tab - Tables
  // ==========================================================================
  'insert-illustrations/forms': `<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2h9l4 4v12c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3c0-.6.4-1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M13 2v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="5" y="8" width="2" height="2" rx="0.3"/>
  <rect x="8" y="8" width="7" height="2" rx="0.3" fill-opacity="0.5"/>
  <rect x="5" y="12" width="2" height="2" rx="0.3"/>
  <rect x="8" y="12" width="7" height="2" rx="0.3" fill-opacity="0.5"/>
</svg>`,

  // ==========================================================================
  // UI Elements
  // ==========================================================================
  'ui/dropdown-arrow': `<svg width="24" height="24" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3.5L5 6.5L8 3.5"/>
</svg>`,
};

/**
 * Save SVG to file
 */
function saveIcon(path, svgContent) {
  const fullPath = join(SRC_DIR, `${path}.svg`);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Clean up whitespace while preserving structure
  const cleaned = svgContent
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  writeFileSync(fullPath, cleaned);
  return fullPath;
}

/**
 * Main extraction function
 */
function extractIcons() {
  console.log('Custom Icon Extraction');
  console.log('======================\n');

  const total = Object.keys(CUSTOM_ICONS).length;
  let success = 0;

  console.log(`Extracting ${total} custom icons...\n`);

  for (const [path, svg] of Object.entries(CUSTOM_ICONS)) {
    try {
      const fullPath = saveIcon(path, svg);
      console.log(`  ${path}.svg`);
      success++;
    } catch (error) {
      console.error(`  FAILED: ${path} - ${error.message}`);
    }
  }

  console.log('\n======================');
  console.log(`Done! ${success}/${total} custom icons extracted.`);

  // Summary by category
  console.log('\nIcons by category:');
  const byCategory = {};
  for (const path of Object.keys(CUSTOM_ICONS)) {
    const category = path.split('/')[0];
    byCategory[category] = (byCategory[category] || 0) + 1;
  }
  for (const [category, count] of Object.entries(byCategory).sort()) {
    console.log(`  ${category}: ${count}`);
  }
}

// Run
extractIcons();
