//! Walker for the `no_bare_f64_at_boundary` build-time gate.
//!
//! Scans every `.rs` file under a given source root, parses with `syn`, and
//! reports every field whose type contains a leaf `f64` inside a struct or enum
//! that derives `Serialize` or `Deserialize` (and is not whitelisted via
//! `#[allowed_bare_f64]`).
//!
//! Drives the `tests/no_bare_f64_at_boundary.rs` test in each of the five type
//! crates under `compute/core/crates/types/`.
//!
//! ## Recursion contract
//!
//! The walker descends into generic arguments to find `f64` at any depth. It
//! walks through:
//!
//! - `Option<T>`, `Box<T>`, `Rc<T>`, `Arc<T>`, `Cow<'_, T>` → check `T`
//! - `Vec<T>`, `[T]`, `[T; N]`, `&T`, `&mut T` → check `T`
//! - `HashMap<K, V>`, `BTreeMap<K, V>`, `IndexMap<K, V>` → check `V` and `K`
//! - Tuples `(T1, T2, …)` → check each `Ti`
//! - Enum variants — both `V { f: f64 }` and `V(f64)`
//!
//! Without these, `Option<HashMap<String, f64>>` would slip through.
//!
//! ## Allow-list mechanism
//!
//! A field carrying `#[allowed_bare_f64]` (or any attribute whose final path
//! segment is `allowed_bare_f64`) is skipped. The escape hatch is registered
//! by the `finite_at_boundary::AllowedBareF64` derive macro; see that crate's
//! docs.
//!
//! ## Known limitations
//!
//! The walker is purely syntactic. It does NOT resolve `use` aliases or
//! `type` aliases (e.g., `type Coord = f64; struct X { c: Coord }` would slip
//! through). This is accepted; we forbid such aliases by convention. There are
//! zero today.
//!
//! The walker also does not follow type definitions across files — if a
//! type-crate field uses a struct from another module which contains an
//! unmarked `f64`, the violation is detected only when scanning the *defining*
//! crate. Since all five type crates run the walker, every `Serialize`-deriving
//! type's fields are scanned exactly once at their definition site.

use std::path::{Path, PathBuf};

use syn::{
    Attribute, Field, Fields, GenericArgument, Item, ItemEnum, ItemStruct, Meta, PathArguments,
    Type, TypeArray, TypeBareFn, TypeGroup, TypeParen, TypePath, TypePtr, TypeReference, TypeSlice,
    TypeTuple, Variant,
};
use walkdir::WalkDir;

/// A single bare-`f64` violation site.
#[derive(Debug, Clone)]
pub struct Violation {
    /// Path of the source file (relative to the crate root if `src_root` was given).
    pub file: PathBuf,
    /// 1-based line number of the offending field.
    pub line: usize,
    /// Containing item (struct or enum) name.
    pub item: String,
    /// Optional enum variant name (only set for enum-variant violations).
    pub variant: Option<String>,
    /// Field name (or numeric index for tuple-struct / tuple-variant fields).
    pub field: String,
    /// Pretty-printed offending field type (best-effort).
    pub ty: String,
}

impl std::fmt::Display for Violation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let where_ = match &self.variant {
            Some(v) => format!("{}::{}.{}", self.item, v, self.field),
            None => format!("{}.{}", self.item, self.field),
        };
        write!(
            f,
            "{}:{}: {}: {}",
            self.file.display(),
            self.line,
            where_,
            self.ty
        )
    }
}

/// Scan every `.rs` file beneath `src_root` and return all violations.
///
/// Errors are not propagated — files that fail to parse are silently skipped
/// (with a `Violation`-free result). This keeps the test resilient to in-flight
/// edits (e.g. a half-typed `.rs` file under a co-author's editor) and matches
/// the current soft-failure behavior. A future tightening may want to
/// surface parse errors.
pub fn walk_serde_types_with_bare_f64(src_root: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();
    for entry in WalkDir::new(src_root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("rs") {
            continue;
        }
        let Ok(src) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(file) = syn::parse_file(&src) else {
            continue;
        };
        let line_index = LineIndex::new(&src);
        scan_items(path, &line_index, &file.items, &mut violations);
    }
    violations
}

/// Maps byte offsets in a source string to 1-based line numbers.
struct LineIndex {
    /// Byte offset of the start of each line (line N starts at line_starts[N-1]).
    line_starts: Vec<usize>,
}

