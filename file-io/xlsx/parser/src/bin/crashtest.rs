//! XLSX Corpus Crash-Test CLI
//!
//! A command-line tool that runs the full parse pipeline against every XLSX file
//! in a corpus directory, catches panics, and produces a feature fingerprint +
//! diversity report.
//!
//! Usage:
//!   xlsx-crashtest <corpus-dir> [options]
//!
//! Options:
//!   --output <path>, -o <path>   JSON report output path (default: {corpus_dir}/crashtest-report.json)
//!   --verbose, -v                Print detailed per-file info
//!   --help, -h                   Show this help message
//!
//! Note: To catch panics, build with panic=unwind (the default release profile
//! uses panic=abort). Use: cargo run --profile crashtest --bin xlsx-crashtest --features cli
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use xlsx_parser::output::results::{
    CELL_TYPE_VAL_BOOL, CELL_TYPE_VAL_EMPTY, CELL_TYPE_VAL_ERROR, CELL_TYPE_VAL_FORMULA,
    CELL_TYPE_VAL_NUMBER, CELL_TYPE_VAL_STRING, FullParseResult,
};
use xlsx_parser::pipeline::full_parse::parse_xlsx_full_native;
use xlsx_test_contracts::{
    CorrectnessFingerprintCategory, FailureFingerprint, FingerprintCategory, FingerprintEvidence,
    FingerprintOwner, FingerprintSeverity,
};

// ============================================================================
// CLI Arguments
// ============================================================================

#[derive(Debug)]
struct Args {
    corpus_dir: String,
    output_path: Option<String>,
    verbose: bool,
}

impl Args {
    fn parse() -> Result<Self, String> {
        let args: Vec<String> = env::args().collect();

        if args.len() < 2 {
            return Err(Self::usage());
        }

        if args[1] == "--help" || args[1] == "-h" {
            return Err(Self::usage());
        }

        let mut result = Args {
            corpus_dir: args[1].clone(),
            output_path: None,
            verbose: false,
        };

        let mut i = 2;
        while i < args.len() {
            match args[i].as_str() {
                "--output" | "-o" => {
                    if i + 1 >= args.len() {
                        return Err("--output requires a path argument".to_string());
                    }
                    result.output_path = Some(args[i + 1].clone());
                    i += 2;
                }
                "--verbose" | "-v" => {
                    result.verbose = true;
                    i += 1;
                }
                other => {
                    return Err(format!("Unknown option: {}", other));
                }
            }
        }

        Ok(result)
    }

    fn usage() -> String {
        r#"XLSX Corpus Crash-Test Tool

Usage:
  xlsx-crashtest <corpus-dir> [options]

Options:
  --output, -o <path>   JSON report output path (default: {corpus_dir}/crashtest-report.json)
  --verbose, -v         Print detailed per-file info
  --help, -h            Show this help message

Examples:
  xlsx-crashtest ./corpus                        # Test all files in corpus/
  xlsx-crashtest ./corpus -o report.json         # Custom output path
  xlsx-crashtest ./corpus -v                     # Verbose per-file output
"#
        .to_string()
    }
}

// ============================================================================
// Result Categories
// ============================================================================

enum ParseOutcome {
    Pass(FullParseResult),
    Error(String),
    Panic(String),
}

struct FileResult {
    relative_path: String,
    size_bytes: u64,
    parse_time_us: u64,
    outcome: ParseOutcome,
}

// ============================================================================
// FileFingerprint
// ============================================================================

struct FileFingerprint {
    // File info
    path: String,
    size_bytes: u64,
    parse_time_us: u64,

    // Counts
    cell_count: u32,
    sheet_count: u32,
    shared_string_count: usize,
    defined_name_count: usize,

    // Cell type distribution
    empty_cells: u32,
    number_cells: u32,
    string_cells: u32,
    bool_cells: u32,
    error_cells: u32,
    formula_cells: u32,

    // Per-sheet features (summed across sheets)
    merge_count: usize,
    cf_count: usize,
    dv_count: usize,
    hyperlink_count: usize,
    comment_count: usize,
    table_count: usize,
    sparkline_count: usize,

    // Boolean flags
    has_theme: bool,
    has_frozen_panes: bool,
    has_sheet_protection: bool,
    has_workbook_protection: bool,
    has_print_settings: bool,

