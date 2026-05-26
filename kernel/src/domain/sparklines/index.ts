/**
 * Sparklines Domain Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 * This module provides sparkline management via the SparklineStore class.
 *
 * @see compute-core/src/storage/sparklines.rs - Rust implementation
 */

// Store (ComputeBridge-backed CRUD operations)
export { SparklineStore, getSparklineStore, resetSparklineStore } from './sparkline-store';
