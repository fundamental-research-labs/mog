import { useEffect, type ReactNode } from 'react';

import type { ActionType } from '@mog-sdk/contracts/actions';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { usePlatform, useShellService } from '@mog/shell';

import { dispatch } from '../actions/dispatcher';
import { createActorAccessLayerFromBundle } from '../coordinator/actor-access';
import {
  useFeatureGates,
  useReadOnly,
  useSpreadsheetHostCommandsOptional,
  useUIStoreApi,
} from '../infra/context';
import { useCoordinator } from '../hooks/shared/use-coordinator';
import { objectSelectors } from '../selectors';
import {
  isDialogKeyboardTarget,
  isEditableKeyboardTarget,
  isGlobalShortcut,
  keyboardEventTargetElement,
  shouldDeferNavigationKeyToEditableTarget,
} from '../systems/shared/utils/focus-utils';
import { createKeyUpCapture } from './coordinator-keyup-capture';

function isNativeEditableShortcut(e: KeyboardEvent, target: HTMLElement | null): boolean {
  if (!isEditableKeyboardTarget(target)) return false;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;

  const key = e.key.toLowerCase();
  return key === 'c' || key === 'x' || key === 'v' || key === 'z' || key === 'y';
}

const SPREADSHEET_CHROME_NAVIGATION_KEYS = new Set(['Home', 'End', 'PageDown', 'PageUp']);

export function shouldRouteSpreadsheetChromeNavigationShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  target: HTMLElement | null,
): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  if (!SPREADSHEET_CHROME_NAVIGATION_KEYS.has(e.key)) return false;
  if (isDialogKeyboardTarget(target) || isEditableKeyboardTarget(target)) return false;
  return true;
}

export function shouldCommitFormulaBarEnterInPlace(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  currentLayerType: string,
): boolean {
  return (
    currentLayerType === 'formulaBar' &&
    e.key === 'Enter' &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  );
}

/**
 * Internal component that sets up document-level keyboard capture.
 * Must be rendered inside BaseCoordinatorProvider to access coordinator.
 *
 * This is the single capture-phase entry point for navigation keys during
 * editing. Printable type-to-edit remains owned by the grid React keydown
 * handler so a rapid key sequence starts exactly one edit session.
 */
