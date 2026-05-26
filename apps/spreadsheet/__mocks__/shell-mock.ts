// Mock for @mog/shell to avoid deep transitive dependency chain in Jest.
// Creates a focus machine with the same shape as the real one so tests
// that use focusMachine (focus-integration, mock-focus-actor) work correctly.
//
// IMPORTANT: this mock is intentionally a `.ts` ESM module. The previous
// `.js` CJS form (`module.exports = { … }`) failed under Jest's
// `useESM: true` + VM modules pipeline: cjs-module-lexer cannot
// statically detect named exports on a CJS-style assignment, so any
// `import { getFocusSnapshot } from '@mog/shell'` in a test (or in a
// source file the test loads) raised
// `SyntaxError: does not provide an export named 'getFocusSnapshot'`
// even though `moduleNameMapper` was firing correctly. ts-jest
// transforms this file with the same `useESM: true` config used for the
// rest of the codebase, producing real ESM named exports that the
// linker can bind.
import { createContext, createElement, Fragment, type ReactNode } from 'react';
import { setup, assign, type AnyActorRef } from 'xstate';

const MAX_STACK_DEPTH = 10;

const BASE_GRID_LAYER = { type: 'grid', id: 'grid', returnFocusTarget: null };

const initialContext = {
  stack: [BASE_GRID_LAYER] as Array<{
    type: string;
    id: string;
    returnFocusTarget: string | null;
  }>,
  previousGridCell: null as { row: number; col: number } | null,
};

function getReturnState(stack: typeof initialContext.stack): string {
  if (stack.length <= 1) return 'grid';
  return stack[stack.length - 2].type;
}

export const FocusEvents = {
  focusGrid: () => ({ type: 'FOCUS_GRID' }),
  focusEditor: (cellId: string, returnFocusTarget: string | null) => ({
    type: 'FOCUS_EDITOR',
    cellId,
    returnFocusTarget,
  }),
  pushLayer: (layerType: string, id: string, returnFocusTarget: string | null) => ({
    type: 'PUSH_LAYER',
    layerType,
    id,
    returnFocusTarget,
  }),
  popLayer: () => ({ type: 'POP_LAYER' }),
  resetToGrid: () => ({ type: 'RESET_TO_GRID' }),
};