impl LineIndex {
    fn new(src: &str) -> Self {
        let mut line_starts = vec![0];
        for (i, b) in src.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(i + 1);
            }
        }
        Self { line_starts }
    }

    /// 1-based line number for a byte offset.
    fn line(&self, offset: usize) -> usize {
        match self.line_starts.binary_search(&offset) {
            Ok(idx) => idx + 1,
            Err(idx) => idx, // idx is the first line_start > offset; line is idx
        }
    }
}

/// Convenience wrapper that takes the running test's `CARGO_MANIFEST_DIR`,
/// joins `src/`, and walks. Used by every type-crate test.
pub fn walk_crate_src(manifest_dir: &str) -> Vec<Violation> {
    let src = Path::new(manifest_dir).join("src");
    walk_serde_types_with_bare_f64(&src)
}

/// Scan a Rust source string in-memory (used by the walker's own self-tests
/// to verify positive/negative detection without touching the filesystem).
pub fn walk_source_string(label: &str, src: &str) -> Vec<Violation> {
    let mut violations = Vec::new();
    let Ok(file) = syn::parse_file(src) else {
        return violations;
    };
    let line_index = LineIndex::new(src);
    scan_items(Path::new(label), &line_index, &file.items, &mut violations);
    violations
}

fn scan_items(file_path: &Path, lines: &LineIndex, items: &[Item], out: &mut Vec<Violation>) {
    for item in items {
        match item {
            Item::Struct(s) => scan_struct(file_path, lines, s, out),
            Item::Enum(e) => scan_enum(file_path, lines, e, out),
            Item::Mod(m) => {
                if let Some((_, items)) = &m.content {
                    scan_items(file_path, lines, items, out);
                }
            }
            _ => {}
        }
    }
}

fn scan_struct(file_path: &Path, lines: &LineIndex, s: &ItemStruct, out: &mut Vec<Violation>) {
    if !derives_serde(&s.attrs) {
        return;
    }
    let item_name = s.ident.to_string();
    scan_fields(file_path, lines, &item_name, None, &s.fields, out);
}

fn scan_enum(file_path: &Path, lines: &LineIndex, e: &ItemEnum, out: &mut Vec<Violation>) {
    if !derives_serde(&e.attrs) {
        return;
    }
    let item_name = e.ident.to_string();
    for variant in &e.variants {
        scan_variant(file_path, lines, &item_name, variant, out);
    }
}

fn scan_variant(
    file_path: &Path,
    lines: &LineIndex,
    item: &str,
    v: &Variant,
    out: &mut Vec<Violation>,
) {
    let variant_name = v.ident.to_string();
    scan_fields(file_path, lines, item, Some(&variant_name), &v.fields, out);
}

fn scan_fields(
    file_path: &Path,
    lines: &LineIndex,
    item: &str,
    variant: Option<&str>,
    fields: &Fields,
    out: &mut Vec<Violation>,
) {
    match fields {
        Fields::Named(named) => {
            for field in &named.named {
                check_field(file_path, lines, item, variant, field, None, out);
            }
        }
        Fields::Unnamed(unnamed) => {
            for (idx, field) in unnamed.unnamed.iter().enumerate() {
                check_field(file_path, lines, item, variant, field, Some(idx), out);
            }
        }
        Fields::Unit => {}
    }
}

fn check_field(
    file_path: &Path,
    lines: &LineIndex,
    item: &str,
    variant: Option<&str>,
    field: &Field,
    tuple_idx: Option<usize>,
    out: &mut Vec<Violation>,
) {
    if has_allowed_bare_f64(&field.attrs) {
        return;
    }
    if !type_contains_f64(&field.ty) {
        return;
    }
    let field_name = match (&field.ident, tuple_idx) {
        (Some(i), _) => i.to_string(),
        (None, Some(idx)) => idx.to_string(),
        (None, None) => "?".to_string(),
    };
    let ty_str = pretty_type(&field.ty);
    // `byte_range()` is stable on `proc_macro2::Span`; for AST nodes parsed
    // from source it returns the offset within that source text. For
    // synthesised/zero spans it returns 0..0, which maps to line 1 — fine
    // for a diagnostic.
    let span = field_span(field);
    let offset = span.byte_range().start;
    let line = lines.line(offset);
    out.push(Violation {
        file: file_path.to_path_buf(),
        line,
        item: item.to_string(),
        variant: variant.map(str::to_string),
        field: field_name,
        ty: ty_str,
    });
}

