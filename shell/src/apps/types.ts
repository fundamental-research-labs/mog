/**
 * App Types for Shell
 *
 * These types define the contract between Shell and Apps.
 *
 */

import type { AppManifest, ResolvedBindings } from '@mog-sdk/contracts/apps';
import type { IGatedAppKernelAPI } from '@mog-sdk/contracts/capabilities';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';

export type AppAppearanceMode = 'light' | 'dark' | 'system';

/**
 * Props passed to every app component.
 *
 * Apps receive the kernel API as props, not from context.
 * This allows apps to be tested in isolation with mocks.
 *
 * @example
 * ```typescript
 * // apps/crm/index.tsx
 * import type { AppProps } from '@mog/shell/apps';
 *
 * export default function CRMApp({ kernel, manifest }: AppProps) {
 *   const deals = useRecords(kernel, 'Deals');
 *   return <KanbanBoard records={deals} groupBy="Stage" />;
 * }
 * ```
 */
export interface AppProps {
  /**
   * The capability-gated App Kernel API for data operations.
   * Apps use this to read/write records, tables, columns.
   *
   * This is a capability-gated API that restricts access based on capabilities
   * granted to the app and auto-scopes to managedTables. Sub-APIs (tables,
   * records, etc.) are only present if the corresponding capability was granted.
   *
   * NOTE: Some apps (like SpreadsheetApp) manage their own documents and
   * create their own kernels internally. These apps may receive a kernel
   * but will ignore it.
   */
  kernel: IGatedAppKernelAPI;

  /**
   * The app's manifest (metadata).
   * Useful for displaying app name, version, etc.
   */
  manifest: AppManifest;

  /**
   * Map of managed table names to their IDs.
   * Only populated if the app declared managedTables in manifest.
   * Created by launchApp() before the app component is rendered.
   *
   * @deprecated Use bindings instead. This will be removed in a future version.
   */
  managedTableIds?: Map<string, string>;

  /**
   * Resolved data bindings for this app instance.
   * Contains the mapping from logical table/column names to actual table/column IDs.
   * Only populated if the app has completed setup flow and has valid bindings.
   *
   */
  bindings?: ResolvedBindings;

  /**
   * Unique identifier for this app instance.
   * Allows apps to have multiple instances with different data bindings
   * (e.g., "Sales CRM" and "Recruiting CRM" both using the CRM app).
   */
  instanceId?: string;

  /**
   * When true, blocks all human UI editing while allowing agent mutations
   * via OSExecutionContext / direct kernel calls.
   * @deprecated Use featureGates.editing instead
   */
  readOnly?: boolean;

  /**
   * When true, hides the ribbon/toolbar. Independent of readOnly.
   * @deprecated Use featureGates.ribbon instead
   */
  hideRibbon?: boolean;

  /**
   * Unified feature visibility config. Subsumes readOnly and hideRibbon.
   * Every key defaults to true (shown) when omitted.
   * @see FeatureGates
   */
  featureGates?: FeatureGates;

  /**
   * Host-owned app chrome appearance mode. Apps with their own chrome should
   * treat this as the source of truth and report user changes through
   * onAppearanceModeChange.
   */
  appearanceMode?: AppAppearanceMode;

  /** Called when the app UI changes the host-owned appearance mode. */
  onAppearanceModeChange?: (mode: AppAppearanceMode) => void;
}

/**
 * App component type.
 * The default export from an app's index.tsx must match this type.
 */
export type AppComponent = React.ComponentType<AppProps>;

/**
 * App loader function type.
 * Returns a module with a default export of AppComponent.
 */
export type AppLoader = () => Promise<{ default: AppComponent }>;

/**
 * App registry entry.
 */
export interface AppRegistryEntry {
  /** App manifest */
  manifest: AppManifest;
  /** Lazy loader for the app component */
  loader: AppLoader;
}

/**
 * The complete app registry.
 */
export interface AppRegistry {
  /** All registered app IDs */
  ids: string[];
  /** App manifests keyed by ID */
  manifests: Record<string, AppManifest>;
  /** App loaders keyed by ID */
  loaders: Record<string, AppLoader>;
}
