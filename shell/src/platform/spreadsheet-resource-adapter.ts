/**
 * Spreadsheet Resource Adapter — bridges existing workbook open/new/switch
 * flows into the product-neutral resource provider system.
 *
 * Registers resource kind `mog.resource.workbook` for spreadsheet files
 * (.xlsx, .xls, .csv, .mog) and a route pattern for workbook document URLs.
 *
 */

import type { IResourceProviderRegistry } from './resource-provider-registry';

/** The resource kind for workbook documents. */
export const WORKBOOK_RESOURCE_KIND = 'mog.resource.workbook';

/** The package that owns the workbook resource provider. */
export const WORKBOOK_OWNER_PACKAGE = 'mog.resource';

/** File extensions handled by the workbook resource provider. */
export const WORKBOOK_FILE_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.mog'] as const;

/**
 * Register the spreadsheet/workbook resource provider with the registry.
 *
 * This bridges the existing shell document-lifecycle services (DocumentManager,
 * ProjectService) into the product-neutral resource binding system. Current
 * registers the provider so that routing and binding resolution can discover
 * workbook resources; actual load/save still flows through the existing
 * document manager.
 */
export function registerSpreadsheetResourceProvider(registry: IResourceProviderRegistry): void {
  registry.registerProvider({
    resourceKind: WORKBOOK_RESOURCE_KIND,
    ownerPackageId: WORKBOOK_OWNER_PACKAGE,
    routePattern: '/workbook/:id',
    supportedAccessModes: ['read', 'write', 'readwrite'],
  });
}