/// Best-effort span for a field — prefers the field name's span, falls back
/// to the type's span. Used only for line-number diagnostics.
fn field_span(field: &Field) -> proc_macro2::Span {
    use quote::ToTokens;
    if let Some(ident) = &field.ident {
        return ident.span();
    }
    let mut ts = proc_macro2::TokenStream::new();
    field.ty.to_tokens(&mut ts);
    ts.into_iter()
        .next()
        .map(|t| t.span())
        .unwrap_or_else(proc_macro2::Span::call_site)
}

// ---------------------------------------------------------------------------
// Attribute / derive detection
// ---------------------------------------------------------------------------

/// True if any `#[derive(...)]` attribute on this item lists `Serialize` or
/// `Deserialize` (full path or trailing segment match).
fn derives_serde(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        if !attr.path().is_ident("derive") {
            return false;
        }
        let mut found = false;
        let _ = attr.parse_nested_meta(|meta| {
            if let Some(seg) = meta.path.segments.last() {
                let name = seg.ident.to_string();
                if name == "Serialize" || name == "Deserialize" {
                    found = true;
                }
            }
            Ok(())
        });
        found
    })
}

/// True if this field carries `#[allowed_bare_f64]` (any path whose trailing
/// segment is `allowed_bare_f64`, including the qualified
/// `#[finite_at_boundary::allowed_bare_f64]` form).
fn has_allowed_bare_f64(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| match &attr.meta {
        Meta::Path(p) | Meta::List(syn::MetaList { path: p, .. }) => p
            .segments
            .last()
            .is_some_and(|seg| seg.ident == "allowed_bare_f64"),
        Meta::NameValue(nv) => nv
            .path
            .segments
            .last()
            .is_some_and(|seg| seg.ident == "allowed_bare_f64"),
    })
}

// ---------------------------------------------------------------------------
// Type-tree recursion
// ---------------------------------------------------------------------------

/// True if this `Type` contains a leaf `f64` anywhere in its generic-argument
/// tree. Implements the recursion contract above.
pub fn type_contains_f64(ty: &Type) -> bool {
    match ty {
        Type::Path(TypePath { path, qself: _ }) => {
            // Leaf check: a path whose final segment is exactly `f64` with no
            // generic arguments. We check both single-segment (`f64`) and
            // qualified (`std::primitive::f64`, however unlikely) forms.
            if let Some(last) = path.segments.last() {
                if last.ident == "f64" && matches!(last.arguments, PathArguments::None) {
                    return true;
                }
                // Recurse into generic arguments of every path segment so
                // `Option<HashMap<String, f64>>` and similar nested forms are
                // caught. We don't filter by container name (Option/Vec/...);
                // any generic-argument position is checked. This is stricter
                // than checking a fixed container list and correctly handles
                // user-defined containers (e.g. `MyWrapper<f64>`).
                for seg in &path.segments {
                    if let PathArguments::AngleBracketed(args) = &seg.arguments {
                        for arg in &args.args {
                            if let GenericArgument::Type(inner) = arg
                                && type_contains_f64(inner)
                            {
                                return true;
                            }
                        }
                    }
                }
            }
            false
        }
        Type::Tuple(TypeTuple { elems, .. }) => elems.iter().any(type_contains_f64),
        Type::Array(TypeArray { elem, .. }) => type_contains_f64(elem),
        Type::Slice(TypeSlice { elem, .. }) => type_contains_f64(elem),
        Type::Reference(TypeReference { elem, .. }) => type_contains_f64(elem),
        Type::Ptr(TypePtr { elem, .. }) => type_contains_f64(elem),
        Type::Paren(TypeParen { elem, .. }) => type_contains_f64(elem),
        Type::Group(TypeGroup { elem, .. }) => type_contains_f64(elem),
        // BareFn: `fn(f64) -> f64` etc. Conservatively flag any f64 in the
        // signature. Function-type fields in serde-deriving structs are
        // exceedingly rare, but if one ever appears, we want the gate to fire.
        Type::BareFn(TypeBareFn { inputs, output, .. }) => {
            inputs.iter().any(|arg| type_contains_f64(&arg.ty))
                || matches!(output, syn::ReturnType::Type(_, t) if type_contains_f64(t))
        }
        // Trait objects, impl Trait, never, infer, macro, verbatim — these
        // shouldn't appear in serde-deriving struct fields. Treat as not-f64.
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Pretty-print (for diagnostic messages only — not part of the contract)
// ---------------------------------------------------------------------------

fn pretty_type(ty: &Type) -> String {
    use quote::ToTokens;
    let mut ts = proc_macro2::TokenStream::new();
    ty.to_tokens(&mut ts);
    ts.to_string()
}
