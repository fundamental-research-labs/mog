//! Intermediate representation for TypeScript code generation.
//!
//! These types capture the shape of a bridge API *after* parsing Rust source
//! and *before* emitting TypeScript. They are deliberately decoupled from
//! `syn` types so that the emitter can work with clean, owned data.

/// A complete TypeScript API extracted from one or more Rust source files.
#[derive(Debug, Clone)]
pub struct TsApi {
    /// All services / stateless modules found in the source.
    pub services: Vec<TsService>,
}

/// One "service" — either a stateless function collection or a stateful
/// instance with a key parameter.
#[derive(Debug, Clone)]
pub struct TsService {
    /// The Rust type name, e.g. `KvUtils` or `KvStore`.
    pub rust_name: String,
    /// If `Some`, this is a stateful service whose instances are keyed by a
    /// runtime identifier (e.g. `store_id`). If `None`, it is a stateless
    /// collection of pure functions.
    pub key: Option<ServiceKey>,
    /// If `Some`, overrides the default `type_snake` prefix for command names.
    /// `Some("")` means no prefix (bare method name).
    /// `None` means use the default `type_snake` prefix.
    pub fn_prefix: Option<String>,
    /// All methods (merged from all groups).
    pub methods: Vec<TsMethod>,
}

/// The key that identifies a stateful service instance.
#[derive(Debug, Clone)]
pub struct ServiceKey {
    /// The parameter name in snake_case, e.g. `"store_id"`.
    pub param_name: String,
}

/// A single method on a service.
#[derive(Debug, Clone)]
pub struct TsMethod {
    /// Rust method name in `snake_case`.
    pub rust_name: String,
    /// Access level from the bridge annotation.
    pub access: MethodAccess,
    /// Parameters (excluding `self` and the key parameter for stateful services —
    /// the key is handled at the service level).
    pub params: Vec<TsParam>,
    /// The TypeScript return type (inside `Promise<>`).
    pub return_type: TsType,
    /// Whether the original Rust method returns `Result` (errors become
    /// Promise rejections, so this doesn't change the TS signature, but it's
    /// useful metadata).
    pub is_fallible: bool,
    /// Platforms this method should be skipped for (e.g., `["wasm"]`, `["tauri"]`).
    /// Empty = not skipped. Populated from `#[bridge::skip(wasm)]` etc.
    pub skip_platforms: Vec<String>,
}

/// Access level mirroring the `bridge::` annotation.
///
/// `LifecycleSubscribe` is a TS-bridge-only refinement of `Write` for methods
/// that register / unregister subscriptions (viewports, observers, etc.). They
/// travel over the wire identically to `Write`, but are tagged as `'lifecycle'`
/// in the generated method-kind manifest so observability tooling can
/// distinguish subscription-management calls from data mutations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MethodAccess {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleSubscribe,
}

/// A single parameter.
#[derive(Debug, Clone)]
pub struct TsParam {
    /// Rust name in `snake_case`.
    pub rust_name: String,
    /// The TypeScript type.
    pub ts_type: TsType,
    /// Whether this param has `#[bridge::parse]` — it gets sent as a string
    /// on the wire regardless of its Rust type.
    pub is_parse: bool,
}

// ─── Type Definition IR (struct/enum generation) ───────────────────────────

/// A type definition extracted from a Rust struct or enum with `#[derive(Serialize)]`.
#[derive(Debug, Clone)]
pub enum TsTypeDef {
    /// A struct → `export interface Foo { ... }`
    Interface(TsInterface),
    /// An all-unit enum → `export type Axis = "row" | "col";`
    StringUnion(TsStringUnion),
    /// An enum with data variants → discriminated union type
    TaggedUnion(TsTaggedUnion),
    /// A type with `#[serde(into = "T")]` → `export type Name = T;`
    TypeAlias { name: String, target: TsType },
}

impl TsTypeDef {
    /// The TypeScript name of this type definition.
    pub fn name(&self) -> &str {
        match self {
            TsTypeDef::Interface(i) => &i.name,
            TsTypeDef::StringUnion(s) => &s.name,
            TsTypeDef::TaggedUnion(t) => &t.name,
            TsTypeDef::TypeAlias { name, .. } => name,
        }
    }
}

/// A Rust struct → TypeScript interface.
#[derive(Debug, Clone)]
pub struct TsInterface {
    pub name: String,
    pub fields: Vec<TsField>,
}

