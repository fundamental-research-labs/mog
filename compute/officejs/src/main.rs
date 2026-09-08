use std::env;
use std::fs;
use std::process::ExitCode;

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};

fn usage() -> String {
    "Usage:\n  mog save <in.xlsx> <out.xlsx>\n  mog run <in.xlsx> <script.js> <out.xlsx>\n  mog [--eval] <script.js>\n".to_string()
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), OfficeJsError> {
    let mut args = env::args().skip(1).peekable();
    match args.peek().map(String::as_str) {
        None | Some("-h") | Some("--help") => {
            print!("{}", usage());
            return Ok(());
        }
        Some("save") => {
            args.next();
            let input = args.next().ok_or_else(|| OfficeJsError::Script(usage()))?;
            let output = args.next().ok_or_else(|| OfficeJsError::Script(usage()))?;
            if args.next().is_some() {
                return Err(OfficeJsError::Script(usage()));
            }
            return open_save(&input, "", &output);
        }
        Some("run") => {
            args.next();
            let input = args.next().ok_or_else(|| OfficeJsError::Script(usage()))?;
            let script = args.next().ok_or_else(|| OfficeJsError::Script(usage()))?;
            let output = args.next().ok_or_else(|| OfficeJsError::Script(usage()))?;
            if args.next().is_some() {
                return Err(OfficeJsError::Script(usage()));
            }
            return open_save(&input, &script, &output);
        }
        _ => {}
    }

    let source = match args.next().as_deref() {
        Some("--eval") => args
            .next()
            .ok_or_else(|| OfficeJsError::Script("mog --eval requires a script string".into()))?,
        Some(path) => fs::read_to_string(path)
            .map_err(|e| OfficeJsError::Script(format!("failed to read {path}: {e}")))?,
        None => {
            print!("{}", usage());
            return Ok(());
        }
    };
    let (wb, _) = Workbook::blank()?;
    let output = run_office_js_with_workbook(&wb, &source)?;
    if output.stdout.is_empty()
        && !output.value.is_null()
        && let Ok(text) = serde_json::to_string(&output.value)
    {
        println!("{text}");
    }
    Ok(())
}

fn open_save(input: &str, script: &str, output: &str) -> Result<(), OfficeJsError> {
    let (wb, _) = Workbook::from_xlsx_path(input)?;
    if !script.trim().is_empty() {
        let src = fs::read_to_string(script)
            .map_err(|e| OfficeJsError::Script(format!("failed to read {script}: {e}")))?;
        if !src.trim().is_empty() {
            run_office_js_with_workbook(&wb, &src)?;
        }
    }
    wb.to_xlsx_path(output)?;
    Ok(())
}
