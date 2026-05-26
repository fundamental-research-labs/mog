//! XLSX Round-Trip Testing CLI
//!
//! A command-line tool to verify round-trip fidelity of XLSX files.
//!
//! Usage:
//!   xlsx-roundtrip <input.xlsx> [options]
//!
//! Options:
//!   --output <path>    Write the round-tripped file to disk (default: memory only)
//!   --verbose          Show detailed comparison output
//!   --benchmark        Run multiple iterations and report timing
//!   --iterations <n>   Number of benchmark iterations (default: 10)
//!   --ignore-order     Ignore attribute order differences
//!   --help             Show this help message

use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

use xlsx_parser::write::ZipWriter;
use xlsx_parser::zip::XlsxArchive;

// ============================================================================
// CLI Arguments
// ============================================================================

#[derive(Debug)]
struct Args {
    input_path: String,
    output_path: Option<String>,
    verbose: bool,
    benchmark: bool,
    iterations: usize,
    ignore_order: bool,
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
            input_path: args[1].clone(),
            output_path: None,
            verbose: false,
            benchmark: false,
            iterations: 10,
            ignore_order: false,
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
                "--benchmark" | "-b" => {
                    result.benchmark = true;
                    i += 1;
                }
                "--iterations" | "-n" => {
                    if i + 1 >= args.len() {
                        return Err("--iterations requires a number argument".to_string());
                    }
                    result.iterations =
                        args[i + 1].parse().map_err(|_| "Invalid iteration count")?;
                    i += 2;
                }
                "--ignore-order" => {
                    result.ignore_order = true;
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
        r#"XLSX Round-Trip Testing Tool

Usage:
  xlsx-roundtrip <input.xlsx> [options]

Options:
  --output, -o <path>     Write the round-tripped file to disk
  --verbose, -v           Show detailed comparison output
  --benchmark, -b         Run multiple iterations and report timing
  --iterations, -n <n>    Number of benchmark iterations (default: 10)
  --ignore-order          Ignore attribute order differences
  --help, -h              Show this help message

Examples:
  xlsx-roundtrip test.xlsx                     # Basic round-trip test
  xlsx-roundtrip test.xlsx -o output.xlsx      # Save output file
  xlsx-roundtrip test.xlsx -v                  # Verbose comparison
  xlsx-roundtrip test.xlsx -b -n 100           # Benchmark 100 iterations
"#
        .to_string()
    }
}

// ============================================================================
// Comparison Results
// ============================================================================

#[derive(Debug, Default)]
struct ComparisonResult {
    /// Files only in original
    missing_in_output: Vec<String>,
    /// Files only in output
    extra_in_output: Vec<String>,
    /// Files with content differences
    content_differences: Vec<FileDiff>,
    /// Total files compared
    files_compared: usize,
    /// Files that matched exactly
    files_matched: usize,
}

#[derive(Debug)]
struct FileDiff {
    path: String,
    diff_type: DiffType,
    details: String,
}

#[derive(Debug)]
enum DiffType {
    SizeDifference { original: usize, output: usize },
    ContentMismatch,
    XmlStructureDiff,
    AttributeOrderDiff,
}

impl ComparisonResult {
    fn is_success(&self) -> bool {
        self.missing_in_output.is_empty()
            && self.extra_in_output.is_empty()
            && self.content_differences.is_empty()
    }

    fn summary(&self) -> String {
        if self.is_success() {
            format!(
                "✅ Round-trip successful! {}/{} files matched exactly.",
                self.files_matched, self.files_compared
            )
        } else {
            let mut parts = Vec::new();
            if !self.missing_in_output.is_empty() {
                parts.push(format!("{} missing", self.missing_in_output.len()));
            }
            if !self.extra_in_output.is_empty() {
                parts.push(format!("{} extra", self.extra_in_output.len()));
            }
            if !self.content_differences.is_empty() {
                parts.push(format!("{} different", self.content_differences.len()));
            }
            format!(
                "❌ Round-trip differences: {} ({}/{} matched)",
                parts.join(", "),
                self.files_matched,
                self.files_compared
            )
        }
    }
}

