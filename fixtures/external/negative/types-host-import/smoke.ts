// @mog-sdk/types-host is workspace-private and must not resolve externally.
// It defines internal host/storage contracts that public packages consume
// but never re-export.

// Root import must fail
import type { HostAdapter } from '@mog-sdk/types-host';

// Subpath imports must fail
import type { TrustedHost } from '@mog-sdk/types-host/trusted';
import type { KernelHost } from '@mog-sdk/types-host/kernel';
import type { StorageProvider } from '@mog-sdk/types-host/storage';
