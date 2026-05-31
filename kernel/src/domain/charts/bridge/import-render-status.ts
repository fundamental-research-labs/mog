import type { ChartError } from '@mog-sdk/contracts/bridges';

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

function token(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function firstDiagnosticMessage(status: unknown): string | undefined {
  if (typeof status !== 'object' || status === null) return undefined;
  const diagnostics = (status as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return undefined;
  for (const diagnostic of diagnostics) {
    const message = stringField(diagnostic, ['message', 'description', 'reason']);
    if (message) return message;
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
  const statusToken = token(tokenSource);
  const recoverabilityToken = token(stringField(status, ['recoverability']));
  const renderabilityToken = token(stringField(status, ['renderability']));
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
  const terminalRecoverabilityTokens = [
    'preservednotrenderable',
    'unsupportedpreserved',
    'unsupporteddropped',
    'malformeddropped',
    'securitydisabled',
  ];
  const terminalRenderabilityTokens = ['placeholder', 'notrenderable'];

  const isTerminal =
    renderable === false ||
    (terminal === true && statusToken !== undefined && !normalTokens.includes(statusToken)) ||
    (statusToken !== undefined && terminalTokens.includes(statusToken)) ||
    (recoverabilityToken !== undefined &&
      terminalRecoverabilityTokens.includes(recoverabilityToken)) ||
    (renderabilityToken !== undefined && terminalRenderabilityTokens.includes(renderabilityToken));
  if (!isTerminal) return null;

  const message =
    stringField(status, ['message', 'label', 'reason', 'description']) ??
    firstDiagnosticMessage(status) ??
    'Imported chart cannot be rendered';
  return { terminal: true, message, raw: status };
}

export function importedChartRenderStatusToError(
  chartId: string,
  status: ImportedChartRenderStatus,
): ChartError {
  return {
    code: 'RENDER_FAILED',
    message: status.message,
    chartId,
    details: { importStatus: status.raw },
  };
}