// ============================================================================
// Timing Results
// ============================================================================

#[derive(Debug)]
struct TimingResult {
    parse_time: Duration,
    serialize_time: Duration,
    compare_time: Duration,
    total_time: Duration,
    input_size: usize,
    output_size: usize,
}

impl TimingResult {
    fn throughput_mb_per_sec(&self) -> f64 {
        let mb = self.input_size as f64 / (1024.0 * 1024.0);
        let secs = self.total_time.as_secs_f64();
        if secs > 0.0 { mb / secs } else { 0.0 }
    }
}

// ============================================================================
// Round-Trip Engine
// ============================================================================

struct RoundTripEngine {
    verbose: bool,
    ignore_order: bool,
}

impl RoundTripEngine {
    fn new(verbose: bool, ignore_order: bool) -> Self {
        Self {
            verbose,
            ignore_order,
        }
    }

    /// Perform a complete round-trip: parse -> serialize -> compare
    fn round_trip(
        &self,
        input_data: &[u8],
    ) -> Result<(Vec<u8>, ComparisonResult, TimingResult), String> {
        let total_start = Instant::now();
        let input_size = input_data.len();

        // 1. Parse the input XLSX
        let parse_start = Instant::now();
        let archive =
            XlsxArchive::new(input_data).map_err(|e| format!("Failed to parse XLSX: {}", e))?;
        let parse_time = parse_start.elapsed();

        if self.verbose {
            println!(
                "  Parsed {} entries in {:?}",
                archive.entries().len(),
                parse_time
            );
        }

        // 2. Serialize back to XLSX
        let serialize_start = Instant::now();
        let output_data = self.serialize_archive(&archive)?;
        let serialize_time = serialize_start.elapsed();

        if self.verbose {
            println!(
                "  Serialized {} bytes in {:?}",
                output_data.len(),
                serialize_time
            );
        }

        // 3. Compare original vs output
        let compare_start = Instant::now();
        let comparison = self.compare_archives(input_data, &output_data)?;
        let compare_time = compare_start.elapsed();

        let timing = TimingResult {
            parse_time,
            serialize_time,
            compare_time,
            total_time: total_start.elapsed(),
            input_size,
            output_size: output_data.len(),
        };

        Ok((output_data, comparison, timing))
    }

