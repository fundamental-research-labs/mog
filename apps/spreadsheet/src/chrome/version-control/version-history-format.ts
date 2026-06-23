export { displayBranchName } from './version-branch-name';

export function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}