/// A single field in a TypeScript interface.
#[derive(Debug, Clone)]
pub struct TsField {
    /// The field name as it appears in JSON (after serde renames).
    pub ts_name: String,
    /// The TypeScript type.
    pub ts_type: TsType,
    /// Whether this field is optional (`field?: T`) vs required (`field: T`).
    pub optional: bool,
}

/// An all-unit enum → string union type.
#[derive(Debug, Clone)]
pub struct TsStringUnion {
    pub name: String,
    /// Variant names after applying rename rules.
    pub variants: Vec<String>,
}

/// An enum with data-carrying variants → discriminated union.
#[derive(Debug, Clone)]
pub struct TsTaggedUnion {
    pub name: String,
    pub tag_style: TagStyle,
    pub variants: Vec<TsTaggedVariant>,
}

/// How serde serializes an enum's variants.
#[derive(Debug, Clone)]
pub enum TagStyle {
    /// Default serde: `{ "VariantName": data }`
    External,
    /// `#[serde(tag = "t", content = "v")]`: `{ t: "Variant", v: data }`
    Adjacent { tag: String, content: String },
    /// `#[serde(tag = "type")]`: `{ type: "Variant", ...fields }`
    Internal { tag: String },
    /// `#[serde(untagged)]`: just the data, no discriminant
    Untagged,
}

/// A single variant in a tagged union.
#[derive(Debug, Clone)]
pub struct TsTaggedVariant {
    /// The variant name after applying rename rules.
    pub variant_name: String,
    /// The payload type. `TsType::Void` for unit variants.
    pub data_type: TsType,
}

// ─── TypeScript Type IR (shared by both method and type generation) ─────────

/// A TypeScript type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TsType {
    /// `string`
    String,
    /// `number`
    Number,
    /// `boolean`
    Boolean,
    /// `void`
    Void,
    /// `Uint8Array`
    Uint8Array,
    /// `T[]`
    Array(Box<TsType>),
    /// `T | null`
    Nullable(Box<TsType>),
    /// `Record<K, V>`
    Record(Box<TsType>, Box<TsType>),
    /// `[T1, T2, ...]` — Rust tuples → TS tuples (serde serializes as JSON arrays)
    Tuple(Vec<TsType>),
    /// A named type (struct/enum) that we don't fully expand — just use its name.
    Named(String),
}

impl TsType {
    /// Render this type as a TypeScript type expression.
    pub fn to_ts_string(&self) -> String {
        match self {
            TsType::String => "string".to_string(),
            TsType::Number => "number".to_string(),
            TsType::Boolean => "boolean".to_string(),
            TsType::Void => "void".to_string(),
            TsType::Uint8Array => "Uint8Array".to_string(),
            TsType::Array(inner) => {
                let s = inner.to_ts_string();
                // Parenthesize union types to avoid precedence issues: (T | null)[] not T | null[]
                if matches!(**inner, TsType::Nullable(_)) {
                    format!("({})[]", s)
                } else {
                    format!("{}[]", s)
                }
            }
            TsType::Nullable(inner) => format!("{} | null", inner.to_ts_string()),
            TsType::Record(key, value) => {
                format!("Record<{}, {}>", key.to_ts_string(), value.to_ts_string())
            }
            TsType::Tuple(elems) => {
                let inner: Vec<String> = elems.iter().map(|e| e.to_ts_string()).collect();
                format!("[{}]", inner.join(", "))
            }
            TsType::Named(name) => name.clone(),
        }
    }
}

// ─── Import Configuration ───────────────────────────────────────────────────

/// Configuration for generating `import type` statements in emitted TypeScript.
#[derive(Debug, Clone, Default)]
pub struct ImportConfig {
    /// Groups of imports, each targeting a different module path.
    pub groups: Vec<ImportGroup>,
}

/// A single `import type { ... } from '...';` statement.
#[derive(Debug, Clone)]
pub struct ImportGroup {
    /// The module specifier, e.g. `"./compute-types.gen"` or `"@mog/table-engine"`.
    pub from: String,
    /// The type names to import from this module.
    pub types: Vec<TypeImport>,
}

