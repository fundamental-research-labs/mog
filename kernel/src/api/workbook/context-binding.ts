import type { DocumentContext } from '../../context';

export interface WorkbookContextBinding {
  readonly context: DocumentContext;
  readonly generation: number;
  current(): DocumentContext;
  publish(next: DocumentContext): number;
}

export function createWorkbookContextBinding(initial: DocumentContext): WorkbookContextBinding {
  let current = initial;
  let generation = 0;

  const context = new Proxy({} as DocumentContext, {
    get(_target, prop, receiver) {
      return Reflect.get(current, prop, receiver);
    },
    set(_target, prop, value) {
      return Reflect.set(current, prop, value);
    },
    has(_target, prop) {
      return Reflect.has(current, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(current);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(current, prop);
    },
    defineProperty(_target, prop, descriptor) {
      return Reflect.defineProperty(current, prop, descriptor);
    },
    deleteProperty(_target, prop) {
      return Reflect.deleteProperty(current, prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(current);
    },
  });

  return {
    context,
    get generation() {
      return generation;
    },
    current: () => current,
    publish(next) {
      if (next === current) return generation;
      current = next;
      generation += 1;
      return generation;
    },
  };
}
