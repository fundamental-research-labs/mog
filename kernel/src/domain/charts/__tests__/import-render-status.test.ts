import {
  hasImportStatus,
  importStatusToTerminalRenderStatus,
  isChartPayload,
} from '../bridge/import-render-status';

describe('importStatusToTerminalRenderStatus', () => {
  it('normalizes terminal string tokens', () => {
    expect(importStatusToTerminalRenderStatus('non-renderable')).toEqual({
      terminal: true,
      message: 'Imported chart cannot be rendered',
      raw: 'non-renderable',
    });
    expect(importStatusToTerminalRenderStatus('unsupported_chart')).toEqual({
      terminal: true,
      message: 'Imported chart cannot be rendered',
      raw: 'unsupported_chart',
    });
  });

  it('normalizes object status tokens and message fields', () => {
    expect(
      importStatusToTerminalRenderStatus({
        state: 'preserved not renderable',
        label: 'Modern chart preserved',
      }),
    ).toEqual({
      terminal: true,
      message: 'Modern chart preserved',
      raw: {
        state: 'preserved not renderable',
        label: 'Modern chart preserved',
      },
    });
  });

  it('uses renderable flags as terminal status authority', () => {
    expect(
      importStatusToTerminalRenderStatus({
        renderable: false,
        message: 'Renderer unavailable',
      }),
    ).toEqual({
      terminal: true,
      message: 'Renderer unavailable',
      raw: {
        renderable: false,
        message: 'Renderer unavailable',
      },
    });
    expect(importStatusToTerminalRenderStatus({ renderable: true, state: 'ready' })).toBeNull();
  });

  it('uses terminal flags without treating normal tokens as terminal placeholders', () => {
    expect(importStatusToTerminalRenderStatus({ terminal: true, status: 'ready' })).toBeNull();
    expect(
      importStatusToTerminalRenderStatus({
        isTerminal: true,
        code: 'failed',
        reason: 'Import failed',
      }),
    ).toEqual({
      terminal: true,
      message: 'Import failed',
      raw: {
        isTerminal: true,
        code: 'failed',
        reason: 'Import failed',
      },
    });
  });

  it('handles generated ImportObjectStatus recoverability and renderability independently', () => {
    expect(
      importStatusToTerminalRenderStatus({
        source: 'xlsx',
        featureKind: 'chart',
        recoverability: 'partiallySupported',
        renderability: 'notRenderable',
        editability: 'partiallyEditable',
        diagnostics: [{ message: 'ChartEx funnel data projection is not implemented' }],
      }),
    ).toEqual({
      terminal: true,
      message: 'ChartEx funnel data projection is not implemented',
      raw: {
        source: 'xlsx',
        featureKind: 'chart',
        recoverability: 'partiallySupported',
        renderability: 'notRenderable',
        editability: 'partiallyEditable',
        diagnostics: [{ message: 'ChartEx funnel data projection is not implemented' }],
      },
    });

    expect(
      importStatusToTerminalRenderStatus({
        source: 'xlsx',
        featureKind: 'chart',
        recoverability: 'unsupportedPreserved',
        renderability: 'renderable',
        editability: 'partiallyEditable',
      }),
    ).toEqual({
      terminal: true,
      message: 'Imported chart cannot be rendered',
      raw: {
        source: 'xlsx',
        featureKind: 'chart',
        recoverability: 'unsupportedPreserved',
        renderability: 'renderable',
        editability: 'partiallyEditable',
      },
    });
  });

  it('treats ChartEx Pareto preserved-not-renderable status as terminal after data projection', () => {
    const status = {
      source: 'xlsx',
      featureKind: 'chart',
      recoverability: 'preservedNotRenderable',
      renderability: 'notRenderable',
      editability: 'partiallyEditable',
      diagnostics: [
        {
          code: 'UnsupportedFeature',
          message: 'ChartEx pareto is preserved but not rendered as a plain bar chart',
        },
      ],
    };

    expect(importStatusToTerminalRenderStatus(status)).toEqual({
      terminal: true,
      message: 'ChartEx pareto is preserved but not rendered as a plain bar chart',
      raw: status,
    });
  });

  it('ignores absent, ready, and renderable statuses', () => {
    expect(importStatusToTerminalRenderStatus(null)).toBeNull();
    expect(importStatusToTerminalRenderStatus(undefined)).toBeNull();
    expect(importStatusToTerminalRenderStatus('ready')).toBeNull();
    expect(importStatusToTerminalRenderStatus({ status: 'success' })).toBeNull();
  });
});

describe('import render-status payload guards', () => {
  it('detects importStatus fields independently from chart payloads', () => {
    expect(hasImportStatus({ importStatus: undefined })).toBe(true);
    expect(hasImportStatus({ state: 'unsupported' })).toBe(false);
  });

  it('detects chart floating-object payloads', () => {
    expect(isChartPayload({ type: 'chart', importStatus: 'unsupported' })).toBe(true);
    expect(isChartPayload({ type: 'shape', importStatus: 'unsupported' })).toBe(false);
  });
});
