import { jest } from '@jest/globals';

import { createLazyNapiTransport } from '../napi-transport';
import { TransportError } from '../errors';
import type { NapiAddonModule } from '../napi-loader';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockEngineClass() {
  const instances: MockEngine[] = [];

  class MockEngine {
    public snapshotJson: string;
    public layoutMetricsJson: string;
    static fromYrsStateCalls: Array<{
      readonly state: Buffer;
      readonly layoutMetricsJson: string;
      readonly engine: MockEngine;
    }> = [];

    constructor(snapshotJson: string, layoutMetricsJson: string) {
      this.snapshotJson = snapshotJson;
      this.layoutMetricsJson = layoutMetricsJson;
      instances.push(this);
    }

    static initFromYrsState(state: Buffer, layoutMetricsJson: string): MockEngine {
      const engine = new MockEngine('from-yrs-state', layoutMetricsJson);
      MockEngine.fromYrsStateCalls.push({ state, layoutMetricsJson, engine });
      return engine;
    }

    takeLifecycleResult(): string {
      return JSON.stringify({ sheet_ids: ['from-state'] });
    }

    compute_take_init_result(): string {
      return JSON.stringify({ sheet_ids: ['s1'] });
    }

    compute_get_cell(sheetId: string, cellId: string): string {
      return JSON.stringify({ value: 42, sheet_id: sheetId, cell_id: cellId });
    }

    compute_set_cell(_sheetId: string, _cellId: string, _value: string): string {
      return JSON.stringify({ ok: true });
    }
  }

  return { MockEngine, instances };
}

