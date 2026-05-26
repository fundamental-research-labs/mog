//! Coverage check for the bridge method-kind manifest.
//!
//! Asserts that every method declared on `GeneratedBridgeMethods` in
//! `compute-bridge.gen.ts` has exactly one entry in `BRIDGE_METHOD_KIND` from
//! `manifest.gen.ts`, and vice versa. The invariant is enforced at generation
//! time — both files are written from the same parsed `TsApi` in the same
//! pass, so any drift here means a generator bug.
//!
//! Run: cargo test -p bridge-ts --test manifest_coverage

use std::collections::BTreeSet;

fn read_or_fail(path: &str) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{path} not found ({e}).\nRegenerate via: pnpm generate:bridge"))
}

/// Extract method names from `compute-bridge.gen.ts` by scanning the
/// `export interface GeneratedBridgeMethods { ... }` block. A method line
/// looks like:
///     methodName(arg: T, ...): Promise<R>;
fn parse_bridge_method_names(src: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();

    // Find the interface block.
    let start_marker = "export interface GeneratedBridgeMethods {";
    let start = src
        .find(start_marker)
        .expect("compute-bridge.gen.ts: missing `export interface GeneratedBridgeMethods` block");
    let after = &src[start + start_marker.len()..];
    // The block ends at the first `}` at column zero — but to be robust just
    // stop at the first `}\n` followed by a blank line (the emitter writes
    // `}\n\n` after the interface).
    let end = after.find("\n}\n").expect(
        "compute-bridge.gen.ts: cannot find closing brace of GeneratedBridgeMethods interface",
    );
    let body = &after[..end];

    for line in body.lines() {
        let line = line.trim();
        // Skip blanks and stray closers.
        if line.is_empty() || line.starts_with('}') {
            continue;
        }
        // A method line has a `(` separating name from params and ends with `;`.
        if let Some(paren) = line.find('(') {
            // Skip TS reserved tokens; the name token is the literal up to the
            // first `(`. Make sure it's a plain identifier (no spaces).
            let name = line[..paren].trim();
            if name.is_empty() || name.contains(' ') || name.contains('/') {
                continue;
            }
            names.insert(name.to_string());
        }
    }

    names
}

/// Extract keys from `manifest.gen.ts` by scanning the
/// `BRIDGE_METHOD_KIND = Object.freeze({ ... })` block. Each entry looks like:
///     methodName: 'read',
fn parse_manifest_keys(src: &str) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();

    let marker = "BRIDGE_METHOD_KIND";
    assert!(
        src.contains(marker),
        "manifest.gen.ts: missing BRIDGE_METHOD_KIND export"
    );

    for line in src.lines() {
        let line = line.trim();
        // Match lines like `methodName: 'read',`
        if let Some(colon) = line.find(':') {
            let name = line[..colon].trim();
            // Plain identifier: alnum + `_`, must start with a letter and not
            // be a comment / type / etc.
            if name.is_empty()
                || !name.chars().next().unwrap().is_ascii_alphabetic()
                || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                continue;
            }
            // Confirm RHS is one of the kind literals.
            let rest = line[colon + 1..].trim();
            if rest.starts_with("'read'")
                || rest.starts_with("'write'")
                || rest.starts_with("'lifecycle'")
            {
                keys.insert(name.to_string());
            }
        }
    }

    keys
}

fn bridge_path() -> String {
    format!(
        "{}/../../../kernel/src/bridges/compute/compute-bridge.gen.ts",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn manifest_path() -> String {
    format!(
        "{}/../../../kernel/src/bridges/compute/manifest.gen.ts",
        env!("CARGO_MANIFEST_DIR")
    )
}

#[test]
fn manifest_covers_every_bridge_method() {
    let bridge_src = read_or_fail(&bridge_path());
    let manifest_src = read_or_fail(&manifest_path());

    let bridge_methods = parse_bridge_method_names(&bridge_src);
    let manifest_keys = parse_manifest_keys(&manifest_src);

    assert!(
        !bridge_methods.is_empty(),
        "Failed to parse any methods from compute-bridge.gen.ts — parser bug?"
    );
    assert!(
        !manifest_keys.is_empty(),
        "Failed to parse any keys from manifest.gen.ts — parser bug?"
    );

    let missing_in_manifest: Vec<&String> = bridge_methods.difference(&manifest_keys).collect();
    let stale_in_manifest: Vec<&String> = manifest_keys.difference(&bridge_methods).collect();

    assert!(
        missing_in_manifest.is_empty(),
        "manifest.gen.ts is missing {} bridge methods (regenerate via `pnpm generate:bridge`):\n  {}",
        missing_in_manifest.len(),
        missing_in_manifest
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n  ")
    );

    assert!(
        stale_in_manifest.is_empty(),
        "manifest.gen.ts has {} stale entries not on the bridge (regenerate via `pnpm generate:bridge`):\n  {}",
        stale_in_manifest.len(),
        stale_in_manifest
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n  ")
    );

    eprintln!(
        "manifest_coverage: {} bridge methods, {} manifest keys — set-equal",
        bridge_methods.len(),
        manifest_keys.len()
    );
}

#[test]
fn manifest_kinds_are_well_formed() {
    // Every value RHS is one of the three allowed literals; redundant given
    // `parse_manifest_keys` filters to those, but the assertion is cheap and
    // surfaces accidental stray entries.
    let manifest_src = read_or_fail(&manifest_path());
    let mut read = 0;
    let mut write = 0;
    let mut lifecycle = 0;
    for line in manifest_src.lines() {
        let line = line.trim();
        if line.contains(": 'read',") {
            read += 1;
        } else if line.contains(": 'write',") {
            write += 1;
        } else if line.contains(": 'lifecycle',") {
            lifecycle += 1;
        }
    }
    assert!(
        read + write + lifecycle > 0,
        "manifest.gen.ts has zero kind entries"
    );
    assert!(
        lifecycle >= 1,
        "manifest.gen.ts: expected at least one 'lifecycle' entry (registerViewport / unregisterViewport), saw {lifecycle}"
    );
    eprintln!(
        "manifest_kinds: read={} write={} lifecycle={}",
        read, write, lifecycle
    );
}
