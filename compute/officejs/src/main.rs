use std::env;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js, run_office_js_with_workbook};

fn usage() -> String {
    "Usage: mog <script.js>\n       mog --eval <source>\n       mog save [--recalculate] <in.xlsx> <out.xlsx>\n       mog run [--recalculate] <in.xlsx> <script.js> <out.xlsx>\n".to_string()
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
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        None | Some("-h") | Some("--help") => {
            print!("{}", usage());
            Ok(())
        }
        Some("--eval") => {
            let source = args.next().ok_or_else(|| {
                OfficeJsError::Script("mog --eval requires a script string".into())
            })?;
            print_script_output(run_office_js(&source)?)
        }
        Some("save") => {
            let (recalculate, rest) = take_recalculate(args.collect())?;
            let in_path = rest.first().map(String::as_str).ok_or_else(|| {
                OfficeJsError::Script("mog save requires <in.xlsx> <out.xlsx>".into())
            })?;
            let out_path = rest.get(1).map(String::as_str).ok_or_else(|| {
                OfficeJsError::Script("mog save requires <in.xlsx> <out.xlsx>".into())
            })?;
            if rest.len() != 2 {
                return Err(OfficeJsError::Script(
                    "mog save [--recalculate] <in.xlsx> <out.xlsx>".into(),
                ));
            }
            save_xlsx(in_path, out_path, recalculate)
        }
        Some("run") => {
            let (recalculate, rest) = take_recalculate(args.collect())?;
            let in_path = rest.first().map(String::as_str).ok_or_else(|| {
                OfficeJsError::Script("mog run requires <in.xlsx> <script.js> <out.xlsx>".into())
            })?;
            let script_path = rest.get(1).map(String::as_str).ok_or_else(|| {
                OfficeJsError::Script("mog run requires <in.xlsx> <script.js> <out.xlsx>".into())
            })?;
            let out_path = rest.get(2).map(String::as_str).ok_or_else(|| {
                OfficeJsError::Script("mog run requires <in.xlsx> <script.js> <out.xlsx>".into())
            })?;
            if rest.len() != 3 {
                return Err(OfficeJsError::Script(
                    "mog run [--recalculate] <in.xlsx> <script.js> <out.xlsx>".into(),
                ));
            }
            run_xlsx(in_path, script_path, out_path, recalculate)
        }
        Some(path) => {
            let source = fs::read_to_string(path)
                .map_err(|e| OfficeJsError::Script(format!("failed to read {path}: {e}")))?;
            print_script_output(run_office_js(&source)?)
        }
    }
}

fn take_recalculate(args: Vec<String>) -> Result<(bool, Vec<String>), OfficeJsError> {
    let mut recalculate = false;
    let mut rest = Vec::new();
    for arg in args {
        if arg == "--recalculate" && !recalculate && rest.is_empty() {
            recalculate = true;
        } else {
            rest.push(arg);
        }
    }
    Ok((recalculate, rest))
}

fn load_workbook(path: &str) -> Result<Workbook, OfficeJsError> {
    let bytes =
        fs::read(path).map_err(|e| OfficeJsError::Script(format!("failed to read {path}: {e}")))?;
    let (workbook, _) = Workbook::from_xlsx_bytes(&bytes)?;
    Ok(workbook)
}

fn write_xlsx(workbook: &Workbook, out_path: &str) -> Result<(), OfficeJsError> {
    if Path::new(out_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("xlsx"))
    {
        return Err(OfficeJsError::Script(format!(
            "output must be .xlsx, got {out_path}"
        )));
    }
    let bytes = workbook.to_xlsx_bytes()?;
    if let Some(parent) = Path::new(out_path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent).map_err(|e| {
            OfficeJsError::Script(format!("failed to create {}: {e}", parent.display()))
        })?;
    }
    fs::write(out_path, bytes)
        .map_err(|e| OfficeJsError::Script(format!("failed to write {out_path}: {e}")))
}

fn save_xlsx(in_path: &str, out_path: &str, recalculate: bool) -> Result<(), OfficeJsError> {
    let workbook = load_workbook(in_path)?;
    if recalculate {
        workbook.recalculate()?;
    }
    write_xlsx(&workbook, out_path)
}

fn run_xlsx(
    in_path: &str,
    script_path: &str,
    out_path: &str,
    recalculate: bool,
) -> Result<(), OfficeJsError> {
    let workbook = load_workbook(in_path)?;
    let source = fs::read_to_string(script_path)
        .map_err(|e| OfficeJsError::Script(format!("failed to read {script_path}: {e}")))?;
    let output = run_office_js_with_workbook(&workbook, &source)?;
    if recalculate {
        workbook.recalculate()?;
    }
    write_xlsx(&workbook, out_path)?;
    print_script_output(output)
}

fn print_script_output(output: mog::ScriptOutput) -> Result<(), OfficeJsError> {
    if output.stdout.is_empty()
        && !output.value.is_null()
        && let Ok(text) = serde_json::to_string(&output.value)
    {
        println!("{text}");
    }
    Ok(())
}