    // Diversity score
    diversity_score: u32,
}

fn build_fingerprint(
    relative_path: &str,
    size_bytes: u64,
    parse_time_us: u64,
    result: &FullParseResult,
) -> FileFingerprint {
    let mut empty_cells: u32 = 0;
    let mut number_cells: u32 = 0;
    let mut string_cells: u32 = 0;
    let mut bool_cells: u32 = 0;
    let mut error_cells: u32 = 0;
    let mut formula_cells: u32 = 0;

    let mut merge_count: usize = 0;
    let mut cf_count: usize = 0;
    let mut dv_count: usize = 0;
    let mut hyperlink_count: usize = 0;
    let mut comment_count: usize = 0;
    let mut table_count: usize = 0;
    let mut sparkline_count: usize = 0;

    let mut has_frozen_panes = false;
    let mut has_sheet_protection = false;
    let mut has_print_settings = false;

    for sheet in &result.sheets {
        for cell in &sheet.cells {
            match cell.cell_type {
                CELL_TYPE_VAL_EMPTY => empty_cells += 1,
                CELL_TYPE_VAL_NUMBER => number_cells += 1,
                CELL_TYPE_VAL_STRING => string_cells += 1,
                CELL_TYPE_VAL_BOOL => bool_cells += 1,
                CELL_TYPE_VAL_ERROR => error_cells += 1,
                CELL_TYPE_VAL_FORMULA => formula_cells += 1,
                _ => empty_cells += 1,
            }
        }

        merge_count += sheet.merges.len();
        cf_count += sheet.conditional_formats.len();
        dv_count += sheet.data_validations.len();
        hyperlink_count += sheet.hyperlinks.len();
        comment_count += sheet.comments.len();
        table_count += sheet.tables.len();
        sparkline_count += sheet.sparklines.len();

        if sheet.frozen_pane.is_some() {
            has_frozen_panes = true;
        }
        if sheet.protection.is_some() {
            has_sheet_protection = true;
        }
        if sheet.print_settings.is_some() {
            has_print_settings = true;
        }
    }

    let mut fp = FileFingerprint {
        path: relative_path.to_string(),
        size_bytes,
        parse_time_us,
        cell_count: result.stats.total_cells,
        sheet_count: result.stats.total_sheets,
        shared_string_count: result.shared_strings.len(),
        defined_name_count: result.defined_names.len(),
        empty_cells,
        number_cells,
        string_cells,
        bool_cells,
        error_cells,
        formula_cells,
        merge_count,
        cf_count,
        dv_count,
        hyperlink_count,
        comment_count,
        table_count,
        sparkline_count,
        has_theme: result.theme_color_scheme.is_some(),
        has_frozen_panes,
        has_sheet_protection,
        has_workbook_protection: result.workbook_protection.is_some(),
        has_print_settings,
        diversity_score: 0,
    };

    fp.diversity_score = compute_diversity_score(&fp);
    fp
}

fn compute_diversity_score(fp: &FileFingerprint) -> u32 {
    let mut score = 0u32;
    // Common (x1)
    if fp.cell_count > 0 {
        score += 1;
    }
    if fp.shared_string_count > 0 {
        score += 1;
    }
    if fp.merge_count > 0 {
        score += 1;
    }
    // Uncommon (x2)
    if fp.formula_cells > 0 {
        score += 2;
    }
    if fp.cf_count > 0 {
        score += 2;
    }
    if fp.dv_count > 0 {
        score += 2;
    }
    if fp.hyperlink_count > 0 {
        score += 2;
    }
    if fp.has_frozen_panes {
        score += 2;
    }
    // Rare (x3)
    if fp.sparkline_count > 0 {
        score += 3;
    }
    if fp.table_count > 0 {
        score += 3;
    }
    if fp.comment_count > 0 {
        score += 3;
    }
    if fp.has_sheet_protection || fp.has_workbook_protection {
        score += 3;
    }
    if fp.has_print_settings {
        score += 3;
    }
    if fp.defined_name_count > 0 {
        score += 3;
    }
    if fp.has_theme {
        score += 3;
    }
    score
}

// ============================================================================
// Directory Walking
// ============================================================================

fn find_xlsx_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_xlsx_recursive(dir, &mut files);
    files.sort();
    files
}