/// A single type import, optionally renamed.
#[derive(Debug, Clone)]
pub struct TypeImport {
    /// The name used locally in the generated file (e.g. `"CellValue"`).
    pub local_name: String,
    /// If `Some`, the name exported from the source module (e.g. `"ExternalCellValue"`).
    /// Emits `import type { ExternalCellValue as CellValue }`.
    /// If `None`, emits `import type { CellValue }`.
    pub imported_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ts_type_string() {
        assert_eq!(TsType::String.to_ts_string(), "string");
    }

    #[test]
    fn ts_type_number() {
        assert_eq!(TsType::Number.to_ts_string(), "number");
    }

    #[test]
    fn ts_type_boolean() {
        assert_eq!(TsType::Boolean.to_ts_string(), "boolean");
    }

    #[test]
    fn ts_type_void() {
        assert_eq!(TsType::Void.to_ts_string(), "void");
    }

    #[test]
    fn ts_type_uint8array() {
        assert_eq!(TsType::Uint8Array.to_ts_string(), "Uint8Array");
    }

    #[test]
    fn ts_type_array_of_string() {
        let ty = TsType::Array(Box::new(TsType::String));
        assert_eq!(ty.to_ts_string(), "string[]");
    }

    #[test]
    fn ts_type_array_of_number() {
        let ty = TsType::Array(Box::new(TsType::Number));
        assert_eq!(ty.to_ts_string(), "number[]");
    }

    #[test]
    fn ts_type_nullable_string() {
        let ty = TsType::Nullable(Box::new(TsType::String));
        assert_eq!(ty.to_ts_string(), "string | null");
    }

    #[test]
    fn ts_type_nullable_number() {
        let ty = TsType::Nullable(Box::new(TsType::Number));
        assert_eq!(ty.to_ts_string(), "number | null");
    }

    #[test]
    fn ts_type_record() {
        let ty = TsType::Record(Box::new(TsType::String), Box::new(TsType::Number));
        assert_eq!(ty.to_ts_string(), "Record<string, number>");
    }

    #[test]
    fn ts_type_named() {
        let ty = TsType::Named("StoreStats".to_string());
        assert_eq!(ty.to_ts_string(), "StoreStats");
    }

    #[test]
    fn ts_type_array_of_named() {
        let ty = TsType::Array(Box::new(TsType::Named("Item".to_string())));
        assert_eq!(ty.to_ts_string(), "Item[]");
    }

    #[test]
    fn ts_type_nullable_named() {
        let ty = TsType::Nullable(Box::new(TsType::Named("Config".to_string())));
        assert_eq!(ty.to_ts_string(), "Config | null");
    }

    #[test]
    fn ts_type_nested_array() {
        let ty = TsType::Array(Box::new(TsType::Array(Box::new(TsType::Number))));
        assert_eq!(ty.to_ts_string(), "number[][]");
    }

    #[test]
    fn ts_type_record_of_arrays() {
        let ty = TsType::Record(
            Box::new(TsType::String),
            Box::new(TsType::Array(Box::new(TsType::Number))),
        );
        assert_eq!(ty.to_ts_string(), "Record<string, number[]>");
    }

    #[test]
    fn ts_type_tuple() {
        let ty = TsType::Tuple(vec![TsType::Number, TsType::Number]);
        assert_eq!(ty.to_ts_string(), "[number, number]");
    }

    #[test]
    fn ts_type_tuple_mixed() {
        let ty = TsType::Tuple(vec![TsType::String, TsType::Number, TsType::Boolean]);
        assert_eq!(ty.to_ts_string(), "[string, number, boolean]");
    }

    #[test]
    fn ts_type_array_of_tuples() {
        let ty = TsType::Array(Box::new(TsType::Tuple(vec![
            TsType::Number,
            TsType::Number,
        ])));
        assert_eq!(ty.to_ts_string(), "[number, number][]");
    }

    #[test]
    fn ts_type_array_of_nullable() {
        // (T | null)[] — must parenthesize to avoid T | null[]
        let ty = TsType::Array(Box::new(TsType::Nullable(Box::new(TsType::Named(
            "Foo".into(),
        )))));
        assert_eq!(ty.to_ts_string(), "(Foo | null)[]");
    }

    #[test]
    fn ts_type_def_name_type_alias() {
        let def = TsTypeDef::TypeAlias {
            name: "SheetId".into(),
            target: TsType::String,
        };
        assert_eq!(def.name(), "SheetId");
    }
}
