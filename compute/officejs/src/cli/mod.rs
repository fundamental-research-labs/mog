mod args;
mod session;

use std::{env, fs, path::PathBuf};

use compute_api::Workbook;
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
        preserve_results: args.preserve_results,
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
}

#[derive(Default, Serialize, Deserialize)]
struct Request {
    source: Option<String>,
    recalculate: bool,
    #[serde(default)]
    preserve_results: bool,
    output: Option<PathBuf>,
    close: bool,
    discard: bool,
}

struct State {
    reuse_imported_caches: bool,
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
        if config.request.preserve_results {
            preserve_results(&workbook)?;
        }
        let reuse_imported_caches = config.input.is_some()
            && !config.request.recalculate
            && config.request.source.is_none()
            && !config.request.preserve_results
            && workbook.recalculate_compatible_import()?;
        if !reuse_imported_caches && workbook.settings().calculation_mode()? != "manual" {
            workbook.recalculate()?;
        }
        stage.complete();
        Ok(Self {
            reuse_imported_caches,
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
        if request.preserve_results && request.recalculate {
            return Err("--preserve-results conflicts with --recalculate".into());
        }
        if let Some(path) = &request.output {
            validate_output(path)?;
        }
        if request.preserve_results {
            preserve_results(&self.workbook)?;
        }
        if request.source.is_some() || request.recalculate || request.preserve_results {
            self.reuse_imported_caches = false;
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
        if request.recalculate
            || (request.source.is_some()
                && self.workbook.settings().runtime_calculation_mode()? != "manual")
        {
            let stage = Stage::start("recalculate");
            self.workbook.recalculate()?;
            stage.complete();
        }
        if let Some(path) = &request.output {
            self.output = Some(path.clone());
        }
        Ok(output)
    }

    fn save(&self) -> Result<Option<String>> {
        let stage = Stage::start("save_workbook");
        if self
            .workbook
            .settings()
            .get_workbook_settings()?
            .calculation_settings
            .unwrap_or_default()
            .calc_on_save
        {
            if !self.reuse_imported_caches || !self.workbook.recalculate_compatible_import()? {
                self.workbook.recalculate()?;
            }
        }
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

fn preserve_results(workbook: &Workbook) -> Result<()> {
    let mut settings = workbook.settings().get_workbook_settings()?;
    let calculation = settings
        .calculation_settings
        .get_or_insert_with(Default::default);
    calculation.calc_on_save = false;
    workbook.settings().set_workbook_settings(settings)?;
    workbook.settings().set_calculation_mode("manual")?;
    workbook.settings().set_runtime_calculation_mode("manual")?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_requests_keep_default_recalculation_policy() {
        let request: Request = serde_json::from_str(r#"{"source":"return 1;","recalculate":false,"output":null,"close":false,"discard":false}"#).unwrap();
        assert!(!request.preserve_results);
        assert!(request.source.is_some());
    }

    #[test]
    fn script_edits_disable_import_cache_reuse() {
        let mut state = State {
            reuse_imported_caches: true,
            workbook: Workbook::blank().unwrap().0,
            output: None,
            directory: PathBuf::new(),
        };
        state.apply(&Request {
            source: Some("await Excel.run(async context => { const sheet = context.workbook.worksheets.add('Edited'); sheet.getRange('A1').values = [[3]]; sheet.getRange('B1').formulas = [['=A1*2']]; await context.sync(); });".into()),
            ..Request::default()
        }).unwrap();
        assert!(!state.reuse_imported_caches);
        let value = state.apply(&Request {
            source: Some("return await Excel.run(async context => { const range = context.workbook.worksheets.getItem('Edited').getRange('B1'); range.load('values'); await context.sync(); return range.values; });".into()),
            ..Request::default()
        }).unwrap();
        assert_eq!(value, "[[6]]");
    }

    #[test]
    fn contradictory_worker_request_fails_before_script_execution() {
        let request = Request {
            source: Some("throw new Error('script executed');".into()),
            recalculate: true,
            preserve_results: true,
            ..Request::default()
        };
        let mut state = State {
            reuse_imported_caches: false,
            workbook: Workbook::blank().unwrap().0,
            output: None,
            directory: PathBuf::new(),
        };
        assert!(
            state
                .apply(&request)
                .unwrap_err()
                .to_string()
                .contains("conflicts")
        );
    }
}
