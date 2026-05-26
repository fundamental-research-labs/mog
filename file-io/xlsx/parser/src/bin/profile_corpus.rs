//! Native Rust corpus profiler with per-phase timing breakdown.
//!
//! Usage:
//!   xlsx-profile-corpus <corpus-dir> [--output <path>]
//!
//! Runs parse_xlsx_full_native with ParseTimings enabled on every XLSX file
//! in the corpus and produces a detailed phase-level performance report.

use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use xlsx_parser::output::results::ParseTimings;
use xlsx_parser::pipeline::full_parse::parse_xlsx_full_native;

// ============================================================================
// Per-file result
// ============================================================================

struct FileProfile {
    dir_name: String,
    size_bytes: u64,
    cell_count: u32,
    sheet_count: u32,
    shared_string_count: usize,
    timings: ParseTimings,
    wall_us: u64,
    error: Option<String>,
}

// ============================================================================
// Helpers
// ============================================================================

fn fmt_ms(us: f64) -> String {
    format!("{:.1}ms", us / 1000.0)
}

fn fmt_sec(us: f64) -> String {
    format!("{:.2}s", us / 1_000_000.0)
}

fn pct(part: f64, whole: f64) -> String {
    if whole > 0.0 {
        format!("{:.1}%", part / whole * 100.0)
    } else {
        "-".to_string()
    }
}

fn mb(bytes: u64) -> String {
    format!("{:.1}MB", bytes as f64 / 1024.0 / 1024.0)
}

fn fmt_num(n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let s = n.to_string();
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut result = String::with_capacity(len + (len - 1) / 3);
    for (i, &b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            result.push(',');
        }
        result.push(b as char);
    }
    result
}

fn truncate_dir(s: &str, max: usize) -> String {
    if s.len() <= max {
        format!("{:<width$}", s, width = max)
    } else {
        format!("{}..", &s[..max - 2])
    }
}

// ============================================================================
// Directory walking
// ============================================================================

