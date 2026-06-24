import { REF_NAME_STORAGE_PREFIX } from '../refs/ref-name';

export function storageRefNameFromGraphRefName(name: string): string {
  return name.startsWith(REF_NAME_STORAGE_PREFIX)
    ? name.slice(REF_NAME_STORAGE_PREFIX.length)
    : name;
}
