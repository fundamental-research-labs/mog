//! Integration test: generate TypeScript format constants from Rust source of truth.
//!
//! Reads all format presets, categories, currency symbols, etc. from
//! compute-formats and emits a self-contained TypeScript file.
//!
//! Run: cargo test -p bridge-ts --test generate_format_constants -- generate --nocapture

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
        serde_json::Value::Array(arr) => emit_array(arr, out, indent),
        serde_json::Value::Object(map) => emit_object(map, out, indent),
    }
}

/// Emit a JSON array as a TypeScript array literal.
fn emit_array(arr: &[serde_json::Value], out: &mut String, indent: usize) {
    if arr.is_empty() {
        out.push_str("[]");
        return;
    }
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

/// Emit a JSON object as a TypeScript object literal.
fn emit_object(map: &serde_json::Map<String, serde_json::Value>, out: &mut String, indent: usize) {
    if map.is_empty() {
        out.push_str("{}");
        return;
    }
    out.push_str("{\n");
    let child_indent = indent + 2;
    let mut entries: Vec<_> = map.iter().collect();
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    for (i, (key, val)) in entries.iter().enumerate() {
        for _ in 0..child_indent {
            out.push(' ');
        }
        // Quote keys that need it (numeric keys for EXCEL_BUILTIN_FORMATS)
        if key.parse::<u32>().is_ok() {
            write!(out, "{}", key).unwrap();
        } else {
            out.push_str(key);
        }
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

fn output_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let out_path =
        PathBuf::from(manifest_dir).join("../../../contracts/src/number-formats/constants.gen.ts");
    out_path.canonicalize().unwrap_or(out_path)
}

fn generate_output() -> String {
    use compute_formats::{FormatType, get_format_data};

    let data = get_format_data();
    let mut out = String::new();

    // Header
    out.push_str("// Auto-generated from Rust compute-formats constants.\n");
    out.push_str("// Do not edit manually. Regenerate with:\n");
    out.push_str(
        "//   cargo test -p bridge-ts --test generate_format_constants -- generate --nocapture\n",
    );
    out.push_str("//\n");
    out.push_str("// Source: compute-core/crates/compute-formats/src/constants.rs\n\n");

    // --- NumberFormatType ---
    out.push_str("export type NumberFormatType =\n");
    for (i, ft) in FormatType::ALL.iter().enumerate() {
        write!(out, "  | '{}'", ft.as_str()).unwrap();
        if i < FormatType::ALL.len() - 1 {
            out.push('\n');
        } else {
            out.push_str(";\n");
        }
    }
    out.push('\n');

    // --- FormatPreset interface ---
    out.push_str("export interface FormatPreset {\n");
    out.push_str("  code: string;\n");
    out.push_str("  example: string;\n");
    out.push_str("  description?: string;\n");
    out.push_str("}\n\n");

    // --- FormatCategory interface ---
    out.push_str("export interface FormatCategory {\n");
    out.push_str("  type: NumberFormatType;\n");
    out.push_str("  label: string;\n");
    out.push_str("  description?: string;\n");
    out.push_str("}\n\n");

    // --- FORMAT_CATEGORIES ---
    // Emit manually to use `type` instead of serde's `formatType`
    out.push_str("export const FORMAT_CATEGORIES: FormatCategory[] = [\n");
    for (i, cat) in data.format_categories.iter().enumerate() {
        write!(
            out,
            "  {{ type: '{}', label: '{}', description: '{}'",
            cat.format_type.as_str(),
            cat.label,
            cat.description,
        )
        .unwrap();
        out.push_str(" }");
        if i < data.format_categories.len() - 1 {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("];\n\n");

    // --- Per-category preset consts ---
    let category_const_names: &[(&str, &str)] = &[
        ("general", "GENERAL_FORMATS"),
        ("number", "NUMBER_FORMATS"),
        ("currency", "CURRENCY_FORMATS"),
        ("accounting", "ACCOUNTING_FORMATS"),
        ("date", "DATE_FORMATS"),
        ("time", "TIME_FORMATS"),
        ("percentage", "PERCENTAGE_FORMATS"),
        ("fraction", "FRACTION_FORMATS"),
        ("scientific", "SCIENTIFIC_FORMATS"),
        ("text", "TEXT_FORMATS"),
        ("special", "SPECIAL_FORMATS"),
    ];

    for (type_key, const_name) in category_const_names {
        let presets = data.format_presets.get(type_key).unwrap();
        write!(
            out,
            "export const {}: Record<string, FormatPreset> = ",
            const_name
        )
        .unwrap();

        if presets.is_empty() {
            out.push_str("{};\n\n");
            continue;
        }

        out.push_str("{\n");
        for (i, (key, preset)) in presets.iter().enumerate() {
            let json: serde_json::Value = serde_json::to_value(preset).unwrap();
            write!(out, "  {}: ", key).unwrap();
            emit_value(&json, &mut out, 2);
            if i < presets.len() - 1 {
                out.push(',');
            }
            out.push('\n');
        }
        out.push_str("};\n\n");
    }

    // --- FORMAT_PRESETS aggregate ---
    out.push_str(
        "export const FORMAT_PRESETS: Record<NumberFormatType, Record<string, FormatPreset>> = {\n",
    );
    for (type_key, const_name) in category_const_names {
        write!(out, "  {}: {},\n", type_key, const_name).unwrap();
    }
    out.push_str("  custom: {}\n");
    out.push_str("};\n\n");

    // --- DEFAULT_FORMAT_BY_TYPE ---
    out.push_str("export const DEFAULT_FORMAT_BY_TYPE: Record<NumberFormatType, string> = {\n");
    for (key, fmt) in &data.default_formats {
        out.push_str("  ");
        out.push_str(key);
        out.push_str(": '");
        for ch in fmt.chars() {
            match ch {
                '\'' => out.push_str("\\'"),
                '\\' => out.push_str("\\\\"),
                _ => out.push(ch),
            }
        }
        out.push_str("',\n");
    }
    out.push_str("};\n\n");

    // --- CURRENCY_SYMBOLS ---
    let currency_json: serde_json::Value = serde_json::to_value(&data.currency_symbols).unwrap();
    out.push_str("export const CURRENCY_SYMBOLS = ");
    emit_value(&currency_json, &mut out, 0);
    out.push_str(";\n\n");

    // --- NEGATIVE_FORMATS ---
    let neg_json: serde_json::Value = serde_json::to_value(&data.negative_formats).unwrap();
    out.push_str("export const NEGATIVE_FORMATS = ");
    emit_value(&neg_json, &mut out, 0);
    out.push_str(";\n\n");

    // --- EXCEL_BUILTIN_FORMATS ---
    out.push_str("export const EXCEL_BUILTIN_FORMATS: Record<number, string> = {\n");
    for (id, code) in data.excel_builtin_formats {
        write!(out, "  {}: '", id).unwrap();
        for ch in code.chars() {
            match ch {
                '\'' => out.push_str("\\'"),
                '\\' => out.push_str("\\\\"),
                _ => out.push(ch),
            }
        }
        out.push_str("',\n");
    }
    out.push_str("};\n");

    out
}

#[test]
fn generate() {
    // Keep normal `cargo test` verification read-only. This test is the
    // explicit regeneration entry point when invoked with the `generate`
    // test filter shown in the file header.
    if !std::env::args().any(|arg| arg == "generate") {
        return;
    }

    let output = generate_output();
    let out_path = output_path();
    fs::write(&out_path, &output).unwrap();

    println!("Generated: {}", out_path.display());
}

#[test]
fn verify_up_to_date() {
    let expected = generate_output();
    let gen_path = output_path();
    let actual = fs::read_to_string(&gen_path).unwrap_or_else(|e| {
        panic!(
            "constants.gen.ts not found at {}. Run: cargo test -p bridge-ts --test generate_format_constants -- generate --nocapture\nError: {}",
            gen_path.display(),
            e
        )
    });

    assert_eq!(
        actual, expected,
        "constants.gen.ts is out of date! Regenerate with:\n  cargo test -p bridge-ts --test generate_format_constants -- generate --nocapture"
    );
}
