export type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: unknown): void;
};

let sessionCounter = 0;

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createRuntimeId(prefix: string): string {
  sessionCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${sessionCounter.toString(36)}`;
}

export function noopDisposable() {
  const dispose = () => {};
  return Object.assign(dispose, {
    dispose,
    [Symbol.dispose]: dispose,
  });
}
