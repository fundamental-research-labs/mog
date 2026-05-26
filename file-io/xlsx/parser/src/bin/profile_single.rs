//! Profile a single XLSX file with per-phase timing.
//!
//! Usage: cargo run -p xlsx-parser --bin profile_single -- <path-to-xlsx>

use std::env;
use std::fs;
use std::time::Instant;

use xlsx_parser::output::results::ParseTimings;
use xlsx_parser::pipeline::full_parse::parse_xlsx_full_native;

fn main() {
    let args: Vec<String> = env::args().collect();
    let path = args.get(1).expect("Usage: profile_single <path-to-xlsx>");

    let data = fs::read(path).expect("Failed to read file");
    println!("File: {} ({:.1} MB)", path, data.len() as f64 / 1_048_576.0);

    let mut timings = ParseTimings::zero();
    let start = Instant::now();
    let result = parse_xlsx_full_native(&data, Some(&mut timings));
    let wall = start.elapsed();

    match result {
        Ok(output) => {
            let total_cells: u32 = output.sheets.iter().map(|s| s.cells.len() as u32).sum();
            let sheets = output.sheets.len();
            println!("Sheets: {}, Cells: {}", sheets, total_cells);
            println!("Wall time: {:.1}ms\n", wall.as_secs_f64() * 1000.0);
            println!("Top-level phases:");
            println!(
                "  ZIP index:         {:>8.1}ms",
                timings.zip_index_us() / 1000.0
            );
            println!(
                "  Shared strings:    {:>8.1}ms",
                timings.shared_strings_us() / 1000.0
            );
            println!(
                "  Styles:            {:>8.1}ms",
                timings.styles_us() / 1000.0
            );
            println!(
                "  Metadata:          {:>8.1}ms",
                timings.metadata_us() / 1000.0
            );
            println!(
                "  Worksheets:        {:>8.1}ms",
                timings.worksheet_parse_us() / 1000.0
            );
            println!(
                "  Serde serialize:   {:>8.1}ms",
                timings.serde_serialize_us() / 1000.0
            );
            println!(
                "  Total reported:    {:>8.1}ms",
                timings.total_us() / 1000.0
            );
            println!("\nShared strings sub-phases:");
            println!(
                "  SS ZIP decompress: {:>8.1}ms",
                timings.ss_zip_us() / 1000.0
            );
            println!(
                "  SS parse refs:     {:>8.1}ms",
                timings.ss_parse_refs_us() / 1000.0
            );
            println!(
                "  SS materialize:    {:>8.1}ms",
                timings.ss_materialize_us() / 1000.0
            );
            println!("  SS xml bytes:      {:>8.0}", timings.ss_xml_bytes());
            println!("\nWorksheet sub-phases:");
            println!(
                "  WS decompress:     {:>8.1}ms",
                timings.ws_zip_decompress_us() / 1000.0
            );
            println!(
                "  WS cell parse:     {:>8.1}ms",
                timings.ws_cell_parse_us() / 1000.0
            );
            println!(
                "  WS cell convert:   {:>8.1}ms",
                timings.ws_cell_convert_us() / 1000.0
            );
            println!(
                "  WS postprocess:    {:>8.1}ms",
                timings.ws_postprocess_us() / 1000.0
            );
            println!(
                "  WS auxiliary:      {:>8.1}ms",
                timings.ws_auxiliary_us() / 1000.0
            );
            println!(
                "  WS aux ZIP I/O:    {:>8.1}ms",
                timings.ws_aux_zip_io_us() / 1000.0
            );
        }
        Err(e) => {
            eprintln!("Parse error: {}", e);
        }
    }
}
