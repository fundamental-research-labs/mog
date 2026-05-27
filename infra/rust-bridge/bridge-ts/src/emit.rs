//! Emit TypeScript code from the parsed API representation.

mod bridge;
mod client;
mod imports;
mod kind_manifest;
mod metadata;
mod names;
mod refs;
mod tauri;
mod type_defs;

pub use bridge::{
    BridgeConfig, BridgePattern, classify_bridge_pattern, emit_bridge, emit_bridge_class_method,
    is_binary_mutation_return,
};
pub use client::{emit_api, emit_service};
pub use kind_manifest::{emit_kind_manifest, method_access_to_kind};
pub use metadata::emit_command_metadata;
pub use names::{to_camel_case, to_snake_case};
pub use refs::collect_named_from_api;
pub use tauri::{HandlerRegistryConfig, collect_tauri_handler_names, emit_handler_registry};
pub use type_defs::{
    emit_interface, emit_string_union, emit_tagged_union, emit_type_alias, emit_type_def,
    emit_type_defs,
};
