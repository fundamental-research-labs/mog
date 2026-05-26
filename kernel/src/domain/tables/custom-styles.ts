/**
 * Custom Table Styles Domain Module
 *
 * CRUD operations for custom table styles stored at the workbook level.
 * All operations delegate to ComputeBridge (Rust compute-core).
 *
 * Types are aligned with Rust compute-core (compute-table/custom_styles.rs).
 */

import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';

// =============================================================================
// Types — aligned with Rust compute-table::custom_styles
// =============================================================================

/**
 * Stripe pattern configuration for rows or columns.
 * Excel supports stripe sizes of 1-9 alternating rows/columns.
 */
export interface StripePattern {
  /** Number of rows/columns per stripe (1-9, default 1) */
  stripeSize: number;
  /** Fill color for stripe 1 */
  stripe1Fill?: string;
  /** Fill color for stripe 2 */
  stripe2Fill?: string;
}

/**
 * Element formatting for table style elements.
 */
export interface TableElementStyle {
  /** Fill (background) color */
  fill?: string;
  /** Font color (hex string) */
  fontColor?: string;
  /** Font bold flag */
  fontBold?: boolean;
  /** Border style for top */
  borderTop?: string;
  /** Border style for bottom */
  borderBottom?: string;
  /** Border style for left */
  borderLeft?: string;
  /** Border style for right */
  borderRight?: string;
}

/**
 * Complete custom table style definition.
 */
