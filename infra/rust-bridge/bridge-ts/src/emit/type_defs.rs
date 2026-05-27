//! TypeScript type-definition emitter.

use crate::types::*;

use super::imports::render_configured_imports;
use super::refs::collect_named_types;

/// Emit a single type definition to TypeScript.
pub fn emit_type_def(def: &TsTypeDef) -> String {
    match def {
        TsTypeDef::Interface(iface) => emit_interface(iface),
        TsTypeDef::StringUnion(union) => emit_string_union(union),
        TsTypeDef::TaggedUnion(union) => emit_tagged_union(union),
        TsTypeDef::TypeAlias { name, target } => emit_type_alias(name, target),
    }
}

/// Emit a `TsInterface` as a TypeScript `export interface`.
///
/// ```typescript
/// export interface ColWidth {
///   col: number;
///   width: number;
///   customWidth?: boolean;
///   hidden?: boolean;
/// }
/// ```
pub fn emit_interface(iface: &TsInterface) -> String {
    let mut out = String::new();
    out.push_str(&format!("export interface {} {{\n", iface.name));
    for field in &iface.fields {
        if field.optional {
            out.push_str(&format!(
                "  {}?: {};\n",
                field.ts_name,
                field.ts_type.to_ts_string()
            ));
        } else {
            out.push_str(&format!(
                "  {}: {};\n",
                field.ts_name,
                field.ts_type.to_ts_string()
            ));
        }
    }
    out.push_str("}\n");
    out
}

/// Emit a `TsStringUnion` as a TypeScript string union type.
///
/// ```typescript
/// export type Axis = "row" | "col";
/// ```
pub fn emit_string_union(union: &TsStringUnion) -> String {
    let variants: Vec<String> = union
        .variants
        .iter()
        .map(|v| format!("\"{}\"", v))
        .collect();
    format!("export type {} = {};\n", union.name, variants.join(" | "))
}

/// Emit a `TsTaggedUnion` as a TypeScript discriminated union.
///
/// Output varies by `TagStyle`:
/// - **External**: `{ VariantName: DataType }`
/// - **Adjacent**: `{ tag: "Variant"; content: DataType }` (unit variants omit content)
/// - **Internal**: `{ tag: "Variant" } & DataType` (unit variants are just the tag object)
/// - **Untagged**: `DataType1 | DataType2`
pub fn emit_tagged_union(union: &TsTaggedUnion) -> String {
    match &union.tag_style {
        TagStyle::External => emit_tagged_external(union),
        TagStyle::Adjacent { tag, content } => emit_tagged_adjacent(union, tag, content),
        TagStyle::Internal { tag } => emit_tagged_internal(union, tag),
        TagStyle::Untagged => emit_tagged_untagged(union),
    }
}

/// Emit a `TypeAlias` as a TypeScript type alias.
///
/// ```typescript
/// export type SheetId = string;
/// ```
pub fn emit_type_alias(name: &str, target: &TsType) -> String {
    format!("export type {} = {};\n", name, target.to_ts_string())
}

fn emit_tagged_external(union: &TsTaggedUnion) -> String {
    let mut out = format!("export type {} =\n", union.name);
    for (i, variant) in union.variants.iter().enumerate() {
        let data_str = if variant.data_type == TsType::Void {
            format!("{{ {}: null }}", variant.variant_name)
        } else {
            format!(
                "{{ {}: {} }}",
                variant.variant_name,
                variant.data_type.to_ts_string()
            )
        };
        if i < union.variants.len() - 1 {
            out.push_str(&format!("  | {}\n", data_str));
        } else {
            out.push_str(&format!("  | {};\n", data_str));
        }
    }
    out
}

fn emit_tagged_adjacent(union: &TsTaggedUnion, tag: &str, content: &str) -> String {
    let mut out = format!("export type {} =\n", union.name);
    for (i, variant) in union.variants.iter().enumerate() {
        let data_str = if variant.data_type == TsType::Void {
            format!("{{ {}: \"{}\" }}", tag, variant.variant_name)
        } else {
            format!(
                "{{ {}: \"{}\"; {}: {} }}",
                tag,
                variant.variant_name,
                content,
                variant.data_type.to_ts_string()
            )
        };
        if i < union.variants.len() - 1 {
            out.push_str(&format!("  | {}\n", data_str));
        } else {
            out.push_str(&format!("  | {};\n", data_str));
        }
    }
    out
}

fn emit_tagged_internal(union: &TsTaggedUnion, tag: &str) -> String {
    let mut out = format!("export type {} =\n", union.name);
    for (i, variant) in union.variants.iter().enumerate() {
        let data_str = if variant.data_type == TsType::Void {
            format!("{{ {}: \"{}\" }}", tag, variant.variant_name)
        } else {
            format!(
                "{{ {}: \"{}\" }} & {}",
                tag,
                variant.variant_name,
                variant.data_type.to_ts_string()
            )
        };
        if i < union.variants.len() - 1 {
            out.push_str(&format!("  | {}\n", data_str));
        } else {
            out.push_str(&format!("  | {};\n", data_str));
        }
    }
    out
}

fn emit_tagged_untagged(union: &TsTaggedUnion) -> String {
    let types: Vec<String> = union
        .variants
        .iter()
        .map(|v| v.data_type.to_ts_string())
        .collect();
    format!("export type {} = {};\n", union.name, types.join(" | "))
}

/// Emit multiple type definitions with a preamble header.
///
/// Type definitions are sorted alphabetically by name for deterministic output.
/// Named types that appear in field/variant types but are not defined in `defs`
/// are listed as external type comments in the preamble.
///
/// When `imports` is provided, external types that have a mapping in the
/// `ImportConfig` are emitted as `import type { ... } from '...'` statements.
/// Types mapped as `unknown` (built-in TS type) are not imported.
pub fn emit_type_defs(defs: &[TsTypeDef], imports: Option<&ImportConfig>) -> String {
    use std::collections::BTreeSet;

    let mut out = String::new();
    out.push_str("// Auto-generated by bridge-ts. Do not edit.\n");

    // Collect all defined type names
    let defined: BTreeSet<String> = defs.iter().map(|d| d.name().to_string()).collect();

    // Collect all Named() references from all type defs
    let mut referenced = BTreeSet::new();
    for def in defs {
        collect_named_types(def, &mut referenced);
    }

    // External types = referenced but not defined, excluding:
    // - "unknown" (built-in TS type)
    // - inline type literals from external_type_map (contain `{`, `[`, `<`, or spaces)
    let external: BTreeSet<&String> = referenced
        .difference(&defined)
        .filter(|name| {
            let s = name.as_str();
            s != "unknown"
                && !s.contains('{')
                && !s.contains('[')
                && !s.contains('<')
                && !s.contains(' ')
        })
        .collect();

    if let Some(config) = imports {
        if !external.is_empty() {
            let external_names: BTreeSet<String> =
                external.iter().map(|name| (*name).clone()).collect();
            out.push_str(&render_configured_imports(
                config,
                &external_names,
                "type defs",
            ));
        }
    } else {
        // No import config — emit external types as a comment (legacy behavior)
        if !external.is_empty() {
            out.push_str("// External types:");
            for name in &external {
                out.push_str(&format!(" {}", name));
            }
            out.push('\n');
        }
    }

    // Sort definitions alphabetically
    let mut sorted: Vec<&TsTypeDef> = defs.iter().collect();
    sorted.sort_by_key(|d| d.name());

    for def in sorted {
        out.push('\n');
        out.push_str(&emit_type_def(def));
    }

    out
}
