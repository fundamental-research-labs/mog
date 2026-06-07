/**
 * Kernel Context - Four-Tier Architecture
 *
 * OS Refactor - Kernel provides four levels of context:
 *
 * 1. IDomainContext (minimal)
 *    - For domain modules (kernel/domain/)
 *    - NO bridges - just event bus and undo labeling
 *
 * 2. IKernelContext (general-purpose)
 *    - For any app type (spreadsheet, CRM, kanban, docs)
 *    - Event bus, services, destroy() — no app-specific bridges
 *
 * 3. ISpreadsheetKernelContext (spreadsheet-specific)
 *    - Extends IKernelContext with all spreadsheet bridges
 *    - For spreadsheet Shell and app layer
 *
 * 4. DocumentContext (engine internals, defined in kernel)
 *    - Extends ISpreadsheetKernelContext with compute bridge, viewport buffers
 *
 * All generic interfaces default to SpreadsheetEvent, so existing code that
 * doesn't pass a type parameter keeps working unchanged.
 */

import type {
  IChartBridge,
  IEquationBridge,
  IInkRecognitionBridge,
  ILocaleBridge,
  IPivotBridge,
  ISchemaBridge,
  IDiagramBridge,
  ITextEffectRenderingBridge,
} from '@mog/types-bridges';
import type { MirrorReadView } from '../api/state-mirror';
import type { ChartImageExporter } from '../api/worksheet/charts';
import type { IFloatingObjectManager } from './floating-object-manager';
import type { PivotExpansionStateProvider } from '@mog/types-data/data/pivot';
import type { AccessPrincipal } from '@mog-sdk/types-document/security';
import type { IEventBus, SpreadsheetEvent } from '@mog/types-events/events';
import type { IKernelServices } from '../services';

// Slicer bridge placeholder (not yet in contracts)
export interface ISlicerBridge {} // Placeholder

// =============================================================================
// Domain Context (Minimal - for Domain Modules)
// =============================================================================

/**
 * Minimal context for domain modules (kernel/domain/).
 *
 * This interface provides ONLY event bus and undo labeling - NO bridges.
 * Domain modules should use this to ensure they don't accidentally depend
 * on computation engines.
 *
 * Generic over event type — defaults to SpreadsheetEvent for backward compat.
 * The name tells you who you are: "Am I writing domain code? Use IDomainContext."
 */
export interface IDomainContext<TEvent extends { type: string } = SpreadsheetEvent> {
  /** Event bus for emitting Kernel events */
  readonly eventBus: IEventBus<TEvent>;

  /**
   * Set pending undo description for the next undo stack item.
   * Call this BEFORE performing an operation to label the undo entry.
   */
  setPendingUndoDescription(description: string): void;

  /**
   * Get the pending undo description (consumed by undo service).
   * @internal
   */
  getPendingUndoDescription(): string | null;

  /**
   * Clear the pending undo description after it's been consumed.
   * @internal
   */
  clearPendingUndoDescription(): void;
}

// =============================================================================
// Kernel Context (General-Purpose - for any app type)
// =============================================================================

/**
 * General-purpose kernel context for any app type.
 *
 * This extends IDomainContext with:
 * - Services (clipboard, undo, notifications, queries)
 * - destroy() for cleanup
 *
 * App-specific bridges are NOT on this interface. Spreadsheet bridges
 * live on ISpreadsheetKernelContext. Future app types (CRM, kanban, docs)
 * would define their own extension interfaces.
 *
 * Generic over event type — defaults to SpreadsheetEvent for backward compat.
 */
export interface IKernelContext<
  TEvent extends { type: string } = SpreadsheetEvent,
