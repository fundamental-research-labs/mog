mod cli;
mod diagnostics;

use std::process::ExitCode;

fn main() -> ExitCode {
    // XLSX import needs a larger stack before the workbook actor exists.
    match std::thread::Builder::new()
        .name("mog-main".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            let stage = diagnostics::Stage::start("cli");
            cli::run()?;
            stage.complete();
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        })
        .expect("failed to spawn mog-main")
        .join()
    {
        Ok(Ok(())) => ExitCode::SUCCESS,
        Ok(Err(error)) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
        Err(_) => ExitCode::FAILURE,
    }
}
