import { expect } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  HOST_POLICY_SECRET,
  providerProbeContext,
  REVIEW_ENDPOINTS,
} from './version-merge-capability-test-utils';

export function registerMergeCapabilityReviewEndpointScenarios(): void {
  it.each(REVIEW_ENDPOINTS)(
    'blocks $method under merge kill switch before provider lookup or payload writes',
    async ({ method, capability, input }) => {
      const { ctx, providerLookup, providerTouch } = providerProbeContext({
        versionControlMergeKillSwitch: true,
      });
      const version = new WorkbookVersionImpl(ctx as any);

      const result = await (version as any)[method](input);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability,
          dependency: 'featureGate',
          reason: 'Version-control merge endpoints are disabled by the runtime kill switch.',
          retryable: false,
        },
      });
      expect(providerLookup).not.toHaveBeenCalled();
      expect(providerTouch).not.toHaveBeenCalled();
    },
  );

  it.each(REVIEW_ENDPOINTS)(
    'blocks $method when host policy denies its merge capability before provider lookup or payload writes',
    async ({ method, capability, input }) => {
      const { ctx, providerLookup, providerTouch } = providerProbeContext();
      const version = new WorkbookVersionImpl({
        ...ctx,
        policySnapshot: { decisions: [{ capability, decision: 'denied' }] },
      } as any);

      const result = await (version as any)[method](input);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability,
          dependency: 'hostCapability',
          reason: 'Host policy denies version-control merge capability for this workbook.',
          retryable: false,
        },
      });
      expect(providerLookup).not.toHaveBeenCalled();
      expect(providerTouch).not.toHaveBeenCalled();
    },
  );

  it.each(REVIEW_ENDPOINTS)(
    'blocks $method when host policy omits capability but names its operation alias',
    async ({ method, capability, input }) => {
      const { ctx, providerLookup, providerTouch } = providerProbeContext();
      const version = new WorkbookVersionImpl({
        ...ctx,
        policySnapshot: {
          decisions: [{ operation: method, decision: 'denied', reviewer: HOST_POLICY_SECRET }],
        },
      } as any);

      const result = await (version as any)[method](input);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability,
          dependency: 'hostCapability',
          reason: 'Host policy denies version-control merge capability for this workbook.',
          retryable: false,
        },
      });
      expect(JSON.stringify(result)).not.toContain(HOST_POLICY_SECRET);
      expect(providerLookup).not.toHaveBeenCalled();
      expect(providerTouch).not.toHaveBeenCalled();
    },
  );
}
