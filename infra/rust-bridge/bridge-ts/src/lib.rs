//! TypeScript code generator for rust-bridge.
//!
//! Two generation modes:
//!
//! 1. **Client generation** — parses `#[bridge::api]` blocks and emits a typed
//!    TypeScript client with `BridgeTransport` abstraction.
//!
//! 2. **Type generation** — parses `#[derive(Serialize)]` structs/enums and
//!    emits TypeScript interfaces, string unions, and discriminated unions that
//!    match Rust's serde JSON serialization.
//!
//! # Client generation
//!
//! ```rust,no_run
//! let ts_code = bridge_ts::generate_from_source("pub struct Foo;");
//! ```
//!
//! # Type generation
//!
//! ```rust,no_run
//! use bridge_ts::{generate_types_from_source, TypeGenConfig};
//! let config = TypeGenConfig::default();
//! let ts_code = generate_types_from_source("use serde::Serialize; #[derive(Serialize)] pub struct Foo { pub x: u32 }", &config);
//! ```

pub mod emit;
pub mod mapping;
pub mod parse;
pub mod parse_types;
pub mod serde_attrs;
pub mod types;

pub use emit::{
    BridgeConfig, BridgePattern, HandlerRegistryConfig, classify_bridge_pattern,
    collect_named_from_api, collect_tauri_handler_names, emit_api, emit_bridge,
    emit_command_metadata, emit_handler_registry, emit_kind_manifest, emit_type_defs,
    is_binary_mutation_return, method_access_to_kind,
};
pub use parse::{merge_blocks, parse_source};
pub use parse_types::{TypeGenConfig, parse_types};
pub use types::{ImportConfig, ImportGroup, TsApi, TsTypeDef, TypeImport};

/// Parse Rust source code and generate TypeScript client code.
///
/// This is the main entry point for single-file generation.
pub fn generate_from_source(source: &str) -> Result<String, String> {
    let blocks = parse_source(source)?;
    let api = merge_blocks(blocks);
    Ok(emit_api(&api, None))
}

/// Parse multiple Rust source files and generate a combined TypeScript client.
///
/// Reads each file, parses all `#[bridge::api]` blocks, merges services
/// across files, and emits a single TypeScript file.
pub fn generate_from_files(
    source_paths: &[impl AsRef<std::path::Path>],
    output_path: impl AsRef<std::path::Path>,
    imports: Option<&types::ImportConfig>,
) -> Result<(), String> {
    let mut all_blocks = Vec::new();

    for path in source_paths {
        let source = std::fs::read_to_string(path.as_ref())
            .map_err(|e| format!("Failed to read {}: {}", path.as_ref().display(), e))?;
        let blocks = parse_source(&source)?;
        all_blocks.extend(blocks);
    }

    let api = merge_blocks(all_blocks);
    let ts_code = emit_api(&api, imports);

    if let Some(parent) = output_path.as_ref().parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    std::fs::write(output_path.as_ref(), ts_code)
        .map_err(|e| format!("Failed to write {}: {}", output_path.as_ref().display(), e))?;

    Ok(())
}

// ─── Type Generation API ────────────────────────────────────────────────────

/// Parse Rust source code and generate TypeScript type definitions.
///
/// Looks for structs/enums with `#[derive(Serialize)]`, respects serde
/// attributes (`rename_all`, `tag`, `content`, `untagged`, `skip`, etc.),
/// and emits matching TypeScript interfaces, string unions, and
/// discriminated unions.
pub fn generate_types_from_source(
    source: &str,
    config: &parse_types::TypeGenConfig,
) -> Result<String, String> {
    let defs = parse_types::parse_types(source, config)?;
    Ok(emit::emit_type_defs(&defs, None))
}

