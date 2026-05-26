//! CI freshness test: verifies that `constants.gen.ts` is up to date with the
//! Rust source of truth.
//!
//! Run: cargo test -p compute-wire --test verify_constants_gen

#![allow(clippy::pedantic)]

use std::fs;
use std::path::PathBuf;

/// Verify that the on-disk `constants.gen.ts` matches what the codegen would produce.
///
/// Fails if someone changes Rust constants/flags but forgets to regenerate the
/// TypeScript file. The error message tells the developer exactly how to fix it.
#[test]
fn verify_up_to_date() {
    let expected = compute_wire::generate_constants_ts();

    // Locate the generated file relative to this crate's manifest directory.
    // CARGO_MANIFEST_DIR = .../compute-core/crates/compute-wire
    // Target file = .../kernel/src/bridges/wire/constants.gen.ts
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let gen_path =
        PathBuf::from(manifest_dir).join("../../../../kernel/src/bridges/wire/constants.gen.ts");

    let actual = fs::read_to_string(&gen_path).unwrap_or_else(|e| {
        panic!(
            "constants.gen.ts not found at {}.\n\
             Regenerate with:\n  \
             cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts\n\
             Error: {}",
            gen_path.display(),
            e
        )
    });

    assert_eq!(
        actual, expected,
        "constants.gen.ts is out of date!\n\
         Regenerate with:\n  \
         cd os && cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts"
    );
}
