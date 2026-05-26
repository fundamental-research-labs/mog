import { BridgeError, isKernelError, KernelError } from '..';

describe('BridgeError', () => {
  describe('construction', () => {
    it('creates with code, command, and message', () => {
      const error = new BridgeError(
        'BRIDGE_COMMAND_FAILED',
        'compute_set_cell',
        'cell write failed',
      );
      expect(error.code).toBe('BRIDGE_COMMAND_FAILED');
      expect(error.command).toBe('compute_set_cell');
      expect(error.message).toBe('cell write failed');
      expect(error.name).toBe('BridgeError');
      expect(error.context).toEqual({ command: 'compute_set_cell' });
    });

    it('creates with options including cause and extra context', () => {
      const cause = new Error('root cause');
      const error = new BridgeError('BRIDGE_TRANSPORT_ERROR', 'invoke', 'transport failed', {
        context: { retries: 3 },
        suggestion: 'Retry the operation',
        cause,
      });
      expect(error.code).toBe('BRIDGE_TRANSPORT_ERROR');
      expect(error.command).toBe('invoke');
      expect(error.message).toBe('transport failed');
      expect(error.context).toEqual({ retries: 3, command: 'invoke' });
      expect(error.suggestion).toBe('Retry the operation');
      expect(error.cause).toBe(cause);
    });

    it('is an instance of Error, KernelError, and BridgeError', () => {
      const error = new BridgeError('BRIDGE_COMMAND_FAILED', 'cmd', 'msg');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(KernelError);
      expect(error).toBeInstanceOf(BridgeError);
    });
  });

  describe('BridgeError.fromCommand()', () => {
    it('wraps a plain Error, preserving it as cause', () => {
      const original = new Error('disk full');
      const wrapped = BridgeError.fromCommand(original, 'compute_init');
      expect(wrapped).toBeInstanceOf(BridgeError);
      expect(wrapped.code).toBe('BRIDGE_COMMAND_FAILED');
      expect(wrapped.command).toBe('compute_init');
      expect(wrapped.message).toBe('[compute_init] disk full');
      expect(wrapped.cause).toBe(original);
    });

    it('wraps a string error', () => {
      const wrapped = BridgeError.fromCommand('something broke', 'export_xlsx');
      expect(wrapped).toBeInstanceOf(BridgeError);
      expect(wrapped.message).toBe('[export_xlsx] something broke');
      expect(wrapped.cause).toBe('something broke');
    });

    it('does not double-wrap a BridgeError', () => {
      const original = new BridgeError('BRIDGE_TRANSPORT_ERROR', 'invoke', 'timeout');
      const result = BridgeError.fromCommand(original, 'other_command');
      expect(result).toBe(original);
    });

    it('wraps a KernelError (non-BridgeError) as a BridgeError', () => {
      const original = new KernelError('OPERATION_FAILED', 'generic failure');
      const wrapped = BridgeError.fromCommand(original, 'compute_init');
      expect(wrapped).toBeInstanceOf(BridgeError);
      expect(wrapped).not.toBe(original);
      expect(wrapped.cause).toBe(original);
    });

    it('uses a custom error code when provided', () => {
      const wrapped = BridgeError.fromCommand(new Error('oops'), 'cmd', 'BRIDGE_WASM_LOAD_FAILED');
      expect(wrapped.code).toBe('BRIDGE_WASM_LOAD_FAILED');
    });
  });

  describe('cause chain preservation', () => {
    it('preserves a deep cause chain via ES2022 Error cause', () => {
      const root = new Error('root');
      const mid = new BridgeError('BRIDGE_TRANSPORT_ERROR', 'transport', 'mid', { cause: root });
      const top = new BridgeError('BRIDGE_COMMAND_FAILED', 'command', 'top', { cause: mid });

      expect(top.cause).toBe(mid);
      expect((top.cause as BridgeError).cause).toBe(root);
    });
  });

  describe('isKernelError()', () => {
    it('returns true for BridgeError', () => {
      const error = new BridgeError('BRIDGE_COMMAND_FAILED', 'cmd', 'msg');
      expect(isKernelError(error)).toBe(true);
    });
  });

  describe('toJSON()', () => {
    it('includes command in context', () => {
      const error = new BridgeError('BRIDGE_COMMAND_FAILED', 'compute_set_cell', 'failed');
      const json = error.toJSON();
      expect(json.name).toBe('BridgeError');
      expect(json.code).toBe('BRIDGE_COMMAND_FAILED');
      expect(json.message).toBe('failed');
      expect(json.context).toEqual({ command: 'compute_set_cell' });
    });

    it('includes extra context alongside command', () => {
      const error = new BridgeError('BRIDGE_TRANSPORT_ERROR', 'invoke', 'timeout', {
        context: { endpoint: '/api' },
      });
      const json = error.toJSON();
      expect(json.context).toEqual({ endpoint: '/api', command: 'invoke' });
    });

    it('serializes nested BridgeError cause', () => {
      const inner = new BridgeError('BRIDGE_TRANSPORT_ERROR', 'transport', 'connection lost');
      const outer = new BridgeError('BRIDGE_COMMAND_FAILED', 'compute_set_cell', 'failed', {
        cause: inner,
      });
      const json = outer.toJSON();
      expect(json.cause).toBeDefined();
      const causeJson = json.cause as Record<string, unknown>;
      expect(causeJson.code).toBe('BRIDGE_TRANSPORT_ERROR');
      expect(causeJson.name).toBe('BridgeError');
    });
  });
});