/// Parse multiple Rust source files and generate a combined TypeScript
/// type definitions file.
pub fn generate_types_from_files(
    source_paths: &[impl AsRef<std::path::Path>],
    config: &parse_types::TypeGenConfig,
    output_path: impl AsRef<std::path::Path>,
) -> Result<(), String> {
    let mut all_defs = Vec::new();

    for path in source_paths {
        let source = std::fs::read_to_string(path.as_ref())
            .map_err(|e| format!("Failed to read {}: {}", path.as_ref().display(), e))?;
        let defs = parse_types::parse_types(&source, config)?;
        all_defs.extend(defs);
    }

    let ts_code = emit::emit_type_defs(&all_defs, None);

    if let Some(parent) = output_path.as_ref().parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    std::fs::write(output_path.as_ref(), ts_code)
        .map_err(|e| format!("Failed to write {}: {}", output_path.as_ref().display(), e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_to_end_kv_store() {
        let source = r#"
use bridge_core as bridge;

pub struct KvUtils;

#[bridge::api]
impl KvUtils {
    #[bridge::pure]
    pub fn hash_key(key: &str) -> u64 {
        todo!()
    }

    #[bridge::pure]
    pub fn is_valid_json(value: &str) -> bool {
        todo!()
    }
}

#[bridge::service]
pub struct KvStore {
    data: std::collections::HashMap<String, String>,
}

#[bridge::api(service = "KvStore", key = "store_id", group = "ops")]
impl KvStore {
    #[bridge::lifecycle(create)]
    pub fn new(config: KvConfig) -> Result<Self, KvError> {
        todo!()
    }

    #[bridge::read]
    pub fn get(&self, key: &str) -> Result<String, KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn set(&mut self, key: String, value: String) -> Result<(), KvError> {
        todo!()
    }
}

#[bridge::api(service = "KvStore", key = "store_id", group = "admin")]
impl KvStore {
    #[bridge::read]
    pub fn list_keys(&self) -> Vec<String> {
        todo!()
    }
}
"#;
        let ts = generate_from_source(source).unwrap();

        // Both services present
        assert!(ts.contains("createKvStoreClient"));
        assert!(ts.contains("createKvUtilsClient"));

        // KvStore methods merged from ops + admin
        assert!(ts.contains("'kv_store_new'"));
        assert!(ts.contains("'kv_store_get'"));
        assert!(ts.contains("'kv_store_set'"));
        assert!(ts.contains("'kv_store_list_keys'"));
        assert!(ts.contains("'kv_store_destroy'"));

        // KvUtils methods
        assert!(ts.contains("'kv_utils_hash_key'"));
        assert!(ts.contains("'kv_utils_is_valid_json'"));
    }

    #[test]
    fn empty_source_produces_header_only() {
        let ts = generate_from_source("pub struct Foo;").unwrap();
        assert!(ts.contains("Auto-generated by bridge-ts"));
        assert!(ts.contains("BridgeTransport"));
        assert!(!ts.contains("export function"));
    }

    /// Generate TypeScript from a complete kv-store-style bridge fixture.
    #[test]
    fn generate_from_kv_store_fixture() {
        let source = r#"
use bridge_core as bridge;

pub struct KvUtils;

#[bridge::api]
impl KvUtils {
    #[bridge::pure]
    pub fn hash_key(key: &str) -> u64 {
        todo!()
    }

    #[bridge::pure]
    pub fn is_valid_json(value: &str) -> bool {
        todo!()
    }
}

#[bridge::service]
pub struct KvStore {
    data: std::collections::HashMap<String, String>,
}

#[bridge::api(service = "KvStore", key = "store_id", group = "ops")]
impl KvStore {
    #[bridge::lifecycle(create)]
    pub fn new(config: KvConfig) -> Result<Self, KvError> {
        todo!()
    }

    #[bridge::read]
    pub fn get(&self, key: &str) -> Result<String, KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn set(&mut self, key: String, value: String) -> Result<(), KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn delete(&mut self, key: String) -> Result<(), KvError> {
        todo!()
    }

    #[bridge::read]
    pub fn get_by_id(&self, id: &str) -> Result<String, KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn set_by_id(&mut self, id: String, value: String) -> Result<(), KvError> {
        todo!()
    }
}

#[bridge::api(service = "KvStore", key = "store_id", group = "admin")]
impl KvStore {
    #[bridge::read]
    pub fn list_keys(&self) -> Vec<String> {
        todo!()
    }

    #[bridge::read]
    pub fn stats(&self) -> StoreStats {
        todo!()
    }
}
"#;
        let ts = generate_from_source(&source).unwrap();

        // KvStore service (merged from ops + admin)
        assert!(ts.contains("export function createKvStoreClient(transport: BridgeTransport)"));
        assert!(ts.contains("export interface KvStoreClient"));
        // All 8 methods + destroy
        assert!(ts.contains("'kv_store_new'"));
        assert!(ts.contains("'kv_store_get'"));
        assert!(ts.contains("'kv_store_set'"));
        assert!(ts.contains("'kv_store_delete'"));
        assert!(ts.contains("'kv_store_get_by_id'"));
        assert!(ts.contains("'kv_store_set_by_id'"));
        assert!(ts.contains("'kv_store_list_keys'"));
        assert!(ts.contains("'kv_store_stats'"));
        assert!(ts.contains("'kv_store_destroy'"));

        // KvUtils service (stateless)
        assert!(ts.contains("export function createKvUtilsClient(transport: BridgeTransport)"));
        assert!(ts.contains("export interface KvUtilsClient"));
        assert!(ts.contains("'kv_utils_hash_key'"));
        assert!(ts.contains("'kv_utils_is_valid_json'"));

        // No destroy on stateless
        assert!(!ts.contains("'kv_utils_destroy'"));

        // Parse params become string
        assert!(ts.contains("getById(storeId: string, id: string)"));

        // Vec<String> → string[]
        assert!(ts.contains("string[]"));

        // StoreStats → Named("StoreStats")
        assert!(ts.contains("StoreStats"));
    }
}