export interface CustomTableStyleConfig {
  /** Unique ID */
  id: string;
  /** User-defined name for the style */
  name: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
  /** Header row formatting */
  headerRow: TableElementStyle;
  /** Total row formatting */
  totalRow: TableElementStyle;
  /** First column formatting */
  firstColumn: TableElementStyle;
  /** Last column formatting */
  lastColumn: TableElementStyle;
  /** Row stripe pattern */
  rowStripes: StripePattern;
  /** Column stripe pattern */
  columnStripes: StripePattern;
  /** Whole table default styling */
  wholeTable: TableElementStyle;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_STRIPE_PATTERN: StripePattern = {
  stripeSize: 1,
};

const DEFAULT_ELEMENT_STYLE: TableElementStyle = {};

// =============================================================================
// Query Operations (Read — from ComputeBridge)
// =============================================================================

/**
 * Get a custom table style by ID.
 *
 * @param ctx - Store context
 * @param styleId - Style ID to find
 * @returns The style if found, undefined otherwise
 */
export async function getCustomTableStyle(
  ctx: DocumentContext,
  styleId: string,
): Promise<CustomTableStyleConfig | undefined> {
  const allStyles = await ctx.computeBridge.getAllCustomTableStyles();
  return allStyles.find((s: CustomTableStyleConfig) => s.id === styleId);
}

/**
 * Get a custom table style by name (case-insensitive).
 *
 * @param ctx - Store context
 * @param name - Style name to find
 * @returns The style if found, undefined otherwise
 */
export async function getCustomTableStyleByName(
  ctx: DocumentContext,
  name: string,
): Promise<CustomTableStyleConfig | undefined> {
  const allStyles = await ctx.computeBridge.getAllCustomTableStyles();
  const lowerName = name.toLowerCase();

  return allStyles.find((style: CustomTableStyleConfig) => style.name.toLowerCase() === lowerName);
}

/**
 * Get all custom table styles.
 *
 * @param ctx - Store context
 * @returns Array of all custom table styles
 */
export async function getAllCustomTableStyles(
  ctx: DocumentContext,
): Promise<CustomTableStyleConfig[]> {
  const styles = await ctx.computeBridge.getAllCustomTableStyles();
  return styles.sort((a: CustomTableStyleConfig, b: CustomTableStyleConfig) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Check if a custom table style name is available.
 *
 * @param ctx - Store context
 * @param name - Proposed name
 * @param excludeId - Style ID to exclude from check (for renames)
 * @returns True if name is available
 */
export async function isTableStyleNameAvailable(
  ctx: DocumentContext,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const allStyles = await ctx.computeBridge.getAllCustomTableStyles();
  const lowerName = name.toLowerCase();

  for (const style of allStyles) {
    if (excludeId && style.id === excludeId) continue;
    if (style.name.toLowerCase() === lowerName) {
      return false;
    }
  }

  return true;
}

/**
 * Get the count of custom table styles.
 *
 * @param ctx - Store context
 * @returns Number of custom table styles
 */
export async function getCustomTableStyleCount(ctx: DocumentContext): Promise<number> {
  const allStyles = await ctx.computeBridge.getAllCustomTableStyles();
  return allStyles.length;
}

// =============================================================================
// Mutation Operations (Write — delegates to ComputeBridge)
// =============================================================================

/**
 * Create a new custom table style.
 *
 * @param ctx - Store context
 * @param name - Name for the new style
 * @param config - Style configuration (without id/timestamps)
 * @param _origin - Transaction origin (unused — ComputeBridge handles it)
 * @returns The created style
 * @throws Error if name is not available
 */
export async function createCustomTableStyle(
  ctx: DocumentContext,
  name: string,
  config: Partial<Omit<CustomTableStyleConfig, 'id' | 'name' | 'createdAt' | 'updatedAt'>>,
  _origin: string = 'user',
): Promise<CustomTableStyleConfig> {
  if (!(await isTableStyleNameAvailable(ctx, name))) {
    throw new KernelError('TABLE_STYLE_EXISTS', `Table style name already exists: ${name}`);
  }

  const id = `ts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();

  const style: CustomTableStyleConfig = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    headerRow: config.headerRow ?? { ...DEFAULT_ELEMENT_STYLE },
    totalRow: config.totalRow ?? { ...DEFAULT_ELEMENT_STYLE },
    firstColumn: config.firstColumn ?? { ...DEFAULT_ELEMENT_STYLE },
    lastColumn: config.lastColumn ?? { ...DEFAULT_ELEMENT_STYLE },
    rowStripes: config.rowStripes ?? { ...DEFAULT_STRIPE_PATTERN },
    columnStripes: config.columnStripes ?? { ...DEFAULT_STRIPE_PATTERN },
    wholeTable: config.wholeTable ?? { ...DEFAULT_ELEMENT_STYLE },
  };

  await ctx.computeBridge.createCustomTableStyle(style);

  return style;
}

/**
 * Update an existing custom table style.
 *
 * @param ctx - Store context
 * @param styleId - Style ID to update
 * @param updates - Partial updates to apply
 * @param _origin - Transaction origin (unused — ComputeBridge handles it)
 * @throws Error if style not found or name conflict
 */
export async function updateCustomTableStyle(
  ctx: DocumentContext,
  styleId: string,
  updates: Partial<Omit<CustomTableStyleConfig, 'id' | 'createdAt'>>,
  _origin: string = 'user',
): Promise<void> {
  const existing = await getCustomTableStyle(ctx, styleId);

  if (!existing) {
    throw new KernelError('TABLE_STYLE_NOT_FOUND', `Table style not found: ${styleId}`);
  }

  // Check name uniqueness if name is being changed
  if (updates.name && updates.name !== existing.name) {
    if (!(await isTableStyleNameAvailable(ctx, updates.name, styleId))) {
      throw new KernelError(
        'TABLE_STYLE_EXISTS',
        `Table style name already exists: ${updates.name}`,
      );
    }
  }

  const updated: CustomTableStyleConfig = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  await ctx.computeBridge.updateCustomTableStyle(existing.name, updated);
}

/**
 * Duplicate an existing custom table style.
 *
 * @param ctx - Store context
 * @param sourceStyleId - Style ID to duplicate
 * @param newName - Name for the duplicate (optional, auto-generated if not provided)
 * @param origin - Transaction origin (default: 'user')
 * @returns The duplicated style
 * @throws Error if source style not found
 */
export async function duplicateCustomTableStyle(
  ctx: DocumentContext,
  sourceStyleId: string,
  newName?: string,
  origin: string = 'user',
): Promise<CustomTableStyleConfig> {
  const source = await getCustomTableStyle(ctx, sourceStyleId);

  if (!source) {
    throw new KernelError(
      'TABLE_STYLE_NOT_FOUND',
      `Source table style not found: ${sourceStyleId}`,
    );
  }

  let name = newName ?? `Copy of ${source.name}`;

  let counter = 1;
  const baseName = name;
  while (!(await isTableStyleNameAvailable(ctx, name))) {
    counter++;
    name = `${baseName} (${counter})`;
  }

  return createCustomTableStyle(
    ctx,
    name,
    {
      headerRow: { ...source.headerRow },
      totalRow: { ...source.totalRow },
      firstColumn: { ...source.firstColumn },
      lastColumn: { ...source.lastColumn },
      rowStripes: { ...source.rowStripes },
      columnStripes: { ...source.columnStripes },
      wholeTable: { ...source.wholeTable },
    },
    origin,
  );
}

/**
 * Delete a custom table style.
 *
 * @param ctx - Store context
 * @param styleId - Style ID to delete
 * @param _origin - Transaction origin (unused — ComputeBridge handles it)
 * @returns True if deleted, false if not found
 */
export async function deleteCustomTableStyle(
  ctx: DocumentContext,
  styleId: string,
  _origin: string = 'user',
): Promise<boolean> {
  const existing = await getCustomTableStyle(ctx, styleId);
  if (!existing) {
    return false;
  }

  await ctx.computeBridge.deleteCustomTableStyle(existing.name);

  return true;
}

/**
 * Check if a custom table style exists.
 *
 * @param ctx - Store context
 * @param styleId - Style ID to check
 * @returns True if style exists
 */
export async function customTableStyleExists(
  ctx: DocumentContext,
  styleId: string,
): Promise<boolean> {
  return (await getCustomTableStyle(ctx, styleId)) !== undefined;
}