fn collect_xlsx_recursive(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if path.is_dir() {
            collect_xlsx_recursive(&path, files);
        } else if let Some(ext) = path.extension() {
            if ext.eq_ignore_ascii_case("xlsx") {
                files.push(path);
            }
        }
    }
}

// ============================================================================
// Number Formatting Helper
// ============================================================================

fn format_number(n: u64) -> String {
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

fn format_number_u32(n: u32) -> String {
    format_number(n as u64)
}

#[allow(dead_code)]
fn format_number_usize(n: usize) -> String {
    format_number(n as u64)
}

// ============================================================================
// Console Report
// ============================================================================

fn print_report(results: &[FileResult], fingerprints: &[FileFingerprint], total_time_ms: u64) {
    let pass_count = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Pass(_)))
        .count();
    let error_count = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Error(_)))
        .count();
    let panic_count = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Panic(_)))
        .count();
    let total_cells: u64 = fingerprints.iter().map(|fp| fp.cell_count as u64).sum();

    let avg_ms = if pass_count > 0 {
        total_time_ms as f64 / pass_count as f64
    } else {
        0.0
    };

    println!();
    println!("===================================================");
    println!("CORPUS CRASH-TEST RESULTS");
    println!("===================================================");
    println!();
    println!(
        "Files:    {} total, {} pass, {} error, {} panic",
        results.len(),
        pass_count,
        error_count,
        panic_count
    );
    println!(
        "Cells:    {} total across {} files",
        format_number(total_cells),
        pass_count
    );
    println!(
        "Time:     {:.1}s total ({:.0}ms avg per file)",
        total_time_ms as f64 / 1000.0,
        avg_ms
    );

    // Feature coverage
    if !fingerprints.is_empty() {
        let total = fingerprints.len();
        println!();
        println!("Feature Coverage (across {} passing files):", total);

        let features: Vec<(&str, usize)> = vec![
            (
                "formulas",
                fingerprints
                    .iter()
                    .filter(|fp| fp.formula_cells > 0)
                    .count(),
            ),
            (
                "merges",
                fingerprints.iter().filter(|fp| fp.merge_count > 0).count(),
            ),
            (
                "conditional_format",
                fingerprints.iter().filter(|fp| fp.cf_count > 0).count(),
            ),
            (
                "data_validations",
                fingerprints.iter().filter(|fp| fp.dv_count > 0).count(),
            ),
            (
                "hyperlinks",
                fingerprints
                    .iter()
                    .filter(|fp| fp.hyperlink_count > 0)
                    .count(),
            ),
            (
                "comments",
                fingerprints
                    .iter()
                    .filter(|fp| fp.comment_count > 0)
                    .count(),
            ),
            (
                "tables",
                fingerprints.iter().filter(|fp| fp.table_count > 0).count(),
            ),
            (
                "sparklines",
                fingerprints
                    .iter()
                    .filter(|fp| fp.sparkline_count > 0)
                    .count(),
            ),
            (
                "frozen_panes",
                fingerprints.iter().filter(|fp| fp.has_frozen_panes).count(),
            ),
            (
                "sheet_protection",
                fingerprints
                    .iter()
                    .filter(|fp| fp.has_sheet_protection)
                    .count(),
            ),
            (
                "workbook_protection",
                fingerprints
                    .iter()
                    .filter(|fp| fp.has_workbook_protection)
                    .count(),
            ),
            (
                "print_settings",
                fingerprints
                    .iter()
                    .filter(|fp| fp.has_print_settings)
                    .count(),
            ),
            (
                "defined_names",
                fingerprints
                    .iter()
                    .filter(|fp| fp.defined_name_count > 0)
                    .count(),
            ),
            (
                "themes",
                fingerprints.iter().filter(|fp| fp.has_theme).count(),
            ),
        ];

        for (name, count) in &features {
            let pct = if total > 0 {
                *count as f64 / total as f64 * 100.0
            } else {
                0.0
            };
            println!("  {:<21} {:>3}/{} ({:.0}%)", name, count, total, pct);
        }

        // Top 10 by diversity
        let mut sorted_fps: Vec<&FileFingerprint> = fingerprints.iter().collect();
        sorted_fps.sort_by(|a, b| b.diversity_score.cmp(&a.diversity_score));

        println!();
        let top_n = sorted_fps.len().min(10);
        println!("Top {} by diversity:", top_n);
        for (i, fp) in sorted_fps.iter().take(top_n).enumerate() {
            println!(
                "  {:>2}. {:<40} score={:<3} (cells={}, sheets={})",
                i + 1,
                fp.path,
                fp.diversity_score,
                format_number_u32(fp.cell_count),
                fp.sheet_count
            );
        }
    }

    // Errors
    let errors: Vec<&FileResult> = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Error(_)))
        .collect();
    if !errors.is_empty() {
        println!();
        println!("Errors ({}):", errors.len());
        for r in &errors {
            if let ParseOutcome::Error(ref msg) = r.outcome {
                println!("  {}: {}", r.relative_path, msg);
            }
        }
    }

    // Panics
    let panics: Vec<&FileResult> = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Panic(_)))
        .collect();
    if !panics.is_empty() {
        println!();
        println!("Panics ({}):", panics.len());
        for r in &panics {
            if let ParseOutcome::Panic(ref msg) = r.outcome {
                println!("  {}: {}", r.relative_path, msg);
            }
        }
    }
}