    /// Serialize an archive back to bytes
    fn serialize_archive(&self, archive: &XlsxArchive) -> Result<Vec<u8>, String> {
        let mut writer = ZipWriter::new();

        // Iterate through all entries and copy them
        for entry in archive.entries() {
            let path = &entry.name;
            let data = archive
                .read_file(path)
                .map_err(|e| format!("Failed to read {}: {}", path, e))?;

            writer.add_file(path, data);
        }

        writer
            .finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))
    }

    /// Compare two XLSX archives
    fn compare_archives(&self, original: &[u8], output: &[u8]) -> Result<ComparisonResult, String> {
        let orig_archive =
            XlsxArchive::new(original).map_err(|e| format!("Failed to parse original: {}", e))?;
        let out_archive =
            XlsxArchive::new(output).map_err(|e| format!("Failed to parse output: {}", e))?;

        let mut result = ComparisonResult::default();

        // Collect file paths from both archives
        let orig_paths: HashSet<String> = orig_archive
            .entries()
            .iter()
            .map(|e| e.name.clone())
            .collect();

        let out_paths: HashSet<String> = out_archive
            .entries()
            .iter()
            .map(|e| e.name.clone())
            .collect();

        // Find missing and extra files
        for path in &orig_paths {
            if !out_paths.contains(path) {
                result.missing_in_output.push(path.clone());
            }
        }

        for path in &out_paths {
            if !orig_paths.contains(path) {
                result.extra_in_output.push(path.clone());
            }
        }

        // Compare common files
        for path in orig_paths.intersection(&out_paths) {
            result.files_compared += 1;

            let orig_data = orig_archive.read_file(path).unwrap_or_default();
            let out_data = out_archive.read_file(path).unwrap_or_default();

            if orig_data == out_data {
                result.files_matched += 1;
                continue;
            }

            // Files differ - analyze the difference
            let diff = self.analyze_difference(path, &orig_data, &out_data);

            // If ignoring order and it's just an order difference, count as match
            if self.ignore_order {
                if let DiffType::AttributeOrderDiff = diff.diff_type {
                    result.files_matched += 1;
                    continue;
                }
            }

            result.content_differences.push(diff);
        }

        Ok(result)
    }

    /// Analyze the difference between two file contents
    fn analyze_difference(&self, path: &str, original: &[u8], output: &[u8]) -> FileDiff {
        // Size difference
        if original.len() != output.len() {
            return FileDiff {
                path: path.to_string(),
                diff_type: DiffType::SizeDifference {
                    original: original.len(),
                    output: output.len(),
                },
                details: format!(
                    "Size: {} -> {} ({:+} bytes)",
                    original.len(),
                    output.len(),
                    output.len() as i64 - original.len() as i64
                ),
            };
        }

        // For XML files, try to do semantic comparison
        if path.ends_with(".xml") || path.ends_with(".rels") {
            if let (Ok(orig_str), Ok(out_str)) =
                (std::str::from_utf8(original), std::str::from_utf8(output))
            {
                // Check if it's just whitespace/formatting differences
                let orig_normalized = self.normalize_xml(orig_str);
                let out_normalized = self.normalize_xml(out_str);

                if orig_normalized == out_normalized {
                    return FileDiff {
                        path: path.to_string(),
                        diff_type: DiffType::AttributeOrderDiff,
                        details: "Only whitespace/formatting differences".to_string(),
                    };
                }

                // Find first difference
                let first_diff = self.find_first_difference(orig_str, out_str);

                return FileDiff {
                    path: path.to_string(),
                    diff_type: DiffType::XmlStructureDiff,
                    details: first_diff,
                };
            }
        }

        // Binary content mismatch
        FileDiff {
            path: path.to_string(),
            diff_type: DiffType::ContentMismatch,
            details: "Binary content differs".to_string(),
        }
    }

    /// Normalize XML for comparison (remove formatting differences)
    fn normalize_xml(&self, xml: &str) -> String {
        // Simple normalization: remove extra whitespace between tags
        let mut result = String::with_capacity(xml.len());
        let mut in_tag = false;
        let mut last_was_space = false;

        for c in xml.chars() {
            match c {
                '<' => {
                    in_tag = true;
                    last_was_space = false;
                    result.push(c);
                }
                '>' => {
                    in_tag = false;
                    last_was_space = false;
                    result.push(c);
                }
                ' ' | '\t' | '\n' | '\r' => {
                    if in_tag {
                        if !last_was_space {
                            result.push(' ');
                            last_was_space = true;
                        }
                    }
                    // Skip whitespace between tags
                }
                _ => {
                    last_was_space = false;
                    result.push(c);
                }
            }
        }

        result
    }

    /// Find the first difference between two strings
    fn find_first_difference(&self, a: &str, b: &str) -> String {
        let a_chars: Vec<char> = a.chars().collect();
        let b_chars: Vec<char> = b.chars().collect();

        for (i, (ca, cb)) in a_chars.iter().zip(b_chars.iter()).enumerate() {
            if ca != cb {
                let context_start = i.saturating_sub(20);
                let context_end = (i + 20).min(a_chars.len()).min(b_chars.len());

                let orig_context: String = a_chars[context_start..context_end].iter().collect();
                let out_context: String = b_chars[context_start..context_end].iter().collect();

                return format!(
                    "Difference at position {}:\n  Original: ...{}...\n  Output:   ...{}...",
                    i, orig_context, out_context
                );
            }
        }

        if a_chars.len() != b_chars.len() {
            format!(
                "Length difference: {} vs {} characters",
                a_chars.len(),
                b_chars.len()
            )
        } else {
            "Unknown difference".to_string()
        }
    }
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

    // Read input file
    let input_path = Path::new(&args.input_path);
    if !input_path.exists() {
        eprintln!("Error: File not found: {}", args.input_path);
        std::process::exit(1);
    }

    let input_data = match fs::read(input_path) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Error reading file: {}", e);
            std::process::exit(1);
        }
    };

    println!("📄 Input: {} ({} bytes)", args.input_path, input_data.len());

    let engine = RoundTripEngine::new(args.verbose, args.ignore_order);

    if args.benchmark {
        // Benchmark mode
        run_benchmark(&engine, &input_data, args.iterations);
    } else {
        // Single run mode
        match engine.round_trip(&input_data) {
            Ok((output_data, comparison, timing)) => {
                // Print timing
                println!("\n⏱️  Timing:");
                println!("  Parse:     {:?}", timing.parse_time);
                println!("  Serialize: {:?}", timing.serialize_time);
                println!("  Compare:   {:?}", timing.compare_time);
                println!("  Total:     {:?}", timing.total_time);
                println!("  Throughput: {:.2} MB/s", timing.throughput_mb_per_sec());

                // Print comparison result
                println!("\n📊 Comparison:");
                println!("  {}", comparison.summary());

                if args.verbose && !comparison.is_success() {
                    println!("\n  Details:");
                    for path in &comparison.missing_in_output {
                        println!("    ❌ Missing: {}", path);
                    }
                    for path in &comparison.extra_in_output {
                        println!("    ➕ Extra: {}", path);
                    }
                    for diff in &comparison.content_differences {
                        println!("    ⚠️  {}: {}", diff.path, diff.details);
                    }
                }

                // Write output if requested
                if let Some(output_path) = args.output_path {
                    match fs::write(&output_path, &output_data) {
                        Ok(_) => println!("\n💾 Output written to: {}", output_path),
                        Err(e) => eprintln!("\n❌ Failed to write output: {}", e),
                    }
                }

                // Exit with appropriate code
                if comparison.is_success() {
                    std::process::exit(0);
                } else {
                    std::process::exit(1);
                }
            }
            Err(e) => {
                eprintln!("❌ Error: {}", e);
                std::process::exit(1);
            }
        }
    }
}

