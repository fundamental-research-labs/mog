//! Subsystem 6: VectorizedFormulaEvaluator
//!
//! Detects groups of consecutive cells sharing the same formula pattern and evaluates
//! the entire group as a single vectorized operation over dense columns. Replaces 1M
//! individual demand_eval calls with one pass over contiguous f64 arrays.
//!
//! Knows about: `ASTNode`, `DenseColumn`, `CellValue`, `CellId`, `SheetId`,
//! arithmetic operations. Does NOT know about the executor, CAS states, threading,
//! dirty tracking, or the dependency graph.

mod exec;
mod groups;
mod pattern;
mod types;

#[cfg(test)]
mod tests;

// Re-export all public items for consumers
