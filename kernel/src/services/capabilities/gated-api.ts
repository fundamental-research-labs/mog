/**
 * Capability-gated API runtime helpers.
 *
 * App-facing gated API contracts are owned by @mog-sdk/contracts/capabilities.
 * Kernel implements those contracts here and provides runtime type guards, but
 * must not redeclare parallel interfaces that can drift from the public surface.
 *
 */

import type { IAppColumnsAPI, IAppRecordsAPI, IAppTablesAPI } from '@mog-sdk/contracts/apps/api';
import type {
  IGatedAppKernelAPI,
  ICapabilityIntrospection,
  IGatedCellsAPI,
  IGatedCheckpointsAPI,
  IGatedConnectionsAPI,
  IGatedDialogsAPI,
  IGatedFilesystemAPI,
  IGatedFormattingAPI,
  IGatedFormulasAPI,
  IGatedNetworkAPI,
  IGatedSheetsAPI,
  IGatedShellAPI,
} from '@mog-sdk/contracts/capabilities';

export type {
  ICapabilityIntrospection,
  IGatedAppKernelAPI,
  IGatedCellsAPI,
  IGatedCheckpointsAPI,
  IGatedConnectionsAPI,
  IGatedDialogsAPI,
  IGatedFilesystemAPI,
  IGatedFormattingAPI,
  IGatedFormulasAPI,
  IGatedNetworkAPI,
  IGatedSheetsAPI,
  IGatedShellAPI,
} from '@mog-sdk/contracts/capabilities';

export type GatedJsonPrimitive = string | number | boolean | null;
export type GatedJsonValue =
  | GatedJsonPrimitive
  | readonly GatedJsonValue[]
  | { readonly [key: string]: GatedJsonValue };

/**
 * Type guard to check if the API has table read capability.
 */
export function hasTableReadAccess(api: IGatedAppKernelAPI): api is IGatedAppKernelAPI & {
  tables: {
    list: IAppTablesAPI['list'];
    get: IAppTablesAPI['get'];
    findByName: IAppTablesAPI['findByName'];
  };
} {
  return api.capabilities.has('tables:read');
}

/**
 * Type guard to check if the API has full table access.
 */
export function hasTableFullAccess(api: IGatedAppKernelAPI): api is IGatedAppKernelAPI & {
  tables: IAppTablesAPI;
  columns: IAppColumnsAPI;
  records: IAppRecordsAPI;
} {
  return (
    api.capabilities.has('tables:read') &&
    api.capabilities.has('tables:write') &&
    api.capabilities.has('tables:create') &&
    api.capabilities.has('tables:delete') &&
    api.capabilities.has('columns:schema')
  );
}

/**
 * Type guard to check if the API has filesystem access.
 */
export function hasFilesystemAccess(api: IGatedAppKernelAPI): boolean {
  return api.capabilities.has('filesystem:read');
}

/**
 * Type guard to check if the API can make network requests.
 */
export function hasNetworkAccess(api: IGatedAppKernelAPI): boolean {
  return (
    api.capabilities.has('network:sameorigin') ||
    api.capabilities.has('network:allowlist') ||
    api.capabilities.has('network:localhost') ||
    api.capabilities.has('network:any')
  );
}
