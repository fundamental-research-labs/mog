/**
 * Action Dependencies Hook
 *
 * Provides the ActionDependencies needed by action handlers.
 * This hook collects all the dependencies from various contexts and coordinators
 * into a single object that can be passed to dispatch().
 *
 * Usage:
 * ```tsx
 * import { dispatch } from '../../actions';
 * import { useActionDependencies } from './use-action-dependencies';
 *
 * function ToolbarButton() {
 * const deps = useActionDependencies();
 *
 * const handleBold = => {
 * dispatch('TOGGLE_BOLD', deps);
 * };
 *
 * return <button onClick={handleBold}>Bold</button>;
 * }
 * ```
 *
 */

import { useCallback, useMemo } from 'react';

import type { ActionDependencies, ActionType } from '@mog-sdk/contracts/actions';
import type { ActorAccessors, ActorCommands } from '@mog-sdk/contracts/actors';
import { objectSelectors, selectionSelectors } from '../../selectors';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { wallClockNow } from '@mog/platform';
import { usePlatform, useShellService } from '@mog/shell';

import { dispatch } from '../../actions';
import { createActorAccessLayer } from '../../coordinator/actor-access';
import { withHandlerErrors } from '../../devtools/handler-error-boundary';

import {
  useActiveSheetId,
  useFeatureGates,
  useSpreadsheetHostCommandsOptional,
  useUIStoreApi,
  useWorkbook,
} from '../../infra/context';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// Hook Return Type
// =============================================================================

/**
 * Return type for useActionDependencies.
 * Extends ActionDependencies with properly typed actors.
 *
 */
export interface UseActionDependenciesReturn extends ActionDependencies {
  /** Unified Workbook API for all data/compute operations */
  workbook: WorkbookInternal;

  /** Actor accessors for reading actor state (point-in-time reads) */
  accessors: ActorAccessors;

