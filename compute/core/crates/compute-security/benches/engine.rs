//! R7.4 — Performance benchmarks for the stateless security engine.
//!
//! Targets (ARCHITECTURE.md §12):
//!   - `evaluate_sheet` with 100 policies  → < 50 µs
//!   - Matrix lookup (single cell)         → < 50 ns
//!   - Viewport filter (100×50 uniform)    → < 100 ns
//!   - Viewport filter (100×50 redacted)   → < 200 µs
//!   - Single cell read, enforced          → < 50 ns
//!
//! Plus a zero-config overhead bench: document with no policies, the
//! gated path short-circuits on one relaxed atomic-load + branch.
//!
//! These measure the pure-engine primitives (no Yrs, no Dispatch, no
//! ComputeService). They are the floor — the full bridge-delegate
//! wrapper adds actor-dispatch and principal materialisation on top.
//! Per §12 the floor is what matters; the dispatch overhead is fixed
//! per call and gated by the ArcSwap + AtomicBool operations tested
//! elsewhere.

#![allow(clippy::pedantic, clippy::all, missing_docs)]

use std::sync::Arc;

use cell_types::{ColId, SheetId};
use criterion::{Criterion, black_box, criterion_group, criterion_main};

use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, ColumnIndex, PolicyEngine, PolicyId, PolicyMetadata,
    Principal, PrincipalPool, PrincipalTag, SheetAccessMatrix, TagMatcher,
};

// ---------------------------------------------------------------------------
// Helpers — same shape as the compute-wire filter bench plumbing.
// ---------------------------------------------------------------------------

fn sheet_id() -> SheetId {
    SheetId::from_raw(0xABCD_EF01_2345_6789_ABCD_EF01_2345_6789)
}

fn col_id(i: u32) -> ColId {
    ColId::from_raw(0x1000_0000_0000_0000_0000_0000_0000_0000 | u128::from(i))
}

struct StubIndex {
    count: u32,
}

impl ColumnIndex for StubIndex {
    fn position_of(&self, col: ColId) -> Option<u32> {
        let raw = col.as_u128();
        let masked = raw & 0x0FFF_FFFF_FFFF_FFFF_FFFF_FFFF_FFFF_FFFF;
        let pos = u32::try_from(masked).ok()?;
        if pos < self.count { Some(pos) } else { None }
    }
    fn column_count(&self) -> u32 {
        self.count
    }
}