fn find_xlsx_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let xlsx = path.join("latest.xlsx");
                if xlsx.exists() {
                    files.push(xlsx);
                }
            }
        }
    }
    files.sort();
    files
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 || args[1] == "--help" || args[1] == "-h" {
        eprintln!("Usage: xlsx-profile-corpus <corpus-dir> [--output <path>] [--parallel]");
        std::process::exit(1);
    }

    let corpus_dir = Path::new(&args[1]).canonicalize().unwrap_or_else(|e| {
        eprintln!("Cannot resolve {}: {}", args[1], e);
        std::process::exit(1);
    });

    // Check for --parallel flag (uses None timings to exercise parallel code path)
    let parallel_mode = args.iter().any(|a| a == "--parallel");

    let output_path = if let Some(pos) = args.iter().position(|a| a == "--output" || a == "-o") {
        args.get(pos + 1)
            .map(PathBuf::from)
            .unwrap_or_else(|| corpus_dir.join("native-profile-report.json"))
    } else {
        corpus_dir.join("native-profile-report.json")
    };

    let xlsx_files = find_xlsx_files(&corpus_dir);
    if xlsx_files.is_empty() {
        eprintln!("No XLSX files found in {}", corpus_dir.display());
        std::process::exit(1);
    }

    let total = xlsx_files.len();
    println!("Found {} corpus files in {}", total, corpus_dir.display());
    if parallel_mode {
        println!("Mode: PARALLEL (no per-phase profiling, timings=None)");
    }
    println!("Starting native Rust profiled parsing...\n");

    let mut profiles: Vec<FileProfile> = Vec::with_capacity(total);
    let overall_start = Instant::now();

    for (idx, file_path) in xlsx_files.iter().enumerate() {
        let dir_name = file_path
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let data = match fs::read(file_path) {
            Ok(d) => d,
            Err(e) => {
                println!(
                    "  [{:>2}/{}] {}  ERROR: {}",
                    idx + 1,
                    total,
                    truncate_dir(&dir_name, 14),
                    e
                );
                profiles.push(FileProfile {
                    dir_name,
                    size_bytes: 0,
                    cell_count: 0,
                    sheet_count: 0,
                    shared_string_count: 0,
                    timings: ParseTimings::zero(),
                    wall_us: 0,
                    error: Some(e.to_string()),
                });
                continue;
            }
        };

        let size_bytes = data.len() as u64;
        let mut timings = ParseTimings::zero();

        let wall_start = Instant::now();
        let result = if parallel_mode {
            parse_xlsx_full_native(&data, None)
        } else {
            parse_xlsx_full_native(&data, Some(&mut timings))
        };
        let wall_us = wall_start.elapsed().as_micros() as u64;

        match result {
            Ok(parsed) => {
                let cells = parsed.stats.total_cells;
                let cells_per_sec = if wall_us > 0 {
                    (cells as f64 / wall_us as f64 * 1_000_000.0) as u64
                } else {
                    0
                };
                println!(
                    "  [{:>2}/{}] {}  {:<8} {:>10} cells  {:>8}  ({} cells/s)",
                    idx + 1,
                    total,
                    truncate_dir(&dir_name, 14),
                    mb(size_bytes),
                    fmt_num(cells as u64),
                    fmt_ms(wall_us as f64),
                    fmt_num(cells_per_sec),
                );
                profiles.push(FileProfile {
                    dir_name,
                    size_bytes,
                    cell_count: cells,
                    sheet_count: parsed.stats.total_sheets,
                    shared_string_count: parsed.shared_strings.len(),
                    timings,
                    wall_us,
                    error: None,
                });
            }
            Err(e) => {
                println!(
                    "  [{:>2}/{}] {}  PARSE ERROR: {}",
                    idx + 1,
                    total,
                    truncate_dir(&dir_name, 14),
                    e
                );
                profiles.push(FileProfile {
                    dir_name,
                    size_bytes,
                    cell_count: 0,
                    sheet_count: 0,
                    shared_string_count: 0,
                    timings,
                    wall_us,
                    error: Some(e),
                });
            }
        }
        let _ = std::io::stdout().flush();
    }

    let overall_ms = overall_start.elapsed().as_millis() as u64;

    // ===== Analysis =====
    let ok: Vec<&FileProfile> = profiles.iter().filter(|p| p.error.is_none()).collect();
    let errors: Vec<&FileProfile> = profiles.iter().filter(|p| p.error.is_some()).collect();

    let total_cells: u64 = ok.iter().map(|p| p.cell_count as u64).sum();
    let total_bytes: u64 = ok.iter().map(|p| p.size_bytes).sum();
    let total_wall_us: u64 = ok.iter().map(|p| p.wall_us).sum();

    // Aggregate phase timings from Rust instrumentation
    let total_zip: f64 = ok.iter().map(|p| p.timings.zip_index_us()).sum();
    let total_ss: f64 = ok.iter().map(|p| p.timings.shared_strings_us()).sum();
    let total_styles: f64 = ok.iter().map(|p| p.timings.styles_us()).sum();
    let total_meta: f64 = ok.iter().map(|p| p.timings.metadata_us()).sum();
    let total_ws: f64 = ok.iter().map(|p| p.timings.worksheet_parse_us()).sum();
    let total_serde: f64 = ok.iter().map(|p| p.timings.serde_serialize_us()).sum();
    let total_instrumented: f64 = ok.iter().map(|p| p.timings.total_us()).sum();

    // Worksheet sub-phase aggregates
    let total_ws_zip: f64 = ok.iter().map(|p| p.timings.ws_zip_decompress_us()).sum();
    let total_ws_parse: f64 = ok.iter().map(|p| p.timings.ws_cell_parse_us()).sum();
    let total_ws_convert: f64 = ok.iter().map(|p| p.timings.ws_cell_convert_us()).sum();
    let total_ws_postprocess: f64 = ok.iter().map(|p| p.timings.ws_postprocess_us()).sum();
    let total_ws_auxiliary: f64 = ok.iter().map(|p| p.timings.ws_auxiliary_us()).sum();
    let total_ws_aux_zip_io: f64 = ok.iter().map(|p| p.timings.ws_aux_zip_io_us()).sum();

    println!("\n{}", "=".repeat(80));
    println!("  CORPUS PROFILING REPORT — Native Rust parse_xlsx_full_native()");
    println!("{}", "=".repeat(80));

    println!("\n  Files: {} parsed, {} errors", ok.len(), errors.len());
    println!("  Total cells: {}", fmt_num(total_cells));
    println!("  Total file size: {}", mb(total_bytes));
    println!("  Wall clock: {:.1}s", overall_ms as f64 / 1000.0);
    println!("  Sum of wall times: {}", fmt_sec(total_wall_us as f64));
    println!("  Sum of instrumented: {}", fmt_sec(total_instrumented));
    if total_wall_us > 0 {
        println!(
            "  Aggregate throughput: {} cells/s",
            fmt_num((total_cells as f64 / total_wall_us as f64 * 1_000_000.0) as u64)
        );
        println!(
            "  Aggregate throughput: {:.1} MB/s",
            total_bytes as f64 / total_wall_us as f64 * 1_000_000.0 / 1024.0 / 1024.0
        );
    }

    println!("\n┌──────────────────────────────────────────────────────────┐");
    println!("│  PHASE BREAKDOWN (aggregate across all files)           │");
    println!("├──────────────────────────────────────────────────────────┤");
    println!(
        "│  ZIP index:         {:>8}   {:>6}  │",
        fmt_sec(total_zip),
        pct(total_zip, total_instrumented)
    );
    println!(
        "│  Shared strings:    {:>8}   {:>6}  │",
        fmt_sec(total_ss),
        pct(total_ss, total_instrumented)
    );
    println!(
        "│  Styles:            {:>8}   {:>6}  │",
        fmt_sec(total_styles),
        pct(total_styles, total_instrumented)
    );
    println!(
        "│  Metadata:          {:>8}   {:>6}  │",
        fmt_sec(total_meta),
        pct(total_meta, total_instrumented)
    );
    println!(
        "│  Worksheets:        {:>8}   {:>6}  │",
        fmt_sec(total_ws),
        pct(total_ws, total_instrumented)
    );
    println!(
        "│  Serde (unused):    {:>8}   {:>6}  │",
        fmt_sec(total_serde),
        pct(total_serde, total_instrumented)
    );
    println!("├──────────────────────────────────────────────────────────┤");
    println!("│  WORKSHEET SUB-PHASES:                                  │");
    println!(
        "│    ZIP decompress:  {:>8}   {:>6}  │",
        fmt_sec(total_ws_zip),
        pct(total_ws_zip, total_ws)
    );
    println!(
        "│    Cell parse:      {:>8}   {:>6}  │",
        fmt_sec(total_ws_parse),
        pct(total_ws_parse, total_ws)
    );
    println!(
        "│    Cell convert:    {:>8}   {:>6}  │",
        fmt_sec(total_ws_convert),
        pct(total_ws_convert, total_ws)
    );
    println!(
        "│    Postprocess:     {:>8}   {:>6}  │",
        fmt_sec(total_ws_postprocess),
        pct(total_ws_postprocess, total_ws)
    );
    println!(
        "│    Auxiliary (XML): {:>8}   {:>6}  │",
        fmt_sec(total_ws_auxiliary),
        pct(total_ws_auxiliary, total_ws)
    );
    println!(
        "│    Aux ZIP I/O:    {:>8}   {:>6}  │",
        fmt_sec(total_ws_aux_zip_io),
        pct(total_ws_aux_zip_io, total_ws)
    );
    println!("├──────────────────────────────────────────────────────────┤");
    println!("│  AUXILIARY PARSER BREAKDOWN:                             │");
    let total_aux_merge: f64 = ok.iter().map(|p| p.timings.ws_aux_merge_us()).sum();
    let total_aux_cond_fmt: f64 = ok.iter().map(|p| p.timings.ws_aux_cond_fmt_us()).sum();
    let total_aux_data_val: f64 = ok.iter().map(|p| p.timings.ws_aux_data_val_us()).sum();
    let total_aux_hyperlinks: f64 = ok.iter().map(|p| p.timings.ws_aux_hyperlinks_us()).sum();
    let total_aux_protection: f64 = ok.iter().map(|p| p.timings.ws_aux_protection_us()).sum();
    let total_aux_print: f64 = ok.iter().map(|p| p.timings.ws_aux_print_us()).sum();
    let total_aux_frozen: f64 = ok.iter().map(|p| p.timings.ws_aux_frozen_pane_us()).sum();
    let total_aux_dims: f64 = ok.iter().map(|p| p.timings.ws_aux_dimensions_us()).sum();
    let total_aux_spark: f64 = ok.iter().map(|p| p.timings.ws_aux_sparklines_us()).sum();
    println!(
        "│      Merges:       {:>8}   {:>6}  │",
        fmt_sec(total_aux_merge),
        pct(total_aux_merge, total_ws_auxiliary)
    );
    println!(
        "│      Cond.Fmt:     {:>8}   {:>6}  │",
        fmt_sec(total_aux_cond_fmt),
        pct(total_aux_cond_fmt, total_ws_auxiliary)
    );
    println!(
        "│      DataValid:    {:>8}   {:>6}  │",
        fmt_sec(total_aux_data_val),
        pct(total_aux_data_val, total_ws_auxiliary)
    );
    println!(
        "│      Hyperlinks:   {:>8}   {:>6}  │",
        fmt_sec(total_aux_hyperlinks),
        pct(total_aux_hyperlinks, total_ws_auxiliary)
    );
    println!(
        "│      Protection:   {:>8}   {:>6}  │",
        fmt_sec(total_aux_protection),
        pct(total_aux_protection, total_ws_auxiliary)
    );
    println!(
        "│      Print:        {:>8}   {:>6}  │",
        fmt_sec(total_aux_print),
        pct(total_aux_print, total_ws_auxiliary)
    );
    println!(
        "│      FrozenPane:   {:>8}   {:>6}  │",
        fmt_sec(total_aux_frozen),
        pct(total_aux_frozen, total_ws_auxiliary)
    );
    println!(
        "│      Dimensions:   {:>8}   {:>6}  │",
        fmt_sec(total_aux_dims),
        pct(total_aux_dims, total_ws_auxiliary)
    );
    println!(
        "│      Sparklines:   {:>8}   {:>6}  │",
        fmt_sec(total_aux_spark),
        pct(total_aux_spark, total_ws_auxiliary)
    );
    println!("└──────────────────────────────────────────────────────────┘");

    // Sort by wall time descending
    let mut by_time: Vec<&FileProfile> = ok.clone();
    by_time.sort_by(|a, b| b.wall_us.cmp(&a.wall_us));

    println!("\n── TOP 15 SLOWEST FILES ──");
    println!(
        "  {:<14} {:>8} {:>10} {:>10} {:>8} {:>8} {:>8} {:>8} {:>12}",
        "Dir", "Size", "Cells", "Wall", "ZIP", "SS", "Styles", "WS", "cells/s"
    );
    for p in by_time.iter().take(15) {
        let t = &p.timings;
        let cps = if p.wall_us > 0 {
            fmt_num((p.cell_count as f64 / p.wall_us as f64 * 1_000_000.0) as u64)
        } else {
            "-".to_string()
        };
        println!(
            "  {:<14} {:>8} {:>10} {:>10} {:>8} {:>8} {:>8} {:>8} {:>12}",
            truncate_dir(&p.dir_name, 14),
            mb(p.size_bytes),
            fmt_num(p.cell_count as u64),
            fmt_ms(p.wall_us as f64),
            fmt_ms(t.zip_index_us()),
            fmt_ms(t.shared_strings_us()),
            fmt_ms(t.styles_us()),
            fmt_ms(t.worksheet_parse_us()),
            cps,
        );
    }

    // Throughput distribution
    let mut throughputs: Vec<f64> = ok
        .iter()
        .filter(|p| p.wall_us > 0 && p.cell_count > 0)
        .map(|p| p.cell_count as f64 / p.wall_us as f64 * 1_000_000.0)
        .collect();
    throughputs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if !throughputs.is_empty() {
        let percentile = |pct: f64| throughputs[(pct * (throughputs.len() - 1) as f64) as usize];
        println!("\n── THROUGHPUT DISTRIBUTION (cells/s) ──");
        println!("  Min:    {}", fmt_num(throughputs[0] as u64));
        println!("  P10:    {}", fmt_num(percentile(0.10) as u64));
        println!("  P25:    {}", fmt_num(percentile(0.25) as u64));
        println!("  Median: {}", fmt_num(percentile(0.50) as u64));
        println!("  P75:    {}", fmt_num(percentile(0.75) as u64));
        println!("  P90:    {}", fmt_num(percentile(0.90) as u64));
        println!(
            "  Max:    {}",
            fmt_num(throughputs[throughputs.len() - 1] as u64)
        );
    }

    // Parse time distribution
    let mut wall_times: Vec<f64> = ok.iter().map(|p| p.wall_us as f64 / 1000.0).collect();
    wall_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if !wall_times.is_empty() {
        let percentile = |pct: f64| wall_times[(pct * (wall_times.len() - 1) as f64) as usize];
        println!("\n── PARSE TIME DISTRIBUTION (ms) ──");
        println!("  Min:    {:.1}ms", wall_times[0]);
        println!("  P10:    {:.1}ms", percentile(0.10));
        println!("  P25:    {:.1}ms", percentile(0.25));
        println!("  Median: {:.1}ms", percentile(0.50));
        println!("  P75:    {:.1}ms", percentile(0.75));
        println!("  P90:    {:.1}ms", percentile(0.90));
        println!("  Max:    {:.1}ms", wall_times[wall_times.len() - 1]);
    }

    // Worksheet-dominated files
    let ws_heavy: Vec<&&FileProfile> = by_time
        .iter()
        .filter(|p| {
            let t = &p.timings;
            t.total_us() > 0.0 && t.worksheet_parse_us() / t.total_us() > 0.5
        })
        .collect();
    if !ws_heavy.is_empty() {
        println!(
            "\n── WORKSHEET PARSING DOMINANT (>50% of instrumented) — {} files ──",
            ws_heavy.len()
        );
        println!(
            "  {:<14} {:>10} {:>8} {:>10} {:>10} {:>8}",
            "Dir", "WS Time", "WS %", "Total", "Cells", "Sheets"
        );
        for p in ws_heavy.iter().take(10) {
            let t = &p.timings;
            println!(
                "  {:<14} {:>10} {:>8} {:>10} {:>10} {:>8}",
                truncate_dir(&p.dir_name, 14),
                fmt_ms(t.worksheet_parse_us()),
                pct(t.worksheet_parse_us(), t.total_us()),
                fmt_ms(p.wall_us as f64),
                fmt_num(p.cell_count as u64),
                p.sheet_count,
            );
        }
    }

    if !errors.is_empty() {
        println!("\n── ERRORS ({} files) ──", errors.len());
        for p in &errors {
            println!(
                "  {}: {}",
                p.dir_name,
                p.error.as_deref().unwrap_or("unknown")
            );
        }
    }

    // Write JSON report
    let mut json = String::new();
    json.push_str("{\n");
    json.push_str(&format!(
        "  \"generated\": \"{:?}\",\n",
        std::time::SystemTime::now()
    ));
    json.push_str(&format!("  \"engine\": \"native_rust\",\n"));
    json.push_str(&format!("  \"files_parsed\": {},\n", ok.len()));
    json.push_str(&format!("  \"errors\": {},\n", errors.len()));
    json.push_str(&format!("  \"total_cells\": {},\n", total_cells));
    json.push_str(&format!("  \"total_bytes\": {},\n", total_bytes));
    json.push_str(&format!("  \"wall_clock_ms\": {},\n", overall_ms));
    json.push_str(&format!("  \"sum_wall_us\": {},\n", total_wall_us));
    json.push_str(&format!(
        "  \"aggregate_cells_per_sec\": {:.0},\n",
        if total_wall_us > 0 {
            total_cells as f64 / total_wall_us as f64 * 1_000_000.0
        } else {
            0.0
        }
    ));
    json.push_str("  \"phase_totals\": {\n");
    json.push_str(&format!("    \"zip_index_us\": {:.0},\n", total_zip));
    json.push_str(&format!("    \"shared_strings_us\": {:.0},\n", total_ss));
    json.push_str(&format!("    \"styles_us\": {:.0},\n", total_styles));
    json.push_str(&format!("    \"metadata_us\": {:.0},\n", total_meta));
    json.push_str(&format!("    \"worksheets_us\": {:.0},\n", total_ws));
    json.push_str(&format!(
        "    \"instrumented_total_us\": {:.0}\n",
        total_instrumented
    ));
    json.push_str("  },\n");
    json.push_str("  \"files\": [\n");
    for (i, p) in by_time.iter().enumerate() {
        let t = &p.timings;
        let comma = if i < by_time.len() - 1 { "," } else { "" };
        json.push_str(&format!(
            "    {{\"dir\":\"{}\",\"size_bytes\":{},\"cells\":{},\"sheets\":{},\"wall_us\":{},\"zip_us\":{:.0},\"ss_us\":{:.0},\"styles_us\":{:.0},\"meta_us\":{:.0},\"ws_us\":{:.0},\"instrumented_us\":{:.0}}}{}\n",
            p.dir_name, p.size_bytes, p.cell_count, p.sheet_count,
            p.wall_us,
            t.zip_index_us(), t.shared_strings_us(), t.styles_us(),
            t.metadata_us(), t.worksheet_parse_us(), t.total_us(),
            comma
        ));
    }
    json.push_str("  ]\n}\n");

    fs::write(&output_path, json.as_bytes()).unwrap_or_else(|e| {
        eprintln!("Failed to write report: {}", e);
    });
    println!("\nJSON report saved to: {}", output_path.display());
}
