import { withVersionManifest } from './version-domain-support-test-utils';

export function createCtx(versioning: Record<string, unknown>) {
  return { versioning: withVersionManifest(versioning) } as any;
}
