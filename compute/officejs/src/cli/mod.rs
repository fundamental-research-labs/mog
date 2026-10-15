mod args;
mod output;
mod session;

use std::{env, fs, path::PathBuf};

use compute_api::{CellEditCheckpoint, Workbook};
use serde::{Deserialize, Serialize};

use crate::diagnostics::Stage;
use args::Args;
use xlsx_api::file_output::{self, Publication};

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
    if args.version {
        println!("mog {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if args.output_capabilities {
        println!(
            "{{\"protocol\":1,\"live_registered_cell_candidates\":true,\"publishes_final_output\":false}}"
        );
        return Ok(());
    }
    if let Some(task) = &args.cancel_output {
        return output::cancel(task);
    }
    if let Some(task) = &args.prepare_output {
        println!(
            "{}",
            output::prepare_task(
                task,
                args.output_request.as_ref().unwrap(),
                args.output_budget_ms.unwrap()
            )?
        );
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
        prepare_output: None,
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
            workbook_id: uuid::Uuid::new_v4().simple().to_string(),
            registration: match (args.output_task, args.intended_output) {
                (Some(task_id), Some(path)) => {
                    validate_output(&path)?;
                    Some(output::Registration {
                        task_id,
                        declared_output: absolute(path)?,
                    })
                }
                _ => None,
            },
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
            if let Some(warning) = state.save()? {
                eprintln!("{warning}");
            }
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
    workbook_id: String,
    registration: Option<output::Registration>,
}

#[derive(Default, Serialize, Deserialize)]
struct Request {
    source: Option<String>,
    recalculate: bool,
    output: Option<PathBuf>,
    close: bool,
    discard: bool,
    #[serde(default)]
    prepare_output: Option<output::PrepareRequest>,
}

struct State {
    workbook: Workbook,
    output: Option<PathBuf>,
    directory: PathBuf,
    workbook_id: String,
    registered: Option<(output::Registration, CellEditCheckpoint)>,
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
        let registered = if let Some(registration) = &config.registration {
            let checkpoint = workbook.begin_cell_edit_checkpoint()?;
            Some((
                output::register(registration.clone(), &config.workbook_id)?,
                checkpoint,
            ))
        } else {
            None
        };
        Ok(Self {
            workbook,
            output: config
                .request
                .output
                .clone()
                .or_else(|| config.input.clone()),
            directory: config.directory.clone(),
            workbook_id: config.workbook_id.clone(),
            registered,
        })
    }

    fn apply(&mut self, request: &Request) -> Result<String> {
        if let Some(path) = &request.output {
            validate_output(path)?;
        }
        let output = if let Some(source) = &request.source {
            let output = match mog::run_office_js_with_workbook(&self.workbook, source) {
                Ok(output) => output,
                Err(error) => {
                    self.workbook.invalidate_cell_edit_checkpoint()?;
                    return Err(error.into());
                }
            };
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

    fn prepare_output(&self, request: &output::PrepareRequest) -> Result<String> {
        let (registration, checkpoint) = self
            .registered
            .as_ref()
            .ok_or("output_registration_missing")?;
        output::prepare(
            &self.workbook,
            *checkpoint,
            registration,
            &self.workbook_id,
            request,
        )
    }

    fn save(&self) -> Result<Option<String>> {
        let stage = Stage::start("save_workbook");
        let (path, publication) = if let Some(path) = &self.output {
            // Follow an existing symlink just as loading the input does.
            let path = if path.exists() {
                fs::canonicalize(path)?
            } else {
                path.clone()
            };
            let publication = self.export(&path)?;
            (path, publication)
        } else {
            // Stage once, then claim an automatic name without overwriting a racer.
            let mut temporary = file_output::temporary_in(&self.directory)?.into_temp_path();
            self.export(&temporary)?;
            let mut index = 1u64;
            loop {
                let name = if index == 1 {
                    "workbook.xlsx".into()
                } else {
                    format!("workbook-{index}.xlsx")
                };
                let path = self.directory.join(name);
                match file_output::publish(temporary, &path, false) {
                    Ok(publication) => break (path, publication),
                    Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                        temporary = error.path;
                        index += 1;
                    }
                    Err(error) => return Err(error.into()),
                }
            }
        };
        stage.complete();
        Ok((publication == Publication::Copied).then(|| format!(
            "warning: saved {} using copy-and-remove because rename is unavailable; replacement was not atomic",
            path.display()
        )))
    }

    fn export(&self, path: &std::path::Path) -> Result<Publication> {
        self.workbook
            .to_xlsx_path_with_publication(path.to_str().ok_or("output path must be UTF-8")?)
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
