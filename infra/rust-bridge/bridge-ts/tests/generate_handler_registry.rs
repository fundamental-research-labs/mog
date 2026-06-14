//! Generate `handlers.gen.rs` — the Tauri handler registry.
//!
//! This replaces the ~660-line manual `tauri::generate_handler![...]` in lib.rs
//! with a generated include file derived from bridge annotations.
//!
//! Run: pnpm generate:bridge
//! Output: runtime/src-tauri/src/handlers.gen.rs

use bridge_ts::{
    HandlerRegistryConfig, TsApi, collect_tauri_handler_names, emit_command_metadata,
    emit_handler_registry, merge_blocks, parse_source,
};

/// Service → Tauri command module path mappings.
///
/// This tells the codegen which Rust module in the desktop crate hosts each
/// service's bridge-generated commands. The module path is relative to the
/// crate root (i.e., what you'd write after `commands::` in lib.rs).
fn service_module_map() -> Vec<(String, String)> {
    vec![
        // Stateful compute engine — YrsComputeEngine (compute-core) provides
        // the method implementations, ComputeService (compute-api) wraps them
        // as the Tauri-facing service with lifecycle (init/destroy) methods.
        ("YrsComputeEngine".into(), "commands::compute".into()),
        ("ComputeService".into(), "commands::compute".into()),
        // Stateless pure bridges (compute-core descriptors) — all in compute.rs
        ("FormatBridge".into(), "commands::compute".into()),
        ("SchemaBridge".into(), "commands::compute".into()),
        ("TableBridge".into(), "commands::compute".into()),
        ("ChartBridge".into(), "commands::compute".into()),
        ("CfBridge".into(), "commands::compute".into()),
        ("ClockBridge".into(), "commands::compute".into()),
        // Stateless pivot bridge — in pivot.rs
        ("PivotBridge".into(), "commands::pivot".into()),
        // Stateless XLSX parser — in xlsx.rs
        ("XlsxParser".into(), "commands::xlsx".into()),
    ]
}

