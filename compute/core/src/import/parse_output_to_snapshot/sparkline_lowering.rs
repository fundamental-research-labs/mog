//! Sparkline lowering — boundaries 1.8–1.9.
//!
//! **Intentionally empty after W4.c.**
//!
//! The `parse_output_to_snapshot` orchestrator does not touch sparklines:
//! `domain_types::domain::sparkline::Sparkline` already carries fully typed
//! coordinates (`SparklineCellAddress` + `SparklineDataRange`, both
//! numeric), and the runtime path is XLSX parser → `features.rs`
//! (`convert_sparkline_groups`, which parses the XML strings once into
//! typed form) → `SheetData.sparklines` → Yrs hydration
//! (`storage::infra::hydration::features::hydrate_sparklines`). No
//! compute-core snapshot surface consumes sparklines, so there is no
//! typed-to-string-to-typed hop to eliminate here.
//!
//! The two remaining upstream string fields — `ooxml_types::sparklines::
//! Sparkline { data_range: String, location: String }` — are **deferred**:
//! the `ooxml-types` crate is declared zero-dep by design (its Cargo.toml
//! comment names the invariant and `formula-types` depends on `ooxml-types`,
//! so adding the reverse edge would create a cycle). Typing those fields
//! requires either (a) moving the sparkline vocabulary types out of
//! `ooxml-types` into a crate that can depend on `formula-types`, or
//! (b) dropping the zero-dep invariant. Both are scope-structural decisions
//! outside a single W4 sub-band.
//!
//! See the W4.c report for the full deferral rationale.
