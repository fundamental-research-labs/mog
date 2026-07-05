import { jest } from '@jest/globals';

import { DocumentLifecycleSystem } from '../document-lifecycle-system';

function createSystem(environment: 'browser' | 'headless'): DocumentLifecycleSystem {
  return new DocumentLifecycleSystem({
    environment,
    userTimezone: 'UTC',
    clock: { now: () => 0, dateNow: () => 0 },
  });
}

function stopSystem(system: DocumentLifecycleSystem): void {
  (system as unknown as { cleanup(): void }).cleanup();
}

function createStartBridgeInput() {
  return {
    computeBridge: {
      start: jest.fn(async () => {}),
      setWriteGate: jest.fn(),
      getAllSheetIds: jest.fn(async () => []),
    },
    documentContext: {
      schema: {
        start: jest.fn(),
      },
    },
  };
}

describe('DocumentLifecycleSystem schema bridge lifecycle', () => {
  it('starts the schema bridge in headless mode for metadata-backed validation APIs', async () => {
    const system = createSystem('headless');
    const input = createStartBridgeInput();

    try {
      await (
        system as unknown as {
          executeStartBridge(input: ReturnType<typeof createStartBridgeInput>): Promise<unknown>;
        }
      ).executeStartBridge(input);

      expect(input.computeBridge.start).toHaveBeenCalledTimes(1);
      expect(input.documentContext.schema.start).toHaveBeenCalledTimes(1);
    } finally {
      stopSystem(system);
    }
  });
});