/// Hand-written commands that are NOT bridge-generated.
///
/// These are maintained manually here. When you add a new `#[tauri::command]`
/// or `secure_command!` function to a command module, add it to this list.
/// The `verify_up_to_date` test will catch drift.
fn manual_commands() -> Vec<String> {
    vec![
        // ── File operations ──
        "commands::file::read_file",
        "commands::file::write_file",
        "commands::file::show_open_dialog",
        "commands::file::show_save_dialog",
        // ── Recent files ──
        "commands::recent_files::get_recent_files",
        "commands::recent_files::add_recent_file",
        "commands::recent_files::clear_recent_files",
        // ── Recent projects ──
        "commands::recent_projects::get_recent_projects",
        "commands::recent_projects::add_recent_project",
        "commands::recent_projects::clear_recent_projects",
        // ── Preferences ──
        "commands::preferences::get_preference",
        "commands::preferences::set_preference",
        // ── Window state ──
        "commands::window::get_window_state",
        "commands::window::save_window_state",
        "commands::window::open_devtools_window",
        // ── System ──
        "commands::system::get_app_data_dir",
        "commands::system::get_autosave_dir",
        // ── Biometric status ──
        "commands::biometric::biometric_status",
        // ── Autosave ──
        "commands::autosave::list_autosave_files",
        "commands::autosave::create_autosave",
        "commands::autosave::update_autosave",
        "commands::autosave::delete_autosave",
        "commands::autosave::read_autosave",
        "commands::autosave::cleanup_old_autosaves",
        // ── Project ──
        "commands::project::show_open_folder_dialog",
        "commands::project::scan_project_folder",
        "commands::project::is_directory",
        "commands::project::reveal_in_file_manager",
        // ── File operations (context menu) ──
        "commands::file_ops::rename_path",
        "commands::file_ops::delete_path",
        "commands::file_ops::copy_file",
        "commands::file_ops::import_files",
        "commands::file_ops::create_empty_spreadsheet",
        "commands::file_ops::generate_unique_filename",
        "commands::file_ops::create_folder",
        "commands::file_ops::generate_unique_folder_name",
        // ── XLSX native I/O (hand-written, not bridge-generated) ──
        "commands::xlsx::import_xlsx",
        "commands::xlsx::export_xlsx",
        // ── Logging ──
        "commands::logging::append_log",
        "commands::logging::clear_logs",
        "commands::logging::get_log_path",
        // ── Credentials (OS keychain) ──
        "commands::credentials::credential_store",
        "commands::credentials::credential_get",
        "commands::credentials::credential_delete",
        "commands::credentials::credential_list_keys",
        "commands::credentials::credential_exists",
        "commands::credentials::credential_list",
        "commands::credentials::credential_store_temp",
        "commands::credentials::credential_delete_temp",
        // ── Security ──
        "commands::security::init_security_session",
        // ── Menu ──
        "menu::set_menu_items",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

/// All bridge API source files that define `#[bridge::api]` blocks.
fn bridge_source_files() -> Vec<String> {
    let base = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");

    vec![
        // Compute engine (stateful — YrsComputeEngine)
        format!("{}/compute/core/src/storage/engine/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/bridge_imports.rs", base),
        format!("{}/compute/core/src/storage/engine/workbook_theme.rs", base),
        format!("{}/compute/core/src/storage/engine/cell_bridge.rs", base),
        format!("{}/compute/core/src/storage/engine/undo_bridge.rs", base),
        format!("{}/compute/core/src/storage/engine/sync_bridge.rs", base),
        format!("{}/compute/core/src/storage/engine/screenshot.rs", base),
        format!("{}/compute/core/src/storage/engine/delegations.rs", base),
        format!("{}/compute/core/src/storage/engine/viewport/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/queries.rs", base),
        format!("{}/compute/core/src/storage/engine/structural/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/formatting/mod.rs", base),
        format!("{}/compute/core/src/storage/engine/tables.rs", base),
        format!("{}/compute/core/src/storage/engine/features/mod.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/objects/comments.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/objects/charts.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/objects/floating.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/objects/groups.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/objects/z_order.rs",
            base
        ),
        format!(
            "{}/compute/core/src/storage/engine/objects/hyperlinks.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/objects/pivots.rs", base),
        format!(
            "{}/compute/core/src/storage/engine/viewport/registry.rs",
            base
        ),
        format!("{}/compute/core/src/storage/engine/layout.rs", base),
        // NOTE: export.rs is intentionally excluded — its "export" group is not
        // wired into bridge_tauri::generate!() in commands/compute.rs.
        // Compute-API: ComputeService lifecycle (init, full_recalc, destroy)
        format!("{}/compute/api/src/bridge_service.rs", base),
        // Stateless pure bridges (chart, table, pivot, format, schema, cf, clock)
        format!("{}/compute/core/src/bridge_pure.rs", base),
        // XLSX parser (stateless — XlsxParser)
        format!("{}/file-io/xlsx-api/src/bridge.rs", base),
    ]
}

fn handler_output_path() -> String {
    format!(
        "{}/../../../runtime/src-tauri/src/handlers.gen.rs",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn has_tauri_handler_output_path() -> bool {
    std::path::Path::new(&handler_output_path())
        .parent()
        .is_some_and(|parent| parent.exists())
}

fn metadata_output_path() -> String {
    format!(
        "{}/../../../infra/transport/src/command-metadata.gen.ts",
        env!("CARGO_MANIFEST_DIR")
    )
}

/// Commands in BYTES_TUPLE that do NOT trigger formula recalc.
///
/// These return `[Uint8Array, MutationResult]` (so Tauri needs bytes-tuple
/// normalization) but don't evaluate formulas — no need for time injection.
fn recalc_exclusions() -> Vec<&'static str> {
    vec![
        // Binary variant of set_cell (same mutation, different encoding)
        "compute_set_cell_binary",
        // Range clear by position (no formula eval)
        "compute_clear_range_by_position",
        // Sort & AutoFill handle recalc internally
        "compute_sort_range",
        "compute_auto_fill",
        // Format mutations (change style, not values)
        "compute_toggle_format_property",
        "compute_set_format_for_ranges",
        "compute_clear_format_for_ranges",
        // CF rule CRUD (modify conditional formatting rules, not cell values)
        "compute_add_cf_rule",
        "compute_delete_cf_rule",
        "compute_reorder_cf_rules",
        "compute_update_cf_rule",
        // Table display options (visual only, no cell value changes)
        "compute_set_table_style",
        "compute_toggle_banded_cols",
        "compute_toggle_banded_rows",
        // Comment mutations (return viewport patches for HAS_COMMENT flag, but
        // don't trigger formula recalc — comments aren't cell values)
        "compute_add_comment",
        "compute_add_comment_by_position",
        "compute_update_comment",
        "compute_delete_comment",
        "compute_set_thread_resolved",
        "compute_delete_comments_for_cell",
        "compute_delete_comments_for_cell_by_position",
        "compute_clear_all_comments",
        "compute_validate_and_clean_comments",
    ]
}

/// Security level overrides for bridge services (non-Public).
fn security_overrides() -> Vec<(&'static str, &'static str)> {
    vec![("XlsxParser", "Sensitive")]
}

/// Parse all bridge source files into a merged API.
fn parse_all_bridges(verbose: bool) -> TsApi {
    let mut all_blocks = Vec::new();
    for path in bridge_source_files() {
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));
        let blocks = parse_source(&source).unwrap_or_else(|e| {
            panic!("Failed to parse {}: {}", path, e);
        });
        if verbose {
            eprintln!(
                "{}: {} blocks, {} methods",
                path.rsplit('/').next().unwrap(),
                blocks.len(),
                blocks.iter().map(|b| b.methods.len()).sum::<usize>()
            );
        }
        all_blocks.extend(blocks);
    }

    let api = merge_blocks(all_blocks);

    if verbose {
        eprintln!("\nMerged services:");
        for svc in &api.services {
            eprintln!(
                "  {} ({} methods, key={})",
                svc.rust_name,
                svc.methods.len(),
                svc.key.as_ref().map_or("none", |k| k.param_name.as_str())
            );
        }
    }

    api
}

/// Generate handler registry and command metadata files.
///
/// Run: pnpm generate:bridge
#[test]
fn generate() {
    let api = parse_all_bridges(true);

    // ── Handler registry (Rust) ──
    let config = HandlerRegistryConfig {
        service_modules: service_module_map(),
        manual_commands: manual_commands(),
    };
    let handlers = collect_tauri_handler_names(&api, &config);
    eprintln!("\nTotal handlers: {}", handlers.len());

    let handler_content = emit_handler_registry(&handlers);
    let handler_path = handler_output_path();
    if has_tauri_handler_output_path() {
        std::fs::write(&handler_path, &handler_content).unwrap();
        eprintln!("Written handler registry to: {}", handler_path);
    } else {
        eprintln!(
            "Skipping handler registry write; Tauri output directory is not present at {}",
            handler_path
        );
    }

    // ── Command metadata (TypeScript) ──
    let metadata_content = emit_command_metadata(&api, &recalc_exclusions(), &security_overrides());
    let metadata_path = metadata_output_path();
    std::fs::write(&metadata_path, &metadata_content).unwrap();
    eprintln!("Written command metadata to: {}", metadata_path);
}

/// Verify generated files are up-to-date.
#[test]
fn verify_up_to_date() {
    let api = parse_all_bridges(false);

    // ── Handler registry ──
    let config = HandlerRegistryConfig {
        service_modules: service_module_map(),
        manual_commands: manual_commands(),
    };
    let handlers = collect_tauri_handler_names(&api, &config);
    let expected_handlers = emit_handler_registry(&handlers);

    let handler_path = handler_output_path();
    if has_tauri_handler_output_path() {
        let actual_handlers = std::fs::read_to_string(&handler_path).unwrap_or_else(|e| {
            panic!(
                "handlers.gen.rs not found at {}. Run:\n  pnpm generate:bridge\nError: {}",
                handler_path, e
            )
        });
        assert_eq!(
            actual_handlers, expected_handlers,
            "handlers.gen.rs is out of date! Regenerate with:\n  pnpm generate:bridge"
        );
    } else {
        eprintln!(
            "Skipping handler registry verification; Tauri output directory is not present at {}",
            handler_path
        );
    }

    // ── Command metadata ──
    let expected_metadata =
        emit_command_metadata(&api, &recalc_exclusions(), &security_overrides());

    let metadata_path = metadata_output_path();
    let actual_metadata = std::fs::read_to_string(&metadata_path).unwrap_or_else(|e| {
        panic!(
            "command-metadata.gen.ts not found at {}. Run:\n  pnpm generate:bridge\nError: {}",
            metadata_path, e
        )
    });
    assert_eq!(
        actual_metadata, expected_metadata,
        "command-metadata.gen.ts is out of date! Regenerate with:\n  pnpm generate:bridge"
    );
}