export function KeyboardCaptureSetup({
  children,
  workbook,
}: {
  children: ReactNode;
  workbook: WorkbookInternal;
}) {
  const coordinator = useCoordinator();
  const uiStoreApi = useUIStoreApi();
  const readOnly = useReadOnly();
  const featureGates = useFeatureGates();
  const hostCommands = useSpreadsheetHostCommandsOptional();

  const platform = usePlatform();
  const shellService = useShellService();

  const { onUIAction } = coordinator.input;

  useEffect(() => {
    const keyboardCoordinator = coordinator.input.keyboardCoordinator;

    keyboardCoordinator.setDependencies({
      workbook,
      selectionActor: coordinator.grid.access.actors.selection,
      editorActor: coordinator.grid.access.actors.editor,
      clipboardActor: coordinator.grid.access.actors.clipboard,
      objectInteractionActor: coordinator.objects.access.actors.object,
      chartActor: coordinator.objects.access.actors.chart,
      findReplaceActor: coordinator.grid.access.actors.findReplace,
      commentActor: coordinator.grid.access.actors.comment,
      paneFocusActor: coordinator.input.access.actors.paneFocus,
      rendererActor: coordinator.renderer.access.actors.renderer,
      getActiveSheetId: () => uiStoreApi.getState().activeSheetId,
      uiStore: uiStoreApi,
      getCoordinator: () => coordinator,
      dispatch: (action, deps, payload) => dispatch(action as ActionType, deps, payload),
      readOnly,
      featureGates,
      createAccessLayer: createActorAccessLayerFromBundle,
      hasObjectSelection: () => {
        const snapshot = coordinator.objects.access.actors.object.getSnapshot();
        return objectSelectors.hasSelection(snapshot);
      },
      isEditingObjectText: () => {
        const snapshot = coordinator.objects.access.actors.object.getSnapshot();
        return objectSelectors.isEditingText(snapshot);
      },
      isFlashFillPreviewActive: () => uiStoreApi.getState().flashFillPreview.isShowingPreview,
      platform,
      shellService,
      hostCommands,
      onUIAction,
    });

    if (!keyboardCoordinator.hasDependencies()) {
      return;
    }

    const handleKeyDownCapture = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      const editorSnapshot = coordinator.grid.access.actors.editor.getSnapshot();
      const isEditing =
        editorSnapshot.matches('editing') ||
        editorSnapshot.matches('formulaEditing') ||
        editorSnapshot.matches('richTextEditing') ||
        editorSnapshot.matches('imeComposing');
      const target = keyboardEventTargetElement(e);

      if (
        isGlobalShortcut(e) &&
        !isDialogKeyboardTarget(target) &&
        !isNativeEditableShortcut(e, target)
      ) {
        const result = keyboardCoordinator.handleKeyboardEvent(e);
        if (result.handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (!isEditing) {
        const activeTag = document.activeElement?.tagName;

        if (activeTag === 'BODY' || activeTag === 'HTML') {
          if (e.key === 'Escape' && document.querySelector('[role="dialog"]')) {
            return;
          }
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        if (shouldRouteSpreadsheetChromeNavigationShortcut(e, target)) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
        return;
      }

      const focusActor = coordinator.input.access.actors.focus;
      if (!focusActor) return;
      const focusSnapshot = focusActor.getSnapshot();
      const focusStack = focusSnapshot.context.stack;
      const currentLayerType =
        focusStack.length > 0 ? focusStack[focusStack.length - 1].type : 'grid';

      if (
        currentLayerType !== 'grid' &&
        currentLayerType !== 'editor' &&
        currentLayerType !== 'formulaBar'
      ) {
        return;
      }

      if (shouldDeferNavigationKeyToEditableTarget(e, target)) {
        return;
      }

      const isNavigationKey = ['Enter', 'Tab', 'Escape'].includes(e.key);
      const isSheetSwitch =
        (e.key === 'PageDown' || e.key === 'PageUp') && (e.ctrlKey || e.metaKey);
      const isPickerDropdownShortcut =
        e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown';
      if (!isNavigationKey && !isSheetSwitch) {
        const isFormattingShortcut =
          (e.ctrlKey || e.metaKey) && !e.altKey && ['b', 'i', 'u'].includes(e.key.toLowerCase());
        const editorContext = editorSnapshot.context as {
          hasSelection?: boolean;
          hasCharSelection?: boolean;
        };
        if (
          isFormattingShortcut &&
          (editorContext.hasSelection || editorContext.hasCharSelection)
        ) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        const isPrintableFormulaInput =
          editorSnapshot.matches({ formulaEditing: 'enterMode' }) &&
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !isEditableKeyboardTarget(target) &&
          !isDialogKeyboardTarget(target);

        if (isPrintableFormulaInput) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        }

        if (isPickerDropdownShortcut) {
          const result = keyboardCoordinator.handleKeyboardEvent(e);
          if (result.handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        return;
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        return;
      }

      const { isSuggestionsOpen, isPickerOpen } = editorSnapshot.context;
      if (isSuggestionsOpen || isPickerOpen) {
        return;
      }

      if (shouldCommitFormulaBarEnterInPlace(e, currentLayerType)) {
        const result = keyboardCoordinator.dispatchAction('COMMIT_IN_PLACE');
        const handledInPlace = result instanceof Promise ? true : result?.handled === true;

        if (handledInPlace) {
          coordinator.input.access.commands.paneFocus?.resetToGrid();
          coordinator.input.resetFocusToGrid();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      const result = keyboardCoordinator.handleKeyboardEvent(e);

      if (result.handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleKeyUpCapture = createKeyUpCapture((e) => keyboardCoordinator.handleKeyUp(e));

    document.addEventListener('keydown', handleKeyDownCapture, { capture: true });
    document.addEventListener('keyup', handleKeyUpCapture, { capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDownCapture, { capture: true });
      document.removeEventListener('keyup', handleKeyUpCapture, { capture: true });
    };
  }, [
    coordinator,
    featureGates,
    hostCommands,
    onUIAction,
    platform,
    readOnly,
    shellService,
    uiStoreApi,
    workbook,
  ]);

  return <>{children}</>;
}
