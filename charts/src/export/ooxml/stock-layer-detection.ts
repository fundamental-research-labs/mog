import {
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
} from '../../core/config-to-spec/fields';
import { isLayerSpec, type ChartSpec, type EncodingSpec, type MarkSpec } from '../../grammar/spec';

export function isNativeStockLayerSpec(spec: ChartSpec): boolean {
  if (!isLayerSpec(spec)) return false;

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
  if (!isLayerSpec(spec)) return undefined;

  return spec.layer.some(
    (layer) =>
      markType(layer) === 'rule' &&
      layer.encoding?.y?.field === STOCK_OPEN_FIELD &&
      layer.encoding?.y2?.field === STOCK_CLOSE_FIELD,
  );
}

export function stockLayerEncoding(spec: ChartSpec): EncodingSpec | undefined {
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

function markType(spec: ChartSpec): string | undefined {
  const mark = spec.mark;
  return typeof mark === 'string' ? mark : (mark as MarkSpec | undefined)?.type;
}