fn run_benchmark(engine: &RoundTripEngine, input_data: &[u8], iterations: usize) {
    println!("\n🏃 Running {} iterations...", iterations);

    let mut parse_times = Vec::with_capacity(iterations);
    let mut serialize_times = Vec::with_capacity(iterations);
    let mut total_times = Vec::with_capacity(iterations);

    for i in 0..iterations {
        match engine.round_trip(input_data) {
            Ok((_, _, timing)) => {
                parse_times.push(timing.parse_time);
                serialize_times.push(timing.serialize_time);
                total_times.push(timing.total_time);

                if (i + 1) % 10 == 0 {
                    print!(".");
                    std::io::stdout().flush().unwrap();
                }
            }
            Err(e) => {
                eprintln!("\n❌ Error on iteration {}: {}", i + 1, e);
                std::process::exit(1);
            }
        }
    }

    println!("\n\n📈 Benchmark Results ({} iterations):", iterations);
    println!("  Parse:");
    print_stats("    ", &parse_times);
    println!("  Serialize:");
    print_stats("    ", &serialize_times);
    println!("  Total:");
    print_stats("    ", &total_times);

    // Throughput
    let avg_total = total_times.iter().sum::<Duration>() / iterations as u32;
    let mb = input_data.len() as f64 / (1024.0 * 1024.0);
    let throughput = mb / avg_total.as_secs_f64();
    println!("\n  Average throughput: {:.2} MB/s", throughput);
}

fn print_stats(prefix: &str, times: &[Duration]) {
    let mut sorted = times.to_vec();
    sorted.sort();

    let min = sorted.first().unwrap();
    let max = sorted.last().unwrap();
    let sum: Duration = sorted.iter().sum();
    let avg = sum / sorted.len() as u32;
    let p50 = sorted[sorted.len() / 2];
    let p95 = sorted[(sorted.len() as f64 * 0.95) as usize];
    let p99 = sorted[((sorted.len() as f64 * 0.99) as usize).min(sorted.len() - 1)];

    println!("{}Min: {:?}, Max: {:?}, Avg: {:?}", prefix, min, max, avg);
    println!("{}P50: {:?}, P95: {:?}, P99: {:?}", prefix, p50, p95, p99);
}
