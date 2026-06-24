import type {
  BoundMethod,
  MaybePromise,
  VersionLiveCollaborationState,
} from './version-live-collaboration-status-types';

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function optionalStringField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined | null {
  if (value[key] === undefined) return undefined;
  return optionalString(value[key]) ?? null;
}

export function optionalNumberField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined | null {
  if (value[key] === undefined) return undefined;
  return optionalNumber(value[key]) ?? null;
}

export function optionalBooleanField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined | null {
  if (value[key] === undefined) return undefined;
  return optionalBoolean(value[key]) ?? null;
}

export function isLiveCollaborationState(value: unknown): value is VersionLiveCollaborationState {
  return (
    value === 'absent' ||
    value === 'disabled' ||
    value === 'idle' ||
    value === 'active' ||
    value === 'unknown'
  );
}

export function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
