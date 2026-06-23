export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let start!: () => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  const started = new Promise<void>((promiseResolve) => {
    start = promiseResolve;
  });
  return { promise, resolve, started, start };
}
