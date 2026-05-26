import { KernelError, isKernelError } from '..';
import {
  DocumentDisposedError,
  DocumentLifecycleError,
  DocumentNotReadyError,
  EngineCreateError,
  HydrationError,
} from '../document';

describe('Document Lifecycle Errors', () => {
  describe('DocumentLifecycleError', () => {
    it('creates with code and message', () => {
      const error = new DocumentLifecycleError('DOC_LIFECYCLE_ERROR', 'lifecycle failed');
      expect(error.code).toBe('DOC_LIFECYCLE_ERROR');
      expect(error.message).toBe('lifecycle failed');
      expect(error.name).toBe('DocumentLifecycleError');
    });

    it('is an instance of KernelError and Error', () => {
      const error = new DocumentLifecycleError('DOC_LIFECYCLE_ERROR', 'lifecycle failed');
      expect(error).toBeInstanceOf(KernelError);
      expect(error).toBeInstanceOf(Error);
    });

    it('accepts options', () => {
      const error = new DocumentLifecycleError('DOC_LIFECYCLE_ERROR', 'failed', {
        context: { docId: 'doc-1' },
        suggestion: 'Reload the document',
      });
      expect(error.context).toEqual({ docId: 'doc-1' });
      expect(error.suggestion).toBe('Reload the document');
    });
  });

  describe('DocumentNotReadyError', () => {
    it('uses default message when none provided', () => {
      const error = new DocumentNotReadyError();
      expect(error.code).toBe('DOC_NOT_READY');
      expect(error.message).toBe('Document context not ready');
      expect(error.name).toBe('DocumentNotReadyError');
    });

    it('accepts a custom message', () => {
      const error = new DocumentNotReadyError('ctx accessed too early');
      expect(error.message).toBe('ctx accessed too early');
      expect(error.code).toBe('DOC_NOT_READY');
    });

    it('is an instance of DocumentLifecycleError', () => {
      const error = new DocumentNotReadyError();
      expect(error).toBeInstanceOf(DocumentLifecycleError);
      expect(error).toBeInstanceOf(KernelError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('EngineCreateError', () => {
    it('creates with message', () => {
      const error = new EngineCreateError('WASM failed to load');
      expect(error.code).toBe('DOC_ENGINE_CREATE_FAILED');
      expect(error.message).toBe('WASM failed to load');
      expect(error.name).toBe('EngineCreateError');
    });

    it('is an instance of DocumentLifecycleError', () => {
      const error = new EngineCreateError('failed');
      expect(error).toBeInstanceOf(DocumentLifecycleError);
      expect(error).toBeInstanceOf(KernelError);
    });
  });

  describe('HydrationError', () => {
    it('creates with message', () => {
      const error = new HydrationError('XLSX parse failed');
      expect(error.code).toBe('DOC_HYDRATION_FAILED');
      expect(error.message).toBe('XLSX parse failed');
      expect(error.name).toBe('HydrationError');
    });

    it('is an instance of DocumentLifecycleError', () => {
      const error = new HydrationError('failed');
      expect(error).toBeInstanceOf(DocumentLifecycleError);
      expect(error).toBeInstanceOf(KernelError);
    });
  });

  describe('DocumentDisposedError', () => {
    it('uses default message when none provided', () => {
      const error = new DocumentDisposedError();
      expect(error.code).toBe('DOC_DISPOSED');
      expect(error.message).toBe('Document has been disposed');
      expect(error.name).toBe('DocumentDisposedError');
    });

    it('accepts a custom message', () => {
      const error = new DocumentDisposedError('already destroyed');
      expect(error.message).toBe('already destroyed');
      expect(error.code).toBe('DOC_DISPOSED');
    });

    it('is an instance of DocumentLifecycleError', () => {
      const error = new DocumentDisposedError();
      expect(error).toBeInstanceOf(DocumentLifecycleError);
      expect(error).toBeInstanceOf(KernelError);
    });
  });

  describe('isKernelError()', () => {
    it('returns true for DocumentLifecycleError', () => {
      expect(isKernelError(new DocumentLifecycleError('DOC_LIFECYCLE_ERROR', 'x'))).toBe(true);
    });

    it('returns true for DocumentNotReadyError', () => {
      expect(isKernelError(new DocumentNotReadyError())).toBe(true);
    });

    it('returns true for EngineCreateError', () => {
      expect(isKernelError(new EngineCreateError('x'))).toBe(true);
    });

    it('returns true for HydrationError', () => {
      expect(isKernelError(new HydrationError('x'))).toBe(true);
    });

    it('returns true for DocumentDisposedError', () => {
      expect(isKernelError(new DocumentDisposedError())).toBe(true);
    });
  });

  describe('cause chain support', () => {
    it('preserves cause via options.cause', () => {
      const root = new Error('disk full');
      const error = new EngineCreateError('engine creation failed', { cause: root });
      expect(error.cause).toBe(root);
    });

    it('supports KernelError cause chain', () => {
      const root = new KernelError('BRIDGE_TRANSPORT_ERROR', 'connection lost');
      const error = new HydrationError('hydration failed', { cause: root });
      expect(error.cause).toBe(root);
      expect(error.cause).toBeInstanceOf(KernelError);
    });
  });

  describe('toJSON()', () => {
    it('serializes DocumentNotReadyError correctly', () => {
      const error = new DocumentNotReadyError('not ready yet');
      const json = error.toJSON();
      expect(json).toEqual({
        name: 'DocumentNotReadyError',
        code: 'DOC_NOT_READY',
        message: 'not ready yet',
        context: {},
        suggestion: undefined,
        path: undefined,
      });
    });

    it('serializes with context and nested KernelError cause', () => {
      const cause = new KernelError('BRIDGE_WASM_LOAD_FAILED', 'wasm error');
      const error = new EngineCreateError('engine failed', {
        context: { docId: 'abc' },
        cause,
      });
      const json = error.toJSON();
      expect(json.name).toBe('EngineCreateError');
      expect(json.code).toBe('DOC_ENGINE_CREATE_FAILED');
      expect(json.context).toEqual({ docId: 'abc' });
      expect(json.cause).toBeDefined();
      const causeJson = json.cause as Record<string, unknown>;
      expect(causeJson.code).toBe('BRIDGE_WASM_LOAD_FAILED');
    });
  });
});
