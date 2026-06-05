import {
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
} from '../../core/config-to-spec/fields';
import {
  isLayerSpec,
  type ChartSpec,
  type EncodingSpec,
  type MarkSpec,
  type StockGlyphVisualSpec,
} from '../../grammar/spec';

export function isNativeStockLayerSpec(spec: ChartSpec): boolean {
  if (markType(spec) === 'stockGlyph') return true;
  if (!isLayerSpec(spec)) return false;

  if (spec.layer.some((layer) => markType(layer) === 'stockGlyph')) return true;

  const hasWick = spec.layer.some(
    (layer) =>
      markType(layer) === 'rule' &&
      layer.encoding?.y?.field === STOCK_LOW_FIELD &&
      layer.encoding?.y2?.field === STOCK_HIGH_FIELD,
  );
  const hasCloseTick = spec.layer.some(
    (layer) => markType(layer) === 'tick' && layer.encoding?.y?.field === STOCK_CLOSE_FIELD,
  );
  const hasOpenCloseBody = stockLayerUsesOpenClose(spec) === true;

  return hasWick && (hasCloseTick || hasOpenCloseBody);
}

export function stockLayerUsesOpenClose(spec: ChartSpec): boolean | undefined {
  const stockGlyph = stockGlyphSpec(spec);
  if (stockGlyph) {
    const mark = stockGlyph.mark;
    const markSpec = typeof mark === 'object' ? mark : undefined;
    if (markSpec?.stockSubType === 'ohlc' || markSpec?.stockSubType === 'volume-ohlc') {
      return true;
    }
    if (markSpec?.stockSubType === 'hlc' || markSpec?.stockSubType === 'volume-hlc') {
      return false;
    }
    if (markSpec?.stockOpenField !== undefined) return true;
  }

  if (!isLayerSpec(spec)) return undefined;

  return spec.layer.some(
    (layer) =>
      markType(layer) === 'rule' &&
      layer.encoding?.y?.field === STOCK_OPEN_FIELD &&
      layer.encoding?.y2?.field === STOCK_CLOSE_FIELD,
  );
}

export function stockLayerEncoding(spec: ChartSpec): EncodingSpec | undefined {
  const stockGlyph = stockGlyphSpec(spec);
  if (stockGlyph?.encoding) return stockGlyph.encoding;
  if (!isLayerSpec(spec)) return spec.encoding;

  const priceLayer =
    spec.layer.find(
      (layer) =>
        markType(layer) === 'rule' &&
        layer.encoding?.y?.field === STOCK_LOW_FIELD &&
        layer.encoding?.y2?.field === STOCK_HIGH_FIELD,
    ) ??
    spec.layer.find(
      (layer) =>
        markType(layer) === 'rule' &&
        layer.encoding?.y?.field === STOCK_OPEN_FIELD &&
        layer.encoding?.y2?.field === STOCK_CLOSE_FIELD,
    ) ??
    spec.layer.find(
      (layer) => markType(layer) === 'tick' && layer.encoding?.y?.field === STOCK_CLOSE_FIELD,
    );

  return priceLayer?.encoding ?? spec.encoding;
}

export function stockLayerVisual(spec: ChartSpec): StockGlyphVisualSpec | undefined {
  const stockGlyph = stockGlyphSpec(spec);
  const mark = stockGlyph?.mark;
  return typeof mark === 'object' ? mark.stockVisual : undefined;
}

function stockGlyphSpec(spec: ChartSpec): ChartSpec | undefined {
  if (markType(spec) === 'stockGlyph') return spec;
  if (!isLayerSpec(spec)) return undefined;
  return spec.layer.find((layer) => markType(layer) === 'stockGlyph');
}

function markType(spec: ChartSpec): string | undefined {
  const mark = spec.mark;
  return typeof mark === 'string' ? mark : (mark as MarkSpec | undefined)?.type;
}