  /** Actor commands for writing actor state */
  commands: ActorCommands;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook that provides all dependencies needed for action dispatch.
 *
 * This hook collects dependencies from:
 * - DocumentContext: activeSheetId, Workbook
 * - CoordinatorContext: XState actors (selection, editor, clipboard, etc.)
 *
 * The returned object can be passed directly to dispatch():
 * ```tsx
 * const deps = useActionDependencies();
 * dispatch('TOGGLE_BOLD', deps);
 * ```
 *
 * For consumers that need a custom UI handler (deferred chart-format
 * dialogs only — see `ActionDependencies.onUIAction` SCOPE comment):
 * ```tsx
 * const baseDeps = useActionDependencies();
 * const deps = {
 * ...baseDeps,
 * onUIAction: (action) => { ... },
 * };
 * dispatch('OPEN_FORMAT_CHART_AREA', deps);
 * ```
 *
 * PERFORMANCE: This hook uses lazy getters for `accessors` and `commands`.
 * These are only evaluated when accessed (at action execution time), not at
 * render time. This prevents cascading re-renders when XState actors change.
 */
export function useActionDependencies(): UseActionDependenciesReturn {
  const activeSheetId = useActiveSheetId();

  // Get UIStore API for action handlers that need to access UI state
  const uiStore = useUIStoreApi();

  // Get coordinator for actor access (stable reference)
  const coordinator = useCoordinator();

  // platform + shellService are required deps. Both
  // contexts are populated by the shell bootstrap; throw via the hooks if
  // either is missing (a misconfigured embed would silently no-op handlers
  // otherwise.
  const platform = usePlatform();
  const shellService = useShellService();
  const hostCommands = useSpreadsheetHostCommandsOptional();
  const featureGates = useFeatureGates();

  // Memoize getActiveSheetId callback
  const getActiveSheetId = useCallback(() => activeSheetId, [activeSheetId]);

  // Consume unified Workbook from WorkbookContext (provided by CoordinatorProvider).
  // No need to create a separate instance — one workbook per document, shared via context.
  const workbook = useWorkbook();

  // Memoize getSelection callback - reads fresh actor state when called
  const getSelection = useCallback(() => {
    const snapshot = coordinator.grid.access.actors.selection.getSnapshot();
    return {
      activeCell: selectionSelectors.activeCell(snapshot),
      ranges: selectionSelectors.ranges(snapshot),
      anchor: selectionSelectors.anchor(snapshot),
      direction: selectionSelectors.direction(snapshot),
    };
  }, [coordinator]);

  // Memoize getSelectedSheetIds callback (Multi-Sheet Selection)
  const getSelectedSheetIds = useCallback(async () => {
    if (!workbook) return [activeSheetId];
    const settings = await workbook.getSettings();
    const selected = settings.selectedSheetIds;
    if (!selected || selected.length === 0) {
      return [activeSheetId];
    }
    if (!selected.includes(activeSheetId)) {
      return [activeSheetId, ...selected];
    }
    return selected;
  }, [workbook, activeSheetId]);

  // Memoize hasObjectSelection callback - reads fresh actor state when called
  const hasObjectSelection = useCallback(() => {
    const snapshot = coordinator.objects.access.actors.object.getSnapshot();
    return objectSelectors.hasSelection(snapshot);
  }, [coordinator]);

  // Memoize isEditingObjectText callback - reads fresh actor state when called
  const isEditingObjectText = useCallback(() => {
    const snapshot = coordinator.objects.access.actors.object.getSnapshot();
    return objectSelectors.isEditingText(snapshot);
  }, [coordinator]);

  // Return memoized dependencies object with LAZY GETTERS for accessors/commands.
  // The getters are only evaluated when accessed (at click time), not at render time.
  // This prevents 134+ toolbar re-renders during cell editing.
  return useMemo(
    () => ({
      workbook,
      coordinator,
      getActiveSheetId,
      getSelectedSheetIds,
      hasObjectSelection,
      isEditingObjectText,
      getSelection,
      uiStore,
      platform,
      wallClockNow,
      shellService,
      hostCommands,
      featureGates,

      // LAZY GETTER: Actor Access Layer accessors (type-safe reads)
      // Only creates accessors when property is accessed (at action execution time)
      get accessors() {
        return createActorAccessLayer({
          selectionActor: coordinator.grid.access.actors.selection,
          editorActor: coordinator.grid.access.actors.editor,
          clipboardActor: coordinator.grid.access.actors.clipboard,
          chartActor: coordinator.objects.access.actors.chart,
          objectActor: coordinator.objects.access.actors.object,
          commentActor: coordinator.grid.access.actors.comment,
          findReplaceActor: coordinator.grid.access.actors.findReplace,
          paneFocusActor: coordinator.input.access.actors.paneFocus,
          drawBorderActor: coordinator.grid.access.actors.drawBorder,
          rendererActor: coordinator.renderer.access.actors.renderer,
        }).accessors;
      },

      // LAZY GETTER: Actor Access Layer commands (type-safe writes)
      // Only creates commands when property is accessed (at action execution time)
      get commands() {
        return createActorAccessLayer({
          selectionActor: coordinator.grid.access.actors.selection,
          editorActor: coordinator.grid.access.actors.editor,
          clipboardActor: coordinator.grid.access.actors.clipboard,
          chartActor: coordinator.objects.access.actors.chart,
          objectActor: coordinator.objects.access.actors.object,
          commentActor: coordinator.grid.access.actors.comment,
          findReplaceActor: coordinator.grid.access.actors.findReplace,
          paneFocusActor: coordinator.input.access.actors.paneFocus,
          drawBorderActor: coordinator.grid.access.actors.drawBorder,
          rendererActor: coordinator.renderer.access.actors.renderer,
        }).commands;
      },

      // Note: onUIAction is intentionally undefined here. Consumers that
      // dispatch the deferred chart-format handlers (see SCOPE on
      // ActionDependencies.onUIAction) override it via:
      // const deps = { ...useActionDependencies(), onUIAction: myHandler };
    }),
    [
      workbook,
      coordinator,
      getActiveSheetId,
      getSelectedSheetIds,
      hasObjectSelection,
      isEditingObjectText,
      getSelection,
      uiStore,
      platform,
      shellService,
      hostCommands,
      featureGates,
    ],
  );
}

// =============================================================================
// Convenience Hook for Dispatch
// =============================================================================

/**
 * Hook that returns a dispatch function with dependencies pre-bound.
 *
 * This is a convenience wrapper around useActionDependencies + dispatch.
 * Useful when you want the simplest possible interface.
 *
 * @param options - Optional UI and workbook action handlers
 *
 * @example
 * ```tsx
 * function ToolbarButton() {
 * const dispatch = useDispatch;
 * return <button onClick={ => dispatch('TOGGLE_BOLD')}>Bold</button>;
 * }
 *
 * // With a custom UI handler (deferred chart-format dialogs only):
 * function ToolbarWithDialogs() {
 * const dispatch = useDispatch({
 * onUIAction: (action) => {
 * if (action.startsWith('OPEN_FORMAT_CHART_AREA')) {
 * setDialogOpen(true);
 * }
 * }
 * });
 * return <button onClick={ => dispatch('OPEN_FORMAT_CHART_AREA')}>Format</button>;
 * }
 * ```
 */
export function useDispatch(options?: {
  onUIAction?: (action: string) => void;
}): (action: string, payload?: unknown) => void {
  const baseDeps = useActionDependencies();

  return useCallback(
    (action: string, payload?: unknown) => {
      // Let the dispatcher handle validation - HANDLER_MAP is the source of truth
      // for valid actions. Removing the redundant isValidActionType check prevents
      // "shotgun surgery" bugs where new actions are registered in HANDLER_MAP but
      const deps = {
        ...baseDeps,
        onUIAction: options?.onUIAction,
      } as ActionDependencies;

      // / O-A: when dispatch returns a Promise, route the
      // fire-and-forget chain through `withHandlerErrors` so any rejection
      // surfaces in `__dt.recentErrors` tagged `handler:<ACTION_NAME>`. The
      // dispatcher's own internal try/catch logs and returns
      // `{ handled: false, error }` for rejection paths — but a Promise that
      // rejects after that conversion was previously silent here.
      const result = dispatch(action as ActionType, deps, payload);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        // Fire-and-forget: tag a handler-source error if this throws.
        void withHandlerErrors(action, () => result as Promise<unknown>);
      }
    },
    [baseDeps, options?.onUIAction],
  );
}
