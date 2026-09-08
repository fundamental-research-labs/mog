use std::env;
use std::fs;
use std::process::ExitCode;

use mog::{OfficeJsError, run_office_js};

fn usage() -> String {
    "Usage: mog <script.js>\n       mog --eval <source>\n".to_string()
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
    let source = match args.next().as_deref() {
        None | Some("-h") | Some("--help") => {
            print!("{}", usage());
            return Ok(());
        }
        Some("--eval") => args
            .next()
            .ok_or_else(|| OfficeJsError::Script("mog --eval requires a script string".into()))?,
        Some(path) => fs::read_to_string(path)
            .map_err(|e| OfficeJsError::Script(format!("failed to read {path}: {e}")))?,
    };

    let output = run_office_js(&source)?;
    if output.stdout.is_empty()
        && !output.value.is_null()
        && let Ok(text) = serde_json::to_string(&output.value)
    {
        println!("{text}");
    }
    Ok(())
}