> extends IDomainContext<TEvent> {
  // ===========================================================================
  // Session Metadata
  // ===========================================================================

  /**
   * IANA timezone name representing the user's calendar frame for this
   * session (e.g. `'America/Los_Angeles'`, `'UTC'`, `'Asia/Tokyo'`).
   *
   * Set once at workbook construction by the embedding host:
   *   - Browser app: `Intl.DateTimeFormat().resolvedOptions().timeZone`
   *   - Agent / cloud worker: passed by the orchestrator from session metadata
   *   - SDK / CLI: provided explicitly by the caller
   *
   * Used by every Date → calendar-parts conversion on the date-entry pipeline
   * (`setDateValue`, `setTimeValue`, `setCell(Date)`, `setCells({value: Date})`).
   * Never inferred from the host process — host-local is meaningless on a
   * cloud worker whose physical timezone differs from the user's.
   *
   * Required. Missing → `CONFIG_MISSING_USER_TIMEZONE` at workbook creation.
   */
  readonly userTimezone: string;

  // ===========================================================================
  // System Services
  // ===========================================================================

  /**
   * System services that survive app switches.
   * These are cross-app services available to all apps.
   *
   * NOTE: Optional during migration. Will be required once all
   * consumers are updated to provide services.
   */
  readonly services?: IKernelServices;

  // ===========================================================================
  // Security
  // ===========================================================================

  /**
   * Resolve the current principal for the document session. When present,
   * the kernel forwards the principal to the Rust compute engine via
   * `service.setActivePrincipal(...)` at session start; all policy
   * evaluation happens in Rust.
   */
  readonly resolvePrincipal?: () => AccessPrincipal;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Cleanup all bridges and resources.
   * Called by DocumentProvider on unmount.
   */
  destroy(): void;
}

// =============================================================================
// Spreadsheet Kernel Context (Spreadsheet-Specific - for Shell)
// =============================================================================

/**
 * Spreadsheet-specific kernel context for Shell and app layer.
 *
 * Extends the general-purpose IKernelContext with all spreadsheet bridges.
 * This is what DocumentFactory exposes and what the spreadsheet app uses.
 *
 * Other app types (CRM, kanban, docs) would define their own extension
 * interfaces with their own bridges, extending IKernelContext directly.
 */
export interface ISpreadsheetKernelContext extends IKernelContext<SpreadsheetEvent> {
  // ===========================================================================
  // App-injected Providers
  // ===========================================================================

  /**
   * Provider for pivot table expansion state (which groups are expanded/collapsed).
   * Owned and managed by the app layer; injected into the kernel after context creation.
   * Optional — if not set, pivot computations use default (all expanded) state.
   */
  pivotExpansionProvider?: PivotExpansionStateProvider;

  /**
   * Chart image exporter — injected by the platform host.
   * Browser hosts use their canvas exporter; `@mog-sdk/sdk/node` uses its native
   * headless raster backend. If omitted, exportImage() fails with an explicit
   * operation error.
   */
  chartImageExporter?: ChartImageExporter;

  // ===========================================================================
  // Bridges ("device drivers")
  // ===========================================================================

  /** Pivot bridge - pivot table computation and caching */
  readonly pivot: IPivotBridge;

  /** Schema bridge - data validation */
  readonly schema: ISchemaBridge;

  /** Chart bridge - chart rendering and updates */
  readonly charts: IChartBridge;

  /** Locale bridge - locale-aware input normalization */
  readonly locale: ILocaleBridge;

  /** Slicer bridge - slicer filtering (future) */
  readonly slicer?: ISlicerBridge;

  // ===========================================================================
  // Specialty Bridges
  // ===========================================================================

  /** Ink recognition bridge for converting ink strokes to shapes/text */
  readonly inkRecognition: IInkRecognitionBridge;

  /** TextEffect rendering bridge for computing and rendering TextEffect */
  readonly textEffectsRendering: ITextEffectRenderingBridge;

  /** Equation bridge for OMML and LaTeX parsing */
  readonly equationBridge: IEquationBridge;

  /** Diagram bridge for diagram management and layout computation */
  readonly diagram: IDiagramBridge;

  // ===========================================================================
  // Object Management
  // ===========================================================================

  /** Floating object manager — document-scoped singleton for object CRUD, transforms, ordering */
  readonly floatingObjectManager: IFloatingObjectManager;

  // ===========================================================================
  // Kernel state mirror
  // ===========================================================================

  /**
   * Sync read view of bounded direct workbook/sheet state — frozen panes,
   * sheet view options, page breaks, print area/titles/settings, split
   * config, scroll position, sheet metadata, workbook settings.
   *
   * Read-only by type: `MirrorReadView` exposes only getters. The writable
   * `StateMirror` instance is constructor-injected into
   * `MutationResultHandler` and never reachable through this surface. The
   * ESLint rule `no-mirror-apply-outside-handler` is the
   * second layer that catches casts and type-assertion escapes.
   *
   * Populated via the same `MutationResult` channel that drives runtime
   * updates — initial hydration, local user writes, undo/redo, snapshot
   * replay, and remote collaboration all flow through `mirror.apply` BEFORE
   * any direct-state event is emitted (Pillar 1).
   *
   * @see kernel/src/document/state-mirror.ts
   */
  readonly mirror: MirrorReadView;
}
