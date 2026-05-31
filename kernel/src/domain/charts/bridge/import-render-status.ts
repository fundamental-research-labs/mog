export type FloatingObjectWithImportStatus = {
  type?: unknown;
  importStatus?: unknown;
};

export type ImportedChartRenderStatus = {
  terminal: true;
  message: string;
  raw: unknown;
};

export function hasImportStatus(value: unknown): value is { importStatus: unknown } {
  return typeof value === 'object' && value !== null && 'importStatus' in value;
}

export function isChartPayload(value: unknown): value is FloatingObjectWithImportStatus {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'chart'
  );
}

function stringField(value: unknown, keys: string[]): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return undefined;
}

function booleanField(value: unknown, keys: string[]): boolean | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'boolean') return field;
  }
  return undefined;
}

export function importStatusToTerminalRenderStatus(
  status: unknown,
): ImportedChartRenderStatus | null {
  if (status === null || status === undefined) return null;

  const tokenSource =
    typeof status === 'string'
      ? status
      : stringField(status, [
          'state',
          'status',
          'kind',
          'code',
          'result',
          'recoverability',
          'renderability',
        ]);
  const token = tokenSource
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const renderable = booleanField(status, ['renderable', 'canRender']);
  const terminal = booleanField(status, ['terminal', 'isTerminal']);
  const normalTokens = ['renderable', 'ready', 'ok', 'success', 'loaded', 'native'];
  const terminalTokens = [
    'nonrenderable',
    'notrenderable',
    'preservednotrenderable',
    'unsupported',
    'unsupportedchart',
    'unsupportedcharttype',
    'placeholder',
    'terminal',
    'failed',
    'error',
  ];

  const isTerminal =
    renderable === false ||
    (terminal === true && token !== undefined && !normalTokens.includes(token)) ||
    (token !== undefined && terminalTokens.includes(token));
  if (!isTerminal) return null;

  const message =
    stringField(status, ['message', 'label', 'reason', 'description']) ??
    'Imported chart cannot be rendered';
  return { terminal: true, message, raw: status };
}
