//! Integration test: generate TypeScript culture data from Rust CultureInfo.
//!
//! Reads all 10 cultures from compute-formats and emits a TypeScript file
//! with const declarations for each culture.
//!
//! Run: cargo test -p bridge-ts --test generate_culture_data -- generate --nocapture

use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

/// Emit a JSON value as a TypeScript literal, with proper indentation.
fn emit_value(val: &serde_json::Value, out: &mut String, indent: usize) {
    match val {
        serde_json::Value::Null => out.push_str("null"),
        serde_json::Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        serde_json::Value::Number(n) => {
            write!(out, "{}", n).unwrap();
        }
        serde_json::Value::String(s) => {
            // Single-quote strings, escape embedded single quotes and backslashes
            out.push('\'');
            for ch in s.chars() {
                match ch {
                    '\'' => out.push_str("\\'"),
                    '\\' => out.push_str("\\\\"),
                    _ => out.push(ch),
                }
            }
            out.push('\'');
        }
        serde_json::Value::Array(arr) => {
            emit_array(arr, out, indent);
        }
        serde_json::Value::Object(map) => {
            emit_object(map, out, indent);
        }
    }
}

/// Decide whether an array should be formatted inline.
/// Inline if all elements are strings with char length <= 5.
fn should_inline_array(arr: &[serde_json::Value]) -> bool {
    arr.iter().all(|v| {
        if let serde_json::Value::String(s) = v {
            s.chars().count() <= 5
        } else {
            false
        }
    })
}

/// Emit a JSON array as a TypeScript array literal.
fn emit_array(arr: &[serde_json::Value], out: &mut String, indent: usize) {
    if arr.is_empty() {
        out.push_str("[]");
        return;
    }

    if should_inline_array(arr) {
        out.push('[');
        for (i, v) in arr.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            emit_value(v, out, indent);
        }
        out.push(']');
    } else {
        out.push_str("[\n");
        let child_indent = indent + 2;
        for (i, v) in arr.iter().enumerate() {
            for _ in 0..child_indent {
                out.push(' ');
            }
            emit_value(v, out, child_indent);
            if i < arr.len() - 1 {
                out.push(',');
            }
            out.push('\n');
        }
        for _ in 0..indent {
            out.push(' ');
        }
        out.push(']');
    }
}

/// Emit a JSON object as a TypeScript object literal.
fn emit_object(map: &serde_json::Map<String, serde_json::Value>, out: &mut String, indent: usize) {
    out.push_str("{\n");
    let child_indent = indent + 2;
    let mut entries: Vec<_> = map.iter().collect();
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    for (i, (key, val)) in entries.iter().enumerate() {
        for _ in 0..child_indent {
            out.push(' ');
        }
        out.push_str(key);
        out.push_str(": ");
        emit_value(val, out, child_indent);
        if i < entries.len() - 1 {
            out.push(',');
        }
        out.push('\n');
    }
    for _ in 0..indent {
        out.push(' ');
    }
    out.push('}');
}

#[test]
fn generate() {
    // Keep normal `cargo test` verification read-only. This test is the
    // explicit regeneration entry point when invoked with the `generate`
    // test filter shown in the file header.
    if !std::env::args().any(|arg| arg == "generate") {
        return;
    }

    let cultures = compute_formats::get_all_cultures();
    let mut output = String::new();

    // Header
    output.push_str("// Auto-generated from Rust compute-formats CultureInfo data.\n");
    output.push_str("// Do not edit manually. Regenerate with:\n");
    output.push_str(
        "//   cargo test -p bridge-ts --test generate_culture_data -- generate --nocapture\n",
    );
    output.push_str("//\n");
    output.push_str("// Source: compute-core/crates/compute-formats/src/locale.rs\n\n");
    output.push_str("import type { CultureInfo } from '@mog-sdk/contracts/culture';\n\n");

    for ci in &cultures {
        let const_name = ci.name.to_uppercase().replace('-', "_");
        let json: serde_json::Value = serde_json::to_value(ci).unwrap();

        write!(output, "export const {}: CultureInfo = ", const_name).unwrap();
        if let serde_json::Value::Object(map) = &json {
            emit_object(map, &mut output, 0);
        }
        output.push_str(";\n\n");
    }

    // Trim trailing newline to just one
    let output = output.trim_end().to_string() + "\n";

    // Write to file
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let out_path = PathBuf::from(manifest_dir).join("../../culture/src/cultures.gen.ts");
    let out_path = out_path.canonicalize().unwrap_or(out_path);
    fs::write(&out_path, &output).unwrap();

    println!("Generated: {}", out_path.display());
    println!("Cultures: {}", cultures.len());
}

/// Verify that the generated file is up-to-date.
///
/// This test regenerates the file in memory and compares it against the
/// on-disk version. Fails if someone edits Rust culture data but forgets
/// to regenerate the TS file.
#[test]
fn verify_up_to_date() {
    let cultures = compute_formats::get_all_cultures();
    let mut expected = String::new();

    expected.push_str("// Auto-generated from Rust compute-formats CultureInfo data.\n");
    expected.push_str("// Do not edit manually. Regenerate with:\n");
    expected.push_str(
        "//   cargo test -p bridge-ts --test generate_culture_data -- generate --nocapture\n",
    );
    expected.push_str("//\n");
    expected.push_str("// Source: compute-core/crates/compute-formats/src/locale.rs\n\n");
    expected.push_str("import type { CultureInfo } from '@mog-sdk/contracts/culture';\n\n");

    for ci in &cultures {
        let const_name = ci.name.to_uppercase().replace('-', "_");
        let json: serde_json::Value = serde_json::to_value(ci).unwrap();

        write!(expected, "export const {}: CultureInfo = ", const_name).unwrap();
        if let serde_json::Value::Object(map) = &json {
            emit_object(map, &mut expected, 0);
        }
        expected.push_str(";\n\n");
    }

    let expected = expected.trim_end().to_string() + "\n";

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let gen_path = PathBuf::from(manifest_dir).join("../../culture/src/cultures.gen.ts");
    let actual = fs::read_to_string(&gen_path).unwrap_or_else(|e| {
        panic!(
            "cultures.gen.ts not found at {}. Run: cargo test -p bridge-ts --test generate_culture_data -- generate --nocapture\nError: {}",
            gen_path.display(),
            e
        )
    });

    assert_eq!(
        actual, expected,
        "cultures.gen.ts is out of date! Regenerate with:\n  cargo test -p bridge-ts --test generate_culture_data -- generate --nocapture"
    );
}
