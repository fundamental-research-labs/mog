const MDW_CALIBRI_11_96DPI = 7;
const MDW_CALIBRI_11_MACOS = 8;
const DEFAULT_COLUMN_WIDTH_WINDOWS = 64;
const DEFAULT_COLUMN_WIDTH_MACOS = 72;
const DEFAULT_ROW_HEIGHT = 20;

export interface ComputeInitLayoutMetrics {
  readonly columnWidthMdw: number;
  readonly defaultColumnWidthPx: number;
  readonly defaultRowHeightPx: number;
}

type RuntimeNavigator = {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: {
    readonly platform?: string;
  };
};

type RuntimeLayoutEnvironment = {
  readonly window?: {
    readonly navigator?: RuntimeNavigator;
  };
};

export function computeInitLayoutMetrics(
  env: RuntimeLayoutEnvironment = globalThis as RuntimeLayoutEnvironment,
): ComputeInitLayoutMetrics | null {
  const browserNavigator = env.window?.navigator;
  if (!browserNavigator) return null;

  const platformSignals = [
    browserNavigator.userAgentData?.platform,
    browserNavigator.platform,
    browserNavigator.userAgent,
  ].join(' ');

  const isMac = /Mac/i.test(platformSignals);
  return {
    columnWidthMdw: isMac ? MDW_CALIBRI_11_MACOS : MDW_CALIBRI_11_96DPI,
    defaultColumnWidthPx: isMac ? DEFAULT_COLUMN_WIDTH_MACOS : DEFAULT_COLUMN_WIDTH_WINDOWS,
    defaultRowHeightPx: DEFAULT_ROW_HEIGHT,
  };
}
