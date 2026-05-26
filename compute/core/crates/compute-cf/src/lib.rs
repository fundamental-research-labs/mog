//! Conditional formatting visual rule engine.
//!
//! Pure computation crate: cell values + rules → visual properties.
//! No storage dependency (CellMirror, Yrs). Caller provides values.
//!
//! Three conceptual layers:
//! - **Rule predicates** (`rules/`): cell value, text, date, top-N, duplicate, etc.
//! - **Visual encoding** (`visual/`): color scale, data bar, icon set
//! - **Cascade** (`priority`): priority-based merging with stop-if-true semantics

pub mod evaluator;
pub mod presets;
pub mod priority;
pub mod stats;
pub mod types;

pub(crate) mod rules;
pub(crate) mod visual;

#[cfg(test)]
mod test_helpers;
