mod args;
mod session;

use std::{env, fs, path::PathBuf};

use compute_api::Workbook;
use serde::{Deserialize, Serialize};

use crate::diagnostics::Stage;
use args::Args;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub fn run() -> Result<()> {
    let raw: Vec<String> = env::args().skip(1).collect();
    if raw == ["--session-worker"] {
        return session::worker();
    }
    let args = Args::parse(raw)?;
    if args.help {
        print!("{}", args::HELP);
        return Ok(());
    }
    let request = Request {
        source: match (args.eval, args.script) {
            (Some(source), _) => Some(source),
            (_, Some(path)) => Some(
                fs::read_to_string(&path)
                    .map_err(|e| format!("failed to read script {}: {e}", path.display()))?,
            ),
            _ => None,
        },
        recalculate: args.recalculate,
        output: args.output.map(absolute).transpose()?,
        close: args.close || args.close_all,
        discard: args.discard,
    };
    if args.close_all {
        return session::close_all(&request);
    }
    if let Some(Some(id)) = args.session {
        print_output(&session::execute(&id, &request)?);
    } else {
        let config = Config {
            input: args.input.map(absolute).transpose()?,
            directory: env::current_dir()?,
            request,
        };
        if args.session.is_some() {
            let (id, output) = session::start(config)?;
            // Keep stdout usable in ID=$(mog -s ...), even with an initial script.
            if !output.is_empty() {
                eprintln!("{output}");
            }
            println!("{id}");
        } else {
            let mut state = State::load(&config)?;
            let output = state.apply(&config.request)?;
            state.save()?;
            print_output(&output);
        }
    }
    Ok(())
}

fn print_output(output: &str) {
    if !output.is_empty() {
        println!("{output}");
    }
}

fn absolute(path: PathBuf) -> Result<PathBuf> {
    Ok(env::current_dir()?.join(path))
}

#[derive(Serialize, Deserialize)]
struct Config {
    input: Option<PathBuf>,
    directory: PathBuf,
    request: Request,
}

#[derive(Default, Serialize, Deserialize)]
struct Request {
    source: Option<String>,
    recalculate: bool,
    output: Option<PathBuf>,
    close: bool,
    discard: bool,
}

struct State {
    workbook: Workbook,
    output: Option<PathBuf>,
    directory: PathBuf,
}

impl State {
    fn load(config: &Config) -> Result<Self> {
        let stage = Stage::start("load_workbook");
        if let Some(path) = config.request.output.as_ref().or(config.input.as_ref()) {
            validate_output(path)?;
        }
        let workbook = if let Some(path) = &config.input {
            Workbook::from_xlsx_path(path.to_str().ok_or("input path must be UTF-8")?)
                .map_err(|e| format!("failed to read {}: {e}", path.display()))?
                .0
        } else {
            Workbook::blank()?.0
        };
        stage.complete();
        Ok(Self {
            workbook,
            output: config
                .request
                .output
                .clone()
                .or_else(|| config.input.clone()),
            directory: config.directory.clone(),
        })
    }

    fn apply(&mut self, request: &Request) -> Result<String> {
        if let Some(path) = &request.output {
            validate_output(path)?;
        }
        let output = if let Some(source) = &request.source {
            let output = mog::run_office_js_with_workbook(&self.workbook, source)?;
            if !output.stdout.is_empty() {
                output.stdout
            } else if !output.value.is_null() {
                serde_json::to_string(&output.value)?
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        if request.recalculate || request.source.is_some() {
            let stage = Stage::start("recalculate");
            self.workbook.recalculate()?;
            stage.complete();
        }
        if let Some(path) = &request.output {
            self.output = Some(path.clone());
        }
        Ok(output)
    }

    fn save(&self) -> Result<()> {
        let stage = Stage::start("save_workbook");
        if let Some(path) = &self.output {
            // Follow an existing symlink just as loading the input does.
            let path = if path.exists() {
                fs::canonicalize(path)?
            } else {
                path.clone()
            };
            self.export(&path)?;
        } else {
            // The API already streams the export to a temporary file before atomic replacement.
            // Stage once, then claim an automatic name without overwriting a racer.
            let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?.into_temp_path();
            self.export(&temporary)?;
            for index in 1u64.. {
                let name = if index == 1 {
                    "workbook.xlsx".into()
                } else {
                    format!("workbook-{index}.xlsx")
                };
                match temporary.persist_noclobber(self.directory.join(name)) {
                    Ok(()) => break,
                    Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                        temporary = error.path;
                    }
                    Err(error) => return Err(error.into()),
                }
            }
        }
        stage.complete();
        Ok(())
    }

    fn export(&self, path: &std::path::Path) -> Result<()> {
        self.workbook
            .to_xlsx_path(path.to_str().ok_or("output path must be UTF-8")?)
            .map_err(|e| format!("failed to save {}: {e}", path.display()).into())
    }
}

fn validate_output(path: &std::path::Path) -> Result<()> {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("xlsx"))
    {
        return Err(format!("output must be .xlsx, got {}", path.display()).into());
    }
    Ok(())
}
