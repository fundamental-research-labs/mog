/**
 * WorkbookCellStyles -- Cell style management sub-API interface.
 *
 * Provides CRUD operations for cell styles and cell format lookup.
 */
import type { CellFormat } from '../types';
import type { CellStyle, StyleCategory } from '@mog/types-core/core';

export type CellStyleSource = 'all' | 'builtIn' | 'custom';

export interface CellStyleListOptions {
  /** Which style source to include. Defaults to all styles. */
  source?: CellStyleSource;
  /** Restrict results to a single style category. */
  category?: StyleCategory;
}

export interface CellStyleCategoryInfo {
  /** Stable category identifier used by CellStyle.category. */
  id: StyleCategory;
  /** User-facing category label. */
  label: string;
  /** Display order within the catalog. */
  order: number;
}

export interface CellStyleCatalog {
  /** Ordered category metadata for categories with matching styles. */
  categories: readonly CellStyleCategoryInfo[];
  /** Styles matching the catalog query. */
  styles: readonly CellStyle[];
}

export interface WorkbookCellStyles {
  /** Get a cell format (style) by its style ID. Returns the format, or null if not found. */
  get(styleId: string): Promise<CellFormat | null>;

  /** Get a full cell style by ID. Returns null if not found. */
  getStyle(styleId: string): Promise<CellStyle | null>;

  /** List cell styles. Defaults to built-in + custom styles. */
  list(options?: CellStyleListOptions): Promise<CellStyle[]>;

  /** Get ordered style catalog data for gallery-style consumers. */
  getCatalog(options?: Pick<CellStyleListOptions, 'source'>): Promise<CellStyleCatalog>;

  /** Create a new custom cell style. */
  add(name: string, format: CellFormat): Promise<CellStyle>;

  /** Update a custom cell style. Returns the updated style, or null if not found. */
  update(
    styleId: string,
    updates: Partial<Omit<CellStyle, 'id' | 'builtIn'>>,
  ): Promise<CellStyle | null>;

  /** Delete a custom cell style. Returns true if deleted. */
  remove(styleId: string): Promise<boolean>;
}
