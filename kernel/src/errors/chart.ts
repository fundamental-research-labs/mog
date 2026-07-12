import { parseBridgeError } from '@mog/transport/bridge-error';

import { chartNotFound } from './api';

type NativeChartError = {
  readonly kind: string;
  readonly chartId?: string;
  readonly sheetId?: string;
};

/** Convert native chart target errors into the stable kernel error contract. */
export function translateNativeChartError(
  error: unknown,
  requestedChartTarget: unknown,
  resolvedChartId?: string,
): unknown {
  const native = parseBridgeError(error) as NativeChartError | null;
  if (native?.kind === 'ChartNotFound') {
    return chartNotFound(
      requestedChartTarget ?? native.chartId ?? '',
      error,
      resolvedChartId ?? native.chartId,
    );
  }
  return error;
}

export async function callNativeChartMutation<T>(
  chartTarget: unknown,
  call: () => Promise<T>,
  resolvedChartId?: string,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw translateNativeChartError(error, chartTarget, resolvedChartId);
  }
}
