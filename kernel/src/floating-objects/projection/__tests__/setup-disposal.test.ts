import { jest } from '@jest/globals';

import { setupFloatingObjectsProjection } from '../setup';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('setupFloatingObjectsProjection disposal guards', () => {
  it('does not seed projection after dispose', async () => {
    const seed = deferred<unknown[]>();
    const projection = {
      applyBatch: jest.fn(),
      setObjectsForSheet: jest.fn(),
    };
    const workbook = {
      on: jest.fn(() => jest.fn()),
    };
    const floatingObjects = {
      getObject: jest.fn(),
      getObjectsInSheet: jest.fn(() => seed.promise),
    };

    const setup = setupFloatingObjectsProjection({
      projection: projection as any,
      workbook: workbook as any,
      floatingObjects: floatingObjects as any,
      initialSheetId: 'sheet-1',
    });

    setup.dispose();
    seed.resolve([{ id: 'obj-1' }]);
    await seed.promise;
    await Promise.resolve();

    expect(projection.setObjectsForSheet).not.toHaveBeenCalled();
    expect(projection.applyBatch).not.toHaveBeenCalled();
  });

  it('does not flush queued object fetches after dispose', async () => {
    const fetched = deferred<unknown>();
    const handlers = new Map<string, (event: any) => void>();
    const projection = {
      applyBatch: jest.fn(),
      setObjectsForSheet: jest.fn(),
    };
    const workbook = {
      on: jest.fn((event: string, handler: (event: any) => void) => {
        handlers.set(event, handler);
        return jest.fn();
      }),
    };
    const floatingObjects = {
      getObject: jest.fn(() => fetched.promise),
      getObjectsInSheet: jest.fn(() => Promise.resolve([])),
    };

    const setup = setupFloatingObjectsProjection({
      projection: projection as any,
      workbook: workbook as any,
      floatingObjects: floatingObjects as any,
    });

    handlers.get('floatingObject:created')?.({ objectId: 'obj-1' });
    await Promise.resolve();
    setup.dispose();
    fetched.resolve({ id: 'obj-1' });
    await fetched.promise;
    await Promise.resolve();

    expect(projection.applyBatch).not.toHaveBeenCalled();
  });
});