// ============================================================================
// JSON Report
// ============================================================================

fn escape_json(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            c if c.is_control() => {
                result.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => result.push(c),
        }
    }
    result
}

fn fingerprint_to_json(fp: &FileFingerprint) -> String {
    format!(
        concat!(
            "{{",
            "\"path\":\"{}\",",
            "\"size_bytes\":{},",
            "\"parse_time_us\":{},",
            "\"cell_count\":{},",
            "\"sheet_count\":{},",
            "\"shared_string_count\":{},",
            "\"defined_name_count\":{},",
            "\"empty_cells\":{},",
            "\"number_cells\":{},",
            "\"string_cells\":{},",
            "\"bool_cells\":{},",
            "\"error_cells\":{},",
            "\"formula_cells\":{},",
            "\"merge_count\":{},",
            "\"cf_count\":{},",
            "\"dv_count\":{},",
            "\"hyperlink_count\":{},",
            "\"comment_count\":{},",
            "\"table_count\":{},",
            "\"sparkline_count\":{},",
            "\"has_theme\":{},",
            "\"has_frozen_panes\":{},",
            "\"has_sheet_protection\":{},",
            "\"has_workbook_protection\":{},",
            "\"has_print_settings\":{},",
            "\"diversity_score\":{}",
            "}}"
        ),
        escape_json(&fp.path),
        fp.size_bytes,
        fp.parse_time_us,
        fp.cell_count,
        fp.sheet_count,
        fp.shared_string_count,
        fp.defined_name_count,
        fp.empty_cells,
        fp.number_cells,
        fp.string_cells,
        fp.bool_cells,
        fp.error_cells,
        fp.formula_cells,
        fp.merge_count,
        fp.cf_count,
        fp.dv_count,
        fp.hyperlink_count,
        fp.comment_count,
        fp.table_count,
        fp.sparkline_count,
        fp.has_theme,
        fp.has_frozen_panes,
        fp.has_sheet_protection,
        fp.has_workbook_protection,
        fp.has_print_settings,
        fp.diversity_score,
    )
}

fn failure_fingerprint_to_json(status: &str, path: &str, message: &str) -> String {
    let (id, category, summary) = match status {
        "panic" => (
            "corpus-parser-panic",
            CorrectnessFingerprintCategory::HarnessBug,
            "corpus parse panicked",
        ),
        _ => (
            "corpus-parser-error",
            CorrectnessFingerprintCategory::UnsupportedFeaturePolicy,
            "corpus parse returned an error",
        ),
    };
    let fingerprint = FailureFingerprint::new(
        id,
        FingerprintCategory::Correctness(category),
        FingerprintSeverity::Error,
        FingerprintOwner::Corpus,
        summary,
    )
    .with_evidence(FingerprintEvidence::message(message).at_path(path));
    serde_json::to_string(&fingerprint).expect("failure fingerprint should serialize")
}

