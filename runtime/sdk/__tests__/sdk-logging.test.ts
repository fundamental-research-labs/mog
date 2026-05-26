import { jest } from '@jest/globals';
import { createNodeHeadlessHost, type MogSdkLogger } from '../src/host-adapters/node-headless-host';

function createHost(options: { logger?: MogSdkLogger | false; debug?: boolean } = {}) {
  return createNodeHeadlessHost({
    documentId: 'sdk-logging-test',
    timezone: 'UTC',
    ...options,
  });
}

describe('SDK logging', () => {
  const originalSdkDebug = process.env.MOG_SDK_DEBUG;
  const originalMogDebug = process.env.MOG_DEBUG;

  afterEach(() => {
    process.env.MOG_SDK_DEBUG = originalSdkDebug;
    process.env.MOG_DEBUG = originalMogDebug;
    jest.restoreAllMocks();
  });

  it('keeps host diagnostics silent by default', () => {
    delete process.env.MOG_SDK_DEBUG;
    delete process.env.MOG_DEBUG;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const host = createHost();

    host.kernelContext.diagnostics.emit({
      kind: 'documentAuthorization.denied',
      code: 'DENIED',
      correlationId: 'corr',
      operation: 'open',
      reason: 'denied',
      timestamp: Date.now(),
    });
    host.kernelContext.diagnostics.emit({
      kind: 'storage.failure',
      code: 'FAILED',
      correlationId: 'corr',
      providerRefId: 'provider',
      phase: 'open',
      timestamp: Date.now(),
    });

    expect(warn).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it('routes host diagnostics through the provided logger', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = {
      warn: jest.fn(),
      debug: jest.fn(),
    };
    const host = createHost({ logger });

    host.kernelContext.diagnostics.emit({
      kind: 'documentAuthorization.denied',
      code: 'DENIED',
      correlationId: 'corr',
      operation: 'open',
      reason: 'denied',
      timestamp: Date.now(),
    });
    host.kernelContext.diagnostics.emit({
      kind: 'storage.failure',
      code: 'FAILED',
      correlationId: 'corr',
      providerRefId: 'provider',
      phase: 'open',
      timestamp: Date.now(),
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it('supports explicit console diagnostics through the debug gate', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const host = createHost({ debug: true });

    host.kernelContext.diagnostics.emit({
      kind: 'documentAuthorization.denied',
      code: 'DENIED',
      correlationId: 'corr',
      operation: 'open',
      reason: 'denied',
      timestamp: Date.now(),
    });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('supports env-gated console diagnostics', () => {
    process.env.MOG_SDK_DEBUG = '1';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const host = createHost();

    host.kernelContext.diagnostics.emit({
      kind: 'documentAuthorization.denied',
      code: 'DENIED',
      correlationId: 'corr',
      operation: 'open',
      reason: 'denied',
      timestamp: Date.now(),
    });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('lets logger false override debug environment variables', () => {
    process.env.MOG_SDK_DEBUG = '1';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const host = createHost({ logger: false });

    host.kernelContext.diagnostics.emit({
      kind: 'documentAuthorization.denied',
      code: 'DENIED',
      correlationId: 'corr',
      operation: 'open',
      reason: 'denied',
      timestamp: Date.now(),
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
