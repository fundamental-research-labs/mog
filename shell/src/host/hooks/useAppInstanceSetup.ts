/**
 * useAppInstanceSetup - Hook for managing app instance setup state machine
 *
 * Extracts the setup logic from AppLoader and operates on the FULL kernel API
 * (not gated). This hook manages the entire setup flow for apps with managedTables:
 * - Checking for existing instances
 * - Resolving bindings
 * - Creating new instances (fresh start)
 * - Binding to existing tables (custom binding)
 *
 */

import type {
  AppInstance,
  AppManifest,
  IAppKernelAPI,
  ResolvedBindings,
  TableBinding,
} from '@mog-sdk/contracts/apps';
import { useCallback, useEffect, useState } from 'react';
import { createManagedTables, resolveBindings } from '../app-setup';

// =============================================================================
// Types
// =============================================================================

export type SetupState =
  | { status: 'checking' }
  | { status: 'needs-setup' }
  | { status: 'setup-dialog' }
  | { status: 'binding-editor' }
  | {
      status: 'ready';
      instance: AppInstance;
      bindings: ResolvedBindings;
      managedTableIds: Set<string>;
    }
  | {
      status: 'ready';
      instance: null;
      bindings: null;
      managedTableIds: Set<string>;
    }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

export interface UseAppInstanceSetupOptions {
  appId: string;
  manifest: AppManifest | null;
  kernel: IAppKernelAPI | null; // Full kernel, not gated (null until document is created)
  enabled: boolean; // Only run if app has managedTables
  createFreshDocument?: () => Promise<void>; // Called before creating tables on "Start Fresh"
}