function createMockAddon(
  EngineClass?: new (snapshotJson: string, layoutMetricsJson: string) => unknown,
): NapiAddonModule {
  const { MockEngine } = createMockEngineClass();
  return {
    ComputeEngine: (EngineClass ?? MockEngine) as NapiAddonModule['ComputeEngine'],
    compute_set_current_time: jest.fn(),
  } as unknown as NapiAddonModule;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLazyNapiTransport', () => {
  describe('before compute_init', () => {
    it('should throw TransportError for any command before init', async () => {
      const addon = createMockAddon();
      const transport = createLazyNapiTransport(addon);

      await expect(
        transport.call('compute_get_cell', { docId: 'doc1', sheetId: 's1', cellId: 'A1' }),
      ).rejects.toThrow(TransportError);
    });

    it('should include the command name in the error message', async () => {
      const addon = createMockAddon();
      const transport = createLazyNapiTransport(addon);

      await expect(
        transport.call('compute_get_cell', { docId: 'doc1', sheetId: 's1', cellId: 'A1' }),
      ).rejects.toThrow('compute_init must be called before compute_get_cell');
    });
  });

  describe('compute_init', () => {
    it('should create engine with the provided snapshot', async () => {
      const { MockEngine, instances } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      const snapshot = { sheets: [{ id: 's1', name: 'Sheet1' }] };
      await transport.call('compute_init', {
        docId: 'doc1',
        snapshot: JSON.stringify(snapshot),
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].snapshotJson).toBe(JSON.stringify(snapshot));
      expect(instances[0].layoutMetricsJson).toBe(JSON.stringify(null));
    });

    it('should pass layout metrics to the engine constructor', async () => {
      const { MockEngine, instances } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      const layoutMetrics = { fontScale: 1.1, defaultDpi: 144 };
      await transport.call('compute_init', {
        docId: 'doc1',
        snapshot: {},
        layoutMetrics,
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].layoutMetricsJson).toBe(JSON.stringify(layoutMetrics));
    });

    it('should return the parsed init result with camelCase keys', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      const result = await transport.call('compute_init', {
        docId: 'doc1',
        snapshot: '{}',
      });

      // MockEngine returns { sheet_ids: ['s1'] } → deepSnakeToCamel → { sheetIds: ['s1'] }
      expect(result).toEqual({ sheetIds: ['s1'] });
    });

    it('should JSON.stringify snapshot objects (not already strings)', async () => {
      const { MockEngine, instances } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      const snapshot = { sheets: [] };
      await transport.call('compute_init', {
        docId: 'doc1',
        snapshot,
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].snapshotJson).toBe(JSON.stringify(snapshot));
    });

    it('should return undefined when engine produces no init result', async () => {
      class NoInitResultEngine {
        constructor(_snapshotJson: string, _layoutMetricsJson: string) {}
        compute_take_init_result(): null {
          return null;
        }
      }
      const addon = createMockAddon(NoInitResultEngine);
      const transport = createLazyNapiTransport(addon);

      const result = await transport.call('compute_init', {
        docId: 'doc1',
        snapshot: '{}',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('compute_init_from_yrs_state', () => {
    it('should create engine from Yrs state with layout metrics', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      const state = Buffer.from([1, 2, 3]);
      const layoutMetrics = { fontScale: 0.9 };
      const result = await transport.call('compute_init_from_yrs_state', {
        docId: 'doc1',
        state,
        layoutMetrics,
      });

      expect(MockEngine.fromYrsStateCalls).toHaveLength(1);
      expect(MockEngine.fromYrsStateCalls[0].state).toBe(state);
      expect(MockEngine.fromYrsStateCalls[0].layoutMetricsJson).toBe(JSON.stringify(layoutMetrics));
      expect(result).toEqual({ sheetIds: ['from-state'] });
    });

    it('should pass null layout metrics when omitted', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init_from_yrs_state', {
        docId: 'doc1',
        state: Buffer.from([4, 5, 6]),
      });

      expect(MockEngine.fromYrsStateCalls[0].layoutMetricsJson).toBe(JSON.stringify(null));
    });
  });

  describe('after compute_init', () => {
    it('should delegate commands to the inner napi transport', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init', { docId: 'doc1', snapshot: '{}' });

      const result = await transport.call('compute_get_cell', {
        docId: 'doc1',
        sheetId: 's1',
        cellId: 'A1',
      });

      expect(result).toEqual({
        value: 42,
        sheetId: expect.any(String),
        cellId: expect.any(String),
      });
    });

    it('should throw TransportError for unknown commands on engine', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init', { docId: 'doc1', snapshot: '{}' });

      await expect(transport.call('nonexistent_command', { docId: 'doc1' })).rejects.toThrow(
        TransportError,
      );
    });
  });

  describe('compute_destroy', () => {
    it('should return undefined', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init', { docId: 'doc1', snapshot: '{}' });
      const result = await transport.call('compute_destroy', { docId: 'doc1' });
      expect(result).toBeUndefined();
    });

    it('should cause subsequent commands to throw TransportError', async () => {
      const { MockEngine } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init', { docId: 'doc1', snapshot: '{}' });
      await transport.call('compute_destroy', { docId: 'doc1' });

      await expect(
        transport.call('compute_get_cell', { docId: 'doc1', sheetId: 's1', cellId: 'A1' }),
      ).rejects.toThrow(TransportError);
    });

    it('should work even without prior compute_init', async () => {
      const addon = createMockAddon();
      const transport = createLazyNapiTransport(addon);

      const result = await transport.call('compute_destroy', { docId: 'doc1' });
      expect(result).toBeUndefined();
    });
  });

  describe('re-initialization', () => {
    it('should create new engines on subsequent compute_init calls', async () => {
      const { MockEngine, instances } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init', {
        docId: 'doc1',
        snapshot: JSON.stringify({ v: 1 }),
      });
      expect(instances).toHaveLength(1);

      await transport.call('compute_init', {
        docId: 'doc1',
        snapshot: JSON.stringify({ v: 2 }),
      });
      expect(instances).toHaveLength(2);
      expect(instances[1].snapshotJson).toBe(JSON.stringify({ v: 2 }));
    });

    it('should work after destroy then re-init', async () => {
      const { MockEngine, instances } = createMockEngineClass();
      const addon = createMockAddon(MockEngine);
      const transport = createLazyNapiTransport(addon);

      await transport.call('compute_init', { docId: 'doc1', snapshot: '{}' });
      await transport.call('compute_destroy', { docId: 'doc1' });
      await transport.call('compute_init', { docId: 'doc1', snapshot: '{}' });

      expect(instances).toHaveLength(2);

      const result = await transport.call('compute_get_cell', {
        docId: 'doc1',
        sheetId: 's1',
        cellId: 'A1',
      });
      expect(result).toBeDefined();
    });
  });
});
