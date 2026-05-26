/**
 * WorkbookCellStylesImpl -- Cell style management sub-API implementation.
 *
 * Delegates cell style operations to domain/cells/cell-properties.
 */
import type {
  CellFormat,
  CellStyleCatalog,
  CellStyleListOptions,
  CellStyle,
  WorkbookCellStyles,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  STYLE_CATEGORY_LABELS,
  STYLE_CATEGORY_ORDER,
  getBuiltInStyles,
} from '../../domain/cells/built-in-styles';
import {
  createCustomStyle,
  deleteCustomStyle,
  getAllStyles,
  getCustomStyles,
  getStyleById,
  getStylesByCategory,
  updateCustomStyle,
} from '../../domain/cells/cell-properties';

export class WorkbookCellStylesImpl implements WorkbookCellStyles {
  constructor(private readonly ctx: DocumentContext) {}

  async get(styleId: string): Promise<CellFormat | null> {
    const style = await getStyleById(this.ctx, styleId);
    if (!style) return null;
    return style.format;
  }

  async getStyle(styleId: string): Promise<CellStyle | null> {
    return (await getStyleById(this.ctx, styleId)) ?? null;
  }

  async list(options: CellStyleListOptions = {}): Promise<CellStyle[]> {
    const source = options.source ?? 'all';
    if (options.category && source === 'all') {
      return getStylesByCategory(this.ctx, options.category);
    }

    const styles =
      source === 'builtIn'
        ? [...getBuiltInStyles()]
        : source === 'custom'
          ? await getCustomStyles(this.ctx)
          : await getAllStyles(this.ctx);

    return options.category
      ? styles.filter((style) => style.category === options.category)
      : styles;
  }

  async getCatalog(options: Pick<CellStyleListOptions, 'source'> = {}): Promise<CellStyleCatalog> {
    const styles = await this.list(options);
    const categoriesWithStyles = new Set(styles.map((style) => style.category));
    const categories = STYLE_CATEGORY_ORDER.filter((category) =>
      categoriesWithStyles.has(category),
    ).map((category, order) => ({
      id: category,
      label: STYLE_CATEGORY_LABELS[category],
      order,
    }));

    return { categories, styles };
  }

  async add(name: string, format: CellFormat): Promise<CellStyle> {
    return createCustomStyle(this.ctx, { id: name, name, category: 'custom', format });
  }

  async update(
    styleId: string,
    updates: Partial<Omit<CellStyle, 'id' | 'builtIn'>>,
  ): Promise<CellStyle | null> {
    const result = await updateCustomStyle(this.ctx, styleId, updates);
    return result ?? null;
  }

  async remove(styleId: string): Promise<boolean> {
    return deleteCustomStyle(this.ctx, styleId);
  }
}
