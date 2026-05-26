//! Uses XLSX-hydration path, not from_snapshot, because iterative-recalc
//! bugs don't reproduce on synthetic workbooks. The 16s idempotent regression
//! lives on the hydration path.
//!
//! Gated by `#[cfg(feature = "corpus-tests")]` so the default test run stays
//! synthetic and fast. Run explicitly with:
//!   cargo test -p compute-core --features corpus-tests \
//!     --test recalc_idempotent_corpus -- --nocapture

#![cfg(feature = "corpus-tests")]

use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::RecalcOptions;
use std::path::PathBuf;

/// The corpus fixture that surfaced the 16s idempotent-recalc regression
/// in `drawing-import-roundtrip`.
fn corpus_xlsx_path() -> PathBuf {
    let corpus_dir = std::env::var_os("MOG_XLSX_CORPUS_DIR")
        .expect("set MOG_XLSX_CORPUS_DIR to the XLSX corpus directory");
    PathBuf::from(corpus_dir).join("0C4IrPq6aZzIQtKQfiFqUXMqvUiIOjna/latest.xlsx")
}

#[test]
fn idempotent_recalc_on_drawing_import_roundtrip_corpus() {
    let corpus_xlsx = corpus_xlsx_path();
    let bytes = std::fs::read(&corpus_xlsx).unwrap_or_else(|e| {
        panic!(
            "failed to read corpus fixture at {}: {}",
            corpus_xlsx.display(),
            e,
        )
    });

    // Load via the XLSX hydration path — this is what
    // `createHeadlessEngine({ xlsxSource: buf })` uses in the TS repro and
    // what surfaces the iterative-recalc behavior that synthetic workbooks
    // miss.
    let (mut engine, _init_recalc) =
        YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes should succeed");

    let opts = RecalcOptions::default();

    // First `calculate()` is allowed to do full work:
    // `from_xlsx_bytes` uses `init_from_snapshot_no_recalc`, so the dirty
    // bit is still true and this call is expected to evaluate all formulas.
    let _r1 = engine.recalculate_with_options(&opts).unwrap();

    // Second `calculate()` is the invariant under test. With the dirty-bit
    // short-circuit, no cells must be re-evaluated.
    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r2.metrics.cells_evaluated, 0,
        "idempotent recalc on corpus XLSX must evaluate zero cells; got {}",
        r2.metrics.cells_evaluated,
    );
    assert!(
        r2.changed_cells.is_empty(),
        "idempotent recalc must report no cell changes — got {} changed",
        r2.changed_cells.len(),
    );
}
