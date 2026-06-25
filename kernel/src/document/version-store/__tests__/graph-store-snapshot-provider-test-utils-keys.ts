import type { VersionObjectRecord } from '../object-store';

export function refKey(namespaceKey: string, name: string): string {
  return `${namespaceKey}\u0000${name}`;
}

export function objectKey(namespaceKey: string, record: VersionObjectRecord<unknown>): string {
  return `${namespaceKey}\u0000${record.digest.algorithm}\u0000${record.digest.digest}`;
}
