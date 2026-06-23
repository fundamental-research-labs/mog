import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function versionWithMutableDomainDetectorBridge(
  computeBridge: Record<string, unknown>,
  commit: ReturnType<typeof jest.fn>,
): WorkbookVersionImpl {
  return new WorkbookVersionImpl({
    versioning: {
      writeService: { commit },
      domainSupportManifest: freshManifest(),
      domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
    },
    computeBridge,
  } as any);
}
