//! Identity-based formula storage and reference-target contracts.
//!
//! Formulas are stored as a template with numbered placeholders and a list of
//! identity-based references. This is CRDT-safe and survives structural changes
//! (insert/delete rows/cols) without formula rewriting.
//!
//! Every reference variant implements [`ReferenceTarget`], which answers:
//!  - `resolved_sheet`: which sheet this ref points at for prefix emission.
//!  - `display_body`: how to render the body without the prefix.
//!  - `dep_edges`: what dependency edges to emit for the graph.

mod deps;
mod display;
mod external;
mod lookup;
mod targets;
mod types;

#[cfg(test)]
mod tests;

pub use deps::{DepEdge, DepEdges, FormulaDeps};
pub use lookup::{NameDef, RefStyle, ReferenceTarget, TableDefLookup, WorkbookLookup};
pub use types::{
    IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef, IdentityRowRangeRef,
};