export interface UseAppInstanceSetupResult {
  state: SetupState;
  startFresh: () => void;
  useExisting: () => void;
  completeBinding: (bindings: Record<string, TableBinding>) => void;
  cancel: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Manages app instance setup state machine.
 *
 * When enabled=false: Immediately returns 'ready' state with empty bindings (skips all setup).
 * When enabled=true: Runs the full setup flow checking for existing instances and managing
 * the setup dialog lifecycle.
 */
export function useAppInstanceSetup(
  options: UseAppInstanceSetupOptions,
): UseAppInstanceSetupResult {
  const { appId, manifest, kernel, enabled, createFreshDocument } = options;

  const [state, setState] = useState<SetupState>({ status: 'checking' });

  // Track if we're waiting for a fresh document to be created so we can create tables
  const [pendingFreshSetup, setPendingFreshSetup] = useState(false);

  // ==========================================================================
  // Actions - Defined before the effect so they can be used in dependencies
  // ==========================================================================

  /**
   * Create tables in the current kernel (extracted logic for reuse)
   */
  const createTablesInFreshDocument = useCallback(async () => {
    if (!manifest || !kernel?.bindings) {
      console.error('[useAppInstanceSetup] Cannot create tables: missing manifest or kernel');
      setState({
        status: 'error',
        error: 'Cannot create tables: missing manifest or kernel',
      });
      return;
    }

    try {
      // Create managed tables on new sheet
      const newBindings = await createManagedTables(
        kernel,
        appId,
        manifest.name,
        manifest.managedTables ?? [],
      );

      // Create app instance
      const instance = kernel.bindings.createInstance(appId, manifest.name);

      // Update bindings and mark complete
      kernel.bindings.updateBindings(instance.instanceId, newBindings);
      kernel.bindings.completeSetup(instance.instanceId);

      // Resolve bindings for runtime
      const updatedInstance: AppInstance = {
        ...instance,
        bindings: newBindings,
        setupComplete: true,
      };
      const resolved = await resolveBindings(kernel, updatedInstance);

      if (resolved) {
        // Extract managedTableIds from resolved bindings
        const managedTableIds = new Set<string>();
        for (const [_logicalName, binding] of Object.entries(resolved.tables)) {
          managedTableIds.add(binding.tableId);
        }

        setState({
          status: 'ready',
          instance: updatedInstance,
          bindings: resolved,
          managedTableIds,
        });
      } else {
        console.error('[useAppInstanceSetup] Failed to resolve bindings after fresh setup');
        setState({ status: 'error', error: 'Failed to resolve bindings after setup' });
      }
    } catch (err) {
      console.error('[useAppInstanceSetup] Error creating tables:', err);
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error creating tables',
      });
    }
  }, [appId, kernel, manifest]);

  // ==========================================================================
  // Effect: Initial checking logic
  // ==========================================================================

  useEffect(() => {
    // Skip setup if disabled
    if (!enabled) {
      setState({
        status: 'ready',
        instance: null,
        bindings: null,
        managedTableIds: new Set(),
      });
      return;
    }

    // Wait for manifest
    if (!manifest) {
      return;
    }

    // If we're pending fresh setup and kernel is now available, create tables
    if (pendingFreshSetup && kernel?.bindings) {
      setPendingFreshSetup(false);
      createTablesInFreshDocument();
      return;
    }

    // Wait for kernel
    if (!kernel) {
      return;
    }

    // Check if bindings API exists
    if (!kernel.bindings) {
      console.error('[useAppInstanceSetup] No bindings API available');
      setState({ status: 'error', error: 'Bindings API not available' });
      return;
    }

    // Get existing instances
    const instances = kernel.bindings.getInstances(appId);

    if (instances.length > 0) {
      const instance = instances[0]; // Use first instance for now

      if (instance.setupComplete) {
        // Try to resolve bindings (async)
        void (async () => {
          const resolved = await resolveBindings(kernel, instance);

          if (resolved) {
            // Extract managedTableIds from resolved bindings
            const managedTableIds = new Set<string>();
            Object.values(resolved.tables).forEach((binding) => {
              managedTableIds.add(binding.tableId);
            });

            setState({
              status: 'ready',
              instance,
              bindings: resolved,
              managedTableIds,
            });
            return;
          }

          console.warn('[useAppInstanceSetup] Failed to resolve bindings, needs setup');
          // Fall through to setup dialog
          setState({ status: 'setup-dialog' });
        })();
        return;
      }
    }

    // Need setup
    setState({ status: 'setup-dialog' });
  }, [appId, manifest, kernel, enabled, pendingFreshSetup, createTablesInFreshDocument]);

  // ==========================================================================
  // More Actions
  // ==========================================================================

  /**
   * Handle "Start fresh" - create new managed tables and instance.
   * If createFreshDocument callback is provided, creates a fresh document first.
   */
  const startFresh = useCallback(async () => {
    if (!manifest) {
      console.error('[useAppInstanceSetup] Cannot start fresh: missing manifest');
      return;
    }

    try {
      // If createFreshDocument callback is provided, call it first to create a fresh document
      if (createFreshDocument) {
        setPendingFreshSetup(true);
        await createFreshDocument();
        // The effect will detect the new kernel and call createTablesInFreshDocument
        return;
      }

      // No createFreshDocument callback - create tables immediately in current kernel
      createTablesInFreshDocument();
    } catch (err) {
      console.error('[useAppInstanceSetup] Error during fresh setup:', err);
      setPendingFreshSetup(false);
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error during setup',
      });
    }
  }, [manifest, createFreshDocument, createTablesInFreshDocument]);

  /**
   * Handle "Use existing" - transition to binding editor.
   */
  const useExisting = useCallback(() => {
    setState({ status: 'binding-editor' });
  }, []);

  /**
   * Handle binding editor completion - create instance with custom bindings.
   */
  const completeBinding = useCallback(
    async (bindings: Record<string, TableBinding>) => {
      if (!manifest || !kernel?.bindings) {
        console.error(
          '[useAppInstanceSetup] Cannot complete binding: missing manifest or bindings API',
        );
        return;
      }

      try {
        // Create app instance
        const instance = kernel.bindings.createInstance(appId, manifest.name);

        // Update bindings and mark complete
        kernel.bindings.updateBindings(instance.instanceId, bindings);
        kernel.bindings.completeSetup(instance.instanceId);

        // Resolve bindings for runtime
        const updatedInstance: AppInstance = {
          ...instance,
          bindings,
          setupComplete: true,
        };
        const resolved = await resolveBindings(kernel, updatedInstance);

        if (resolved) {
          // Extract managedTableIds from resolved bindings
          const managedTableIds = new Set<string>();
          Object.values(resolved.tables).forEach((binding) => {
            managedTableIds.add(binding.tableId);
          });

          setState({
            status: 'ready',
            instance: updatedInstance,
            bindings: resolved,
            managedTableIds,
          });
        } else {
          console.error('[useAppInstanceSetup] Failed to resolve bindings after editor');
          setState({ status: 'error', error: 'Failed to resolve bindings' });
        }
      } catch (err) {
        console.error('[useAppInstanceSetup] Error completing binding:', err);
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error completing binding',
        });
      }
    },
    [appId, kernel, manifest],
  );

  /**
   * Handle cancel - go to cancelled state.
   */
  const cancel = useCallback(() => {
    setState({ status: 'cancelled' });
  }, []);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    state,
    startFresh,
    useExisting,
    completeBinding,
    cancel,
  };
}