fn write_json_report(
    output_path: &Path,
    results: &[FileResult],
    fingerprints: &[FileFingerprint],
    total_time_ms: u64,
) -> Result<(), String> {
    let pass_count = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Pass(_)))
        .count();
    let error_count = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Error(_)))
        .count();
    let panic_count = results
        .iter()
        .filter(|r| matches!(r.outcome, ParseOutcome::Panic(_)))
        .count();
    let total_cells: u64 = fingerprints.iter().map(|fp| fp.cell_count as u64).sum();

    // Build fingerprint lookup by path for sorting
    let mut fp_map: std::collections::HashMap<&str, &FileFingerprint> =
        std::collections::HashMap::new();
    for fp in fingerprints {
        fp_map.insert(&fp.path, fp);
    }

    // Build file entries: pass files sorted by diversity descending, then errors, then panics
    let mut pass_entries: Vec<String> = Vec::new();
    let mut error_entries: Vec<String> = Vec::new();
    let mut panic_entries: Vec<String> = Vec::new();

    // Collect pass results with their fingerprints for sorting
    let mut pass_results_with_fp: Vec<(&FileResult, &FileFingerprint)> = Vec::new();
    for r in results {
        if let ParseOutcome::Pass(_) = &r.outcome {
            if let Some(fp) = fp_map.get(r.relative_path.as_str()) {
                pass_results_with_fp.push((r, fp));
            }
        }
    }
    pass_results_with_fp.sort_by(|a, b| b.1.diversity_score.cmp(&a.1.diversity_score));

    for (r, fp) in &pass_results_with_fp {
        pass_entries.push(format!(
            "{{\"path\":\"{}\",\"status\":\"pass\",\"fingerprint\":{}}}",
            escape_json(&r.relative_path),
            fingerprint_to_json(fp)
        ));
    }

    for r in results {
        match &r.outcome {
            ParseOutcome::Error(msg) => {
                let failure_fingerprint =
                    failure_fingerprint_to_json("error", &r.relative_path, msg);
                error_entries.push(format!(
                    "{{\"path\":\"{}\",\"status\":\"error\",\"error\":\"{}\",\"failure_fingerprints\":[{}]}}",
                    escape_json(&r.relative_path),
                    escape_json(msg),
                    failure_fingerprint
                ));
            }
            ParseOutcome::Panic(msg) => {
                let failure_fingerprint =
                    failure_fingerprint_to_json("panic", &r.relative_path, msg);
                panic_entries.push(format!(
                    "{{\"path\":\"{}\",\"status\":\"panic\",\"error\":\"{}\",\"failure_fingerprints\":[{}]}}",
                    escape_json(&r.relative_path),
                    escape_json(msg),
                    failure_fingerprint
                ));
            }
            ParseOutcome::Pass(_) => {}
        }
    }

    let mut all_entries = Vec::new();
    all_entries.extend(pass_entries);
    all_entries.extend(error_entries);
    all_entries.extend(panic_entries);

    let files_json = all_entries.join(",\n    ");

    let json = format!(
        concat!(
            "{{\n",
            "  \"summary\": {{\n",
            "    \"total_files\": {},\n",
            "    \"pass\": {},\n",
            "    \"error\": {},\n",
            "    \"panic\": {},\n",
            "    \"total_cells\": {},\n",
            "    \"total_time_ms\": {}\n",
            "  }},\n",
            "  \"files\": [\n",
            "    {}\n",
            "  ]\n",
            "}}\n"
        ),
        results.len(),
        pass_count,
        error_count,
        panic_count,
        total_cells,
        total_time_ms,
        files_json
    );

    fs::write(output_path, json.as_bytes())
        .map_err(|e| format!("Failed to write report to {}: {}", output_path.display(), e))?;

    Ok(())
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    let args = match Args::parse() {
        Ok(args) => args,
        Err(msg) => {
            eprintln!("{}", msg);
            std::process::exit(1);
        }
    };

    // Validate corpus directory
    let corpus_dir = Path::new(&args.corpus_dir);
    if !corpus_dir.is_dir() {
        eprintln!("Error: Not a directory: {}", corpus_dir.display());
        std::process::exit(1);
    }

    let corpus_dir = match corpus_dir.canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Error: Cannot resolve directory {}: {}", args.corpus_dir, e);
            std::process::exit(1);
        }
    };

    // Determine output path
    let output_path = match args.output_path {
        Some(ref p) => PathBuf::from(p),
        None => corpus_dir.join("crashtest-report.json"),
    };

    // Find all XLSX files
    let xlsx_files = find_xlsx_files(&corpus_dir);
    if xlsx_files.is_empty() {
        eprintln!("No .xlsx files found under {}", corpus_dir.display());
        std::process::exit(1);
    }

    let total_files = xlsx_files.len();
    println!(
        "Found {} XLSX files in {}",
        total_files,
        corpus_dir.display()
    );
    println!();

    // Process each file
    let mut results: Vec<FileResult> = Vec::with_capacity(total_files);
    let mut fingerprints: Vec<FileFingerprint> = Vec::new();
    let overall_start = Instant::now();

    for (idx, file_path) in xlsx_files.iter().enumerate() {
        let relative_path = file_path
            .strip_prefix(&corpus_dir)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        // Read file
        let data = match fs::read(file_path) {
            Ok(d) => d,
            Err(e) => {
                let msg = format!("Failed to read file: {}", e);
                println!(
                    "[{:>3}/{}] ERROR {}:  {}",
                    idx + 1,
                    total_files,
                    relative_path,
                    msg
                );
                results.push(FileResult {
                    relative_path,
                    size_bytes: 0,
                    parse_time_us: 0,
                    outcome: ParseOutcome::Error(msg),
                });
                continue;
            }
        };

        let size_bytes = data.len() as u64;

        // Parse with panic catching
        let start = Instant::now();
        let parse_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            parse_xlsx_full_native(&data, None)
        }));
        let elapsed = start.elapsed();
        let parse_time_us = elapsed.as_micros() as u64;

        match parse_result {
            Ok(Ok(full_result)) => {
                let cells = full_result.stats.total_cells;
                let sheets = full_result.stats.total_sheets;
                let time_ms = elapsed.as_secs_f64() * 1000.0;

                println!(
                    "[{:>3}/{}] PASS  {} ({} cells, {} sheets, {:.1}ms)",
                    idx + 1,
                    total_files,
                    relative_path,
                    format_number_u32(cells),
                    sheets,
                    time_ms,
                );

                if args.verbose {
                    let fp_preview =
                        build_fingerprint(&relative_path, size_bytes, parse_time_us, &full_result);
                    println!(
                        "         diversity={} formulas={} merges={} cf={} dv={} hyperlinks={} comments={} tables={} sparklines={}",
                        fp_preview.diversity_score,
                        fp_preview.formula_cells,
                        fp_preview.merge_count,
                        fp_preview.cf_count,
                        fp_preview.dv_count,
                        fp_preview.hyperlink_count,
                        fp_preview.comment_count,
                        fp_preview.table_count,
                        fp_preview.sparkline_count,
                    );
                }

                let fp = build_fingerprint(&relative_path, size_bytes, parse_time_us, &full_result);
                fingerprints.push(fp);

                results.push(FileResult {
                    relative_path,
                    size_bytes,
                    parse_time_us,
                    outcome: ParseOutcome::Pass(full_result),
                });
            }
            Ok(Err(err_msg)) => {
                println!(
                    "[{:>3}/{}] ERROR {}: {}",
                    idx + 1,
                    total_files,
                    relative_path,
                    err_msg,
                );
                results.push(FileResult {
                    relative_path,
                    size_bytes,
                    parse_time_us,
                    outcome: ParseOutcome::Error(err_msg),
                });
            }
            Err(panic_info) => {
                // Extract panic message
                let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };

                println!(
                    "[{:>3}/{}] PANIC {}: {}",
                    idx + 1,
                    total_files,
                    relative_path,
                    panic_msg,
                );
                results.push(FileResult {
                    relative_path,
                    size_bytes,
                    parse_time_us,
                    outcome: ParseOutcome::Panic(panic_msg),
                });
            }
        }

        // Flush stdout so progress is visible in real-time
        let _ = std::io::stdout().flush();
    }

    let total_time_ms = overall_start.elapsed().as_millis() as u64;

    // Print console report
    print_report(&results, &fingerprints, total_time_ms);

    // Write JSON report
    match write_json_report(&output_path, &results, &fingerprints, total_time_ms) {
        Ok(()) => {
            println!();
            println!("Report written to: {}", output_path.display());
        }
        Err(e) => {
            eprintln!();
            eprintln!("Failed to write JSON report: {}", e);
            std::process::exit(1);
        }
    }
}