export const focusMachine = setup({
  types: {} as { context: typeof initialContext; events: any },
  guards: {
    canPush: ({ context }) => context.stack.length < MAX_STACK_DEPTH,
    isCommandPalette: ({ event }) =>
      event.type === 'PUSH_LAYER' && event.layerType === 'commandPalette',
    isContextMenu: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'contextMenu',
    isSheetTabs: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'sheetTabs',
    isFormulaPicker: ({ event }) =>
      event.type === 'PUSH_LAYER' && event.layerType === 'formulaPicker',
    isFormulaBar: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'formulaBar',
    isDialog: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'dialog',
    returnsToDialog: ({ context }) => getReturnState(context.stack) === 'dialog',
    returnsToFormulaPicker: ({ context }) => getReturnState(context.stack) === 'formulaPicker',
    returnsToCommandPalette: ({ context }) => getReturnState(context.stack) === 'commandPalette',
    returnsToEditor: ({ context }) => getReturnState(context.stack) === 'editor',
    returnsToFormulaBar: ({ context }) => getReturnState(context.stack) === 'formulaBar',
  },
  actions: {
    pushLayer: assign({
      stack: ({ context, event }) => {
        if (event.type !== 'PUSH_LAYER') return context.stack;
        if (context.stack.length >= MAX_STACK_DEPTH) return context.stack;
        return [
          ...context.stack,
          { type: event.layerType, id: event.id, returnFocusTarget: event.returnFocusTarget },
        ];
      },
    }),
    pushEditorLayer: assign({
      stack: ({ context, event }) => {
        if (event.type !== 'FOCUS_EDITOR') return context.stack;
        return [
          ...context.stack,
          { type: 'editor', id: event.cellId, returnFocusTarget: event.returnFocusTarget },
        ];
      },
    }),
    popLayer: assign({
      stack: ({ context }) => {
        if (context.stack.length <= 1) return context.stack;
        return context.stack.slice(0, -1);
      },
    }),
    popToGrid: assign({
      stack: () => [BASE_GRID_LAYER],
    }),
    storePreviousCell: assign({
      previousGridCell: ({ event }) => {
        if (event.type !== 'FOCUS_EDITOR') return null;
        const parts = event.cellId.split('-');
        if (parts.length === 2) {
          const row = parseInt(parts[0], 10);
          const col = parseInt(parts[1], 10);
          if (!isNaN(row) && !isNaN(col)) return { row, col };
        }
        return null;
      },
    }),
  },
}).createMachine({
  id: 'focus',
  initial: 'grid',
  context: initialContext,
  states: {
    grid: {
      on: {
        FOCUS_EDITOR: { target: 'editor', actions: ['storePreviousCell', 'pushEditorLayer'] },
        PUSH_LAYER: [
          { target: 'formulaBar', guard: 'isFormulaBar', actions: 'pushLayer' },
          { target: 'commandPalette', guard: 'isCommandPalette', actions: 'pushLayer' },
          { target: 'contextMenu', guard: 'isContextMenu', actions: 'pushLayer' },
          { target: 'sheetTabs', guard: 'isSheetTabs', actions: 'pushLayer' },
          { target: 'dialog', guard: 'canPush', actions: 'pushLayer' },
        ],
      },
    },
    editor: {
      on: {
        FOCUS_GRID: { target: 'grid', actions: 'popToGrid' },
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
        PUSH_LAYER: [
          { target: 'formulaPicker', guard: 'isFormulaPicker', actions: 'pushLayer' },
          { target: 'dialog', guard: 'canPush', actions: 'pushLayer' },
        ],
      },
    },
    formulaBar: {
      on: {
        POP_LAYER: { target: 'grid', actions: 'popLayer' },
        FOCUS_GRID: { target: 'grid', actions: 'popToGrid' },
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
        PUSH_LAYER: [
          { target: 'formulaPicker', guard: 'isFormulaPicker', actions: 'pushLayer' },
          { target: 'dialog', guard: 'canPush', actions: 'pushLayer' },
        ],
      },
    },
    dialog: {
      on: {
        POP_LAYER: [
          { target: 'dialog', guard: 'returnsToDialog', actions: 'popLayer' },
          { target: 'formulaPicker', guard: 'returnsToFormulaPicker', actions: 'popLayer' },
          { target: 'commandPalette', guard: 'returnsToCommandPalette', actions: 'popLayer' },
          { target: 'editor', guard: 'returnsToEditor', actions: 'popLayer' },
          { target: 'formulaBar', guard: 'returnsToFormulaBar', actions: 'popLayer' },
          { target: 'grid', actions: 'popLayer' },
        ],
        PUSH_LAYER: { target: 'dialog', guard: 'canPush', actions: 'pushLayer' },
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
      },
    },
    commandPalette: {
      on: {
        POP_LAYER: [
          { target: 'editor', guard: 'returnsToEditor', actions: 'popLayer' },
          { target: 'grid', actions: 'popLayer' },
        ],
        PUSH_LAYER: { target: 'dialog', guard: 'canPush', actions: 'pushLayer' },
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
      },
    },
    contextMenu: {
      on: {
        POP_LAYER: [
          { target: 'editor', guard: 'returnsToEditor', actions: 'popLayer' },
          { target: 'grid', actions: 'popLayer' },
        ],
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
      },
    },
    formulaPicker: {
      on: {
        POP_LAYER: [
          { target: 'formulaBar', guard: 'returnsToFormulaBar', actions: 'popLayer' },
          { target: 'editor', actions: 'popLayer' },
        ],
        PUSH_LAYER: { target: 'dialog', guard: 'canPush', actions: 'pushLayer' },
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
      },
    },
    sheetTabs: {
      on: {
        POP_LAYER: { target: 'grid', actions: 'popLayer' },
        FOCUS_GRID: { target: 'grid', actions: 'popToGrid' },
        RESET_TO_GRID: { target: 'grid', actions: 'popToGrid' },
      },
    },
  },
});

export { MAX_STACK_DEPTH };

export function getCurrentLayerType(context: typeof initialContext): string {
  if (context.stack.length === 0) return 'grid';
  return context.stack[context.stack.length - 1].type;
}

export function getFocusSnapshot(snapshot: { context: typeof initialContext }) {
  const context = snapshot.context;
  const stack = context.stack;
  const currentLayer = stack.length > 0 ? stack[stack.length - 1] : BASE_GRID_LAYER;
  return {
    state: currentLayer.type,
    currentLayer,
    stack: [...stack],
    shouldGridHandle: currentLayer.type === 'grid',
    isInOverlay: currentLayer.type !== 'grid',
  };
}

// FocusActor type alias used by code under test (focus-coordination.ts).
// Use a generic xstate ActorRef — the mock machine's exact type doesn't
// need to be exposed.
export type FocusActor = AnyActorRef;

// =============================================================================
// Platform / shell-service stubs
// =============================================================================
// These keep handler tests that transitively import KeyRecorder / TabStrip /
// CoordinatorProvider / etc. from failing at module-link time. Tests that
// actually exercise platform-dependent behavior should jest.mock these
// individually.

