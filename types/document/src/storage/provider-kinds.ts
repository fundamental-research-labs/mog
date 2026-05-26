export type StorageProviderRole = 'authority' | 'cache' | 'replica' | 'snapshot' | 'exportSink';

export type StorageProviderKind =
  | 'memory'
  | 'indexeddb'
  | 'filesystem'
  | 'tauriSidecar'
  | 'remoteApi'
  | 'objectStore'
  | 'databaseLog'
  | 'hostCallback'
  | 'readOnlySnapshot'
  | 'redactedPublishedSnapshot'
  | 'test';