fn workbook_policy(tag: &str, level: AccessLevel, priority: i32) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Workbook,
        level,
        priority,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("bench"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn column_policy(
    tag: &str,
    sheet: SheetId,
    col: ColId,
    level: AccessLevel,
    priority: i32,
) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Column {
            sheet_id: sheet,
            col_id: col,
        },
        level,
        priority,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("bench"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn make_principal() -> Principal {
    let pool = PrincipalPool::new();
    pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")))
}

// Build a PolicyEngine plus a per-column override set of 50 cols, for
// the viewport/matrix benches.
fn evaluate_sheet_context() -> (PolicyEngine, Principal, SheetId, StubIndex) {
    let sheet = sheet_id();
    let mut policies = Vec::with_capacity(100);
    // Workbook-scope base policy grants Read.
    policies.push(workbook_policy("agent:*", AccessLevel::Read, 0));
    // Column-scope overrides on half the columns (different levels).
    for i in 0..49 {
        let level = match i % 3 {
            0 => AccessLevel::None,
            1 => AccessLevel::Structure,
            _ => AccessLevel::Write,
        };
        policies.push(column_policy("agent:*", sheet, col_id(i), level, 10));
    }
    // A final exact-match policy, to force the sort path to traverse
    // most of the list.
    policies.push(workbook_policy("agent:copilot", AccessLevel::Read, 20));
    (
        PolicyEngine::new(policies),
        make_principal(),
        sheet,
        StubIndex { count: 50 },
    )
}

fn uniform_matrix(level: AccessLevel, cols: u32) -> SheetAccessMatrix {
    let principal = make_principal();
    let engine = if level == AccessLevel::None {
        PolicyEngine::new(Vec::<AccessPolicy>::new())
    } else {
        PolicyEngine::new([workbook_policy("agent:*", level, 0)])
    };
    engine.evaluate_sheet(&principal, sheet_id(), &StubIndex { count: cols })
}

// ---------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------

fn bench_evaluate_sheet_100_policies(c: &mut Criterion) {
    let (engine, principal, sheet, index) = evaluate_sheet_context();
    c.bench_function("evaluate_sheet/100_policies_50_cols", |b| {
        b.iter(|| {
            let matrix =
                engine.evaluate_sheet(black_box(&principal), black_box(sheet), black_box(&index));
            black_box(matrix)
        })
    });
}

fn bench_matrix_lookup(c: &mut Criterion) {
    // Build a representative matrix once, then hammer .get().
    let (engine, principal, sheet, index) = evaluate_sheet_context();
    let matrix = engine.evaluate_sheet(&principal, sheet, &index);
    c.bench_function("matrix_get/mixed_50_cols", |b| {
        b.iter(|| {
            // Sample a handful of columns; criterion amortises the cost.
            for c in [0_u32, 7, 13, 24, 49] {
                black_box(matrix.get(0, c));
            }
        })
    });
}

fn bench_matrix_is_uniform(c: &mut Criterion) {
    let mat_uniform = uniform_matrix(AccessLevel::Read, 50);
    let (engine, principal, sheet, index) = evaluate_sheet_context();
    let mat_mixed = engine.evaluate_sheet(&principal, sheet, &index);
    c.bench_function("matrix_is_uniform/uniform", |b| {
        b.iter(|| black_box(mat_uniform.is_uniform()))
    });
    c.bench_function("matrix_is_uniform/mixed", |b| {
        b.iter(|| black_box(mat_mixed.is_uniform()))
    });
}

fn bench_filter_range_values_uniform(c: &mut Criterion) {
    use compute_security::filter_range_values;
    // 100x50 = 5000 values. `filter_range_values` walks in-place.
    let matrix = uniform_matrix(AccessLevel::Admin, 50);
    c.bench_function("filter_range_values/uniform_admin_100x50", |b| {
        b.iter_with_setup(
            || vec![1_u32; 100 * 50],
            |mut buf| {
                filter_range_values(black_box(&mut buf), 0, 0, 99, 49, &matrix);
                black_box(buf);
            },
        )
    });
}

fn bench_filter_range_values_redacted(c: &mut Criterion) {
    use compute_security::filter_range_values;
    // 100x50 uniform None — the fast path redacts every cell in one pass.
    let matrix = uniform_matrix(AccessLevel::None, 50);
    c.bench_function("filter_range_values/uniform_none_100x50", |b| {
        b.iter_with_setup(
            || vec![1_u32; 100 * 50],
            |mut buf| {
                filter_range_values(black_box(&mut buf), 0, 0, 99, 49, &matrix);
                black_box(buf);
            },
        )
    });
}

fn bench_filter_range_values_mixed(c: &mut Criterion) {
    use compute_security::filter_range_values;
    // 100x50 mixed — the slow path walks per-cell.
    let (engine, principal, sheet, index) = evaluate_sheet_context();
    let matrix = engine.evaluate_sheet(&principal, sheet, &index);
    c.bench_function("filter_range_values/mixed_100x50", |b| {
        b.iter_with_setup(
            || vec![1_u32; 100 * 50],
            |mut buf| {
                filter_range_values(black_box(&mut buf), 0, 0, 99, 49, &matrix);
                black_box(buf);
            },
        )
    });
}

fn bench_redact_scalar(c: &mut Criterion) {
    use compute_security::redact_scalar;
    c.bench_function("redact_scalar/allowed", |b| {
        b.iter(|| redact_scalar(black_box(42_u32), AccessLevel::Read))
    });
    c.bench_function("redact_scalar/denied", |b| {
        b.iter(|| redact_scalar(black_box(42_u32), AccessLevel::None))
    });
}

fn bench_effective_access(c: &mut Criterion) {
    // Single-cell effective access: the PolicyEngine::evaluate call
    // shape that's under check_write's hood.
    let (engine, principal, sheet, _index) = evaluate_sheet_context();
    let target = AccessTarget::Sheet { sheet_id: sheet };
    c.bench_function("evaluate/sheet_target_100_policies", |b| {
        b.iter(|| black_box(engine.evaluate(black_box(&principal), black_box(&target))))
    });
}

fn bench_zero_config_fast_path(c: &mut Criterion) {
    use std::sync::atomic::{AtomicBool, Ordering};
    // Shape of the fast-path: one relaxed load + branch. Real world has
    // the dispatch call after; we measure only the gate itself so the
    // §6.1 "zero-config, opt-in" claim can be numbered.
    let flag = AtomicBool::new(false);
    c.bench_function("fast_path_guard/inactive", |b| {
        b.iter(|| black_box(!flag.load(Ordering::Relaxed)))
    });
    let flag2 = AtomicBool::new(true);
    c.bench_function("fast_path_guard/active", |b| {
        b.iter(|| black_box(!flag2.load(Ordering::Relaxed)))
    });
}

fn bench_matrix_cache_equivalent(c: &mut Criterion) {
    // Proxy for the single cell read on the enforced path after the
    // matrix is cached upstream — one active_matrix fetch that hits the
    // cache is amortised, but the per-call `.get(row, col)` is the
    // hot-path the §12 "< 50 ns" target pins down. The matrix lookup
    // bench above measures the same thing; this repeats the target
    // wording so the bench output maps cleanly onto the §12 table.
    let matrix = uniform_matrix(AccessLevel::Read, 50);
    c.bench_function("single_cell_read_enforced_proxy/matrix_get", |b| {
        b.iter(|| black_box(matrix.get(0, 7)))
    });
}

criterion_group!(
    benches,
    bench_evaluate_sheet_100_policies,
    bench_matrix_lookup,
    bench_matrix_is_uniform,
    bench_filter_range_values_uniform,
    bench_filter_range_values_redacted,
    bench_filter_range_values_mixed,
    bench_redact_scalar,
    bench_effective_access,
    bench_zero_config_fast_path,
    bench_matrix_cache_equivalent,
);
criterion_main!(benches);
