//! Compile-fail tests for gated delegate codegen.
//!
//! trybuild drives a nested cargo invocation on each .rs file in tests/ui/.
//! Each file is expected to fail to compile, and its .stderr companion file
//! records the expected error. Use `TRYBUILD=overwrite cargo test -p
//! bridge-delegate --test trybuild` to regenerate stderr snapshots.

#[test]
fn gated_delegate_compile_failures() {
    let t = trybuild::TestCases::new();
    // Gated methods must declare scope; the macro emits a compile_error!.
    t.compile_fail("tests/ui/missing_scope_read.rs");
    t.compile_fail("tests/ui/missing_scope_write.rs");
    // scope = "cell" without CellAddr param is ill-formed — must also fail.
    t.compile_fail("tests/ui/cell_scope_without_celladdr.rs");
    // needs_principal without the right trailing param shape.
    t.compile_fail("tests/ui/needs_principal_wrong_sig.rs");
    // Trailing &Principal without declaring needs_principal.
    t.compile_fail("tests/ui/trailing_principal_no_flag.rs");
    // Non-fallible range-scope writes cannot enforce per-cell denial
    // on a non-uniform matrix — reject at the macro boundary.
    t.compile_fail("tests/ui/non_fallible_gated_range_write.rs");
}
