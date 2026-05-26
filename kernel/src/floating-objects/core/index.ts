/**
 * Universal canvas object hosting operations.
 *
 * Zero spreadsheet dependencies. All operations work with CanvasObject<unknown>
 * and accept dependencies (IObjectStore, IPositionResolver, ICanvasEventBus) via parameters.
 *
 * Drawing/ink domain operations have moved to domain/drawing/.
 */

export * from './clipboard';
export * from './events';
export * from './grouping';
export * from './mutations';
export * from './positioning';
export * from './selection';
export * from './z-order';
