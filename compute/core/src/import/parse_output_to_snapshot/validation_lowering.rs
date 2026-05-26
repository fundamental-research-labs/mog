//! Data-validation lowering — boundaries 1.2–1.4.
//!
//! # Scope
//!
//! Typed formula boundary:a typed three fields on the parser-side
//! `xlsx_parser::domain::validation::read::DataValidation`:
//!
//! - `formula1: Option<ParsedExpr>` (boundary 1.2)
//! - `formula2: Option<ParsedExpr>` (boundary 1.3)
//! - `sqref: SqrefList`             (boundary 1.4)
//!
//! # Why this module is intentionally thin
//!
//! Data validation never reaches `WorkbookSnapshot` directly. The flow is:
//!
//! ```text
//!     XLSX bytes
//!         │
//!         ▼
//!     xlsx_parser::DataValidation                  ← typed (W4.a)
//!         │
//!         ▼ parse_data_validations() converts
//!         │ via ParsedExpr::to_a1_string / SqrefList::to_a1_string
//!         ▼
//!     DvSummary { sqref: String, formula1: Option<String>, .. }   ← wire shape
//!         │
//!         ▼
//!     domain_types::ValidationSpec                  ← consumed by hydration
//! ```
//!
//! `WorkbookSnapshot` carries no `data_validation*` fields — see
//! `compute/core/crates/types/snapshot-types/src/init.rs`. Hydration into
//! Yrs / engine state happens via `storage::infra::hydration::features::
//! hydrate_data_validations`, reading directly from
//! `domain_types::ParseOutput.sheets[].data_validations`. No
//! `WorkbookSnapshot` lowering step is needed, so this module exposes no
//! converter function — the W3.0 split allocated a per-boundary file for
//! every W4 sub-band, including those (like this one) where the lowering
//! is "no-op at the snapshot layer because the data does not pass through
//! the snapshot."
//!
//! # Why the snapshot-types layer was *not* lifted
//!
//! Per the W4.a spec: "If a snapshot-types field holds `String` for
//! validation formulas, decide: either leave the snapshot as `String`
//! (type-at-the-edge is fine if the snapshot is a lossy wire shape) OR
//! lift it." The snapshot has no validation fields at all, so the
//! decision is moot — there is nothing to lift. Validation typing lives
//! exclusively at the parser-side struct (where the grammar boundary
//! is), and the wire-side `DvSummary` retains `String` per the
//! "type-at-the-edge" rule.
