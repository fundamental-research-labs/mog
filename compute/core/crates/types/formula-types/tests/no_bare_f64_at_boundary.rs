//! Build-time gate: no bare `f64` in `#[derive(Serialize/Deserialize)]` types.
//! Why this exists: `serde_json` serialises non-finite `f64` (`NaN`, `±∞`) as
//! JSON `null` and refuses to decode `null` back into `f64`. Any boundary type
//! that exposes a bare `f64` field can therefore (a) silently emit `null` over
//! IPC where TS expects `number`, or (b) fail to round-trip Rust↔Rust. The
//! structural fix is to forbid bare `f64` at the boundary entirely; use
//! `value_types::FiniteF64` (always-finite invariant) or `Option<FiniteF64>`
//! (when non-finite is a real "no value" state worth surfacing).
//!
//! ## Enforcement
//!
//! This test is the lock: the type crates must stay at zero bare-`f64`
//! boundary fields. This test now hard-asserts on any
//! reintroduction. The next person who adds a `pub something: f64` to a
//! `Serialize`/`Deserialize`-deriving type in this crate gets a red test, not a
//! silent JSON `null` in production.
//!
//! The escape hatch is `#[finite_at_boundary::allowed_bare_f64]` on the field
//! at the type definition; only `FiniteF64::val` and `F64x2`'s inner fields use
//! it today. Any new use must carry a justification comment.

use finite_at_boundary_walker::{walk_crate_src, walk_source_string};

#[test]
fn no_bare_f64_in_serde_types() {
    let violations = walk_crate_src(env!("CARGO_MANIFEST_DIR"));

    assert!(
        violations.is_empty(),
        "Bare `f64` in #[derive(Serialize/Deserialize)] type — use FiniteF64 or Option<FiniteF64>:\n{}",
        violations
            .iter()
            .map(|v| format!("  {v}"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
}

// ---------------------------------------------------------------------------
// Walker self-tests — verify the walker actually catches a positive case and
// correctly skips an `#[allowed_bare_f64]`-annotated negative case. These run
// against in-memory source strings, so they don't depend on real code paths
// in the host crate and exercise the contract directly.
// ---------------------------------------------------------------------------

#[test]
fn walker_catches_bare_f64_in_struct() {
    let src = r#"
        use serde::Serialize;
        #[derive(Serialize)]
        pub struct Sample {
            pub temp: f64,
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    assert_eq!(v.len(), 1, "expected 1 violation, got {v:#?}");
    assert_eq!(v[0].field, "temp");
}

#[test]
fn walker_catches_bare_f64_in_enum_variant() {
    // Regression coverage: `MoveTarget::Absolute { x_offset, .. }`
    // and `MoveTarget::Delta(f64, f64)`-style enum variants must be flagged.
    let src = r#"
        use serde::{Serialize, Deserialize};
        #[derive(Serialize, Deserialize)]
        pub enum MoveTarget {
            Absolute { x_offset: f64, y_offset: f64 },
            Delta(f64, f64),
            Symbolic(String),
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    // 4 fields contain bare f64: x_offset, y_offset, Delta.0, Delta.1
    assert_eq!(v.len(), 4, "expected 4 violations, got {v:#?}");
    assert!(v.iter().all(|x| x.variant.is_some()));
}

#[test]
fn walker_descends_into_nested_generics() {
    // The walker must catch `f64` inside `Option<HashMap<String, f64>>`
    // and similar nested-generic forms.
    let src = r#"
        use std::collections::HashMap;
        use serde::Serialize;
        #[derive(Serialize)]
        pub struct Nested {
            pub adjustments: Option<HashMap<String, f64>>,
            pub points: Vec<(f64, f64)>,
            pub matrix: [[f64; 4]; 4],
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    assert_eq!(v.len(), 3, "expected 3 violations, got {v:#?}");
}

#[test]
fn walker_skips_allowed_bare_f64_field() {
    let src = r#"
        use serde::Serialize;
        #[derive(Serialize)]
        pub struct Wrapper {
            #[allowed_bare_f64]
            val: f64,
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    assert!(v.is_empty(), "expected zero violations, got {v:#?}");
}

#[test]
fn walker_skips_qualified_allowed_bare_f64_field() {
    // The walker should also recognise the fully-qualified attribute path
    // `#[finite_at_boundary::allowed_bare_f64]` even though stable Rust
    // currently can't apply it to a field directly. This guards against a
    // future where stable Rust permits qualified non-derive attributes on
    // fields and someone writes them out long-hand.
    let src = r#"
        use serde::Serialize;
        #[derive(Serialize)]
        pub struct Wrapper {
            #[finite_at_boundary::allowed_bare_f64]
            val: f64,
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    assert!(v.is_empty(), "expected zero violations, got {v:#?}");
}

#[test]
fn walker_ignores_non_serde_types() {
    // Structs that don't derive Serialize/Deserialize aren't boundary types
    // and shouldn't be flagged.
    let src = r#"
        pub struct InternalOnly {
            pub temp: f64,
        }
        #[derive(Debug, Clone)]
        pub struct AlsoInternal {
            pub temp: f64,
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    assert!(v.is_empty(), "expected zero violations, got {v:#?}");
}

#[test]
fn walker_catches_bare_f64_in_deserialize_only_struct() {
    // `Deserialize` alone is also a boundary — the `null` rejection lives on
    // the read side, but the broader "no bare f64 at the boundary" rule
    // applies to both directions.
    let src = r#"
        use serde::Deserialize;
        #[derive(Deserialize)]
        pub struct ReadOnly {
            pub threshold: f64,
        }
    "#;
    let v = walk_source_string("self_test.rs", src);
    assert_eq!(v.len(), 1, "expected 1 violation, got {v:#?}");
}
