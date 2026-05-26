export * from './auto-scroll-service';
export * from './focus-coordination';
export * from './initial-focus-coordination';
export * from './input-coordination';
export * from './pointer-capture-coordination';

// Pane navigation coordination (moved from coordinator/features/pane-navigation/)
export {
  setupPaneNavigationCoordination,
  type PaneNavigationCoordinationConfig,
  type PaneNavigationCoordinationResult,
} from './pane-navigation-coordination';
