import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type { PendingRemoteSegmentRecord } from '../../../../document/version-store/pending-remote-segment-store';
import type { VersionProviderWriteActivitySnapshot } from '../../../../document/version-store/provider-write-activity';
import type { VersionGraphRegistry } from '../../../../document/version-store/registry';

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type PublicDiagnosticData = Readonly<Record<string, string | number | boolean | null>>;

export type ProviderWriteActivityProjection =
  | {
      readonly status: 'absent';
    }
  | {
      readonly status: 'ok';
      readonly activity: VersionProviderWriteActivitySnapshot;
    }
  | {
      readonly status: 'failed';
      readonly data: PublicDiagnosticData;
    };

export type RegistryProjection =
  | {
      readonly status: 'ok';
      readonly registry: VersionGraphRegistry;
    }
  | {
      readonly status: 'absent';
    }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly data: PublicDiagnosticData;
    };

export type PendingRemoteSegmentListProjection =
  | {
      readonly status: 'success';
      readonly records: readonly PendingRemoteSegmentRecord[];
    }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly data: PublicDiagnosticData;
    };

export type VersionPendingProviderWritesStatus = {
  readonly pendingProviderWrites: boolean;
  readonly statusRevision: string;
  readonly unsafeReasons: readonly VersionDiagnostic[];
  readonly diagnostics: readonly VersionDiagnostic[];
};