export interface PlatformInfo {
  isDesktop: boolean;
  isWeb: boolean;
  isMacOS: boolean;
  isWindows: boolean;
  isLinux: boolean;
  platformName: 'desktop' | 'web';
}

export function usePlatformInfo(): PlatformInfo {
  return {
    isDesktop: false,
    isWeb: true,
    isMacOS: false,
    isWindows: false,
    isLinux: false,
    platformName: 'web',
  };
}

export function usePlatformIdentity() {
  return { runtime: 'web', os: 'macos' };
}

export const ShellStoreContext = createContext<unknown>(null);

type StoreListener = (
  state: Record<string, unknown>,
  previousState: Record<string, unknown>,
) => void;

export function createShellStore(initialState: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = {
    activeViewId: 'grid',
    viewSwitcherOpen: false,
    ...initialState,
  };
  const listeners = new Set<StoreListener>();

  return {
    setState(partial: unknown, replace?: boolean) {
      const previousState = state;
      const nextPartial =
        typeof partial === 'function'
          ? (partial as (current: Record<string, unknown>) => Record<string, unknown>)(state)
          : partial;

      state =
        replace || typeof nextPartial !== 'object' || nextPartial === null
          ? (nextPartial as Record<string, unknown>)
          : { ...state, ...nextPartial };

      listeners.forEach((listener) => listener(state, previousState));
    },
    getState() {
      return state;
    },
    getInitialState() {
      return state;
    },
    subscribe(listener: StoreListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
    },
  };
}

export function usePlatform(): unknown {
  return undefined;
}

export function useShellService(): unknown {
  return undefined;
}

export function useDocument(): unknown {
  return undefined;
}

export function useDocumentManagerOptional(): unknown {
  return undefined;
}

export function useDocumentManager(): unknown {
  return undefined;
}

export function useShellStore(): unknown {
  return undefined;
}

export function useShellStoreApi(): unknown {
  return undefined;
}

// Common UI component stubs — components that import these don't render in
// handler tests, but the import must resolve at module-link time.
type ChildrenProps = { children?: ReactNode; [key: string]: unknown };

const renderChildren = ({ children }: ChildrenProps) => createElement(Fragment, null, children);
const renderNull = () => null;

export const DocumentManagerProvider: any = renderChildren;
export const PlatformIdentityProvider: any = renderChildren;
export const PlatformProvider: any = renderChildren;
export const ProjectServiceProvider: any = renderChildren;
export const ShellServiceProvider: any = renderChildren;

export const Button: any = renderNull;
export const Checkbox: any = renderNull;
export const ColorInput: any = renderNull;
export const ColorSwatch: any = renderNull;
export const Dialog: any = renderNull;
export const DialogBody: any = renderNull;
export const DialogFooter: any = renderNull;
export const DialogHeader: any = renderNull;
export const DialogTable: any = renderNull;
export const DialogTableRow: any = renderNull;
export const DialogToolbar: any = renderNull;
export const DropdownMenu: any = renderChildren;
export const DropdownMenuCheckboxItem: any = renderChildren;
export const DropdownMenuContent: any = renderChildren;
export const DropdownMenuItem: any = renderChildren;
export const DropdownMenuRadioGroup: any = renderChildren;
export const DropdownMenuRadioItem: any = renderChildren;
export const DropdownMenuTrigger: any = renderChildren;
export const EmptyState: any = renderNull;
export const FormField: any = renderNull;
export const Icon: any = renderNull;
export const IconButton: any = renderNull;
export const Input: any = renderNull;
export const Label: any = renderNull;
export const Listbox: any = renderNull;
export const MenuItem: any = renderChildren;
export const MenuSeparator: any = renderNull;
export const Popover: any = renderChildren;
export const PopoverAnchor: any = renderChildren;
export const PopoverContent: any = renderChildren;
export const PopoverTrigger: any = renderChildren;
export const RadioGroup: any = renderNull;
export const SectionLabel: any = renderNull;
export const SegmentedControl: any = renderNull;
export const Select: any = renderNull;
export const Switch: any = renderNull;
export const TabPanel: any = renderNull;
export const Tabs: any = renderNull;
export const Textarea: any = renderNull;
export const Tooltip: any = renderChildren;
export const TooltipProvider: any = renderChildren;
export const cn = (...args: unknown[]): string => args.filter(Boolean).join(' ');
export function createVirtualRef(): unknown {
  return { current: null };
}
export function isLightColor(): boolean {
  return true;
}
export type Tab = { id: string; label: string };
export type DialogProps = unknown;
