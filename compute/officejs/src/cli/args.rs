use super::Result;
use std::path::PathBuf;

pub const HELP: &str = "Usage: mog [OPTIONS] [script.js]

  -i, --input <file.xlsx>   Load a workbook
  -o, --output <file.xlsx>  Save here (default: input file, or workbook.xlsx)
  -e, --eval <source>       Run inline JavaScript instead of a script file
  -r, --recalculate         Evaluate formulas (automatic after a script)
  -s, --session [ID]        Start a background session, or use an existing one
      --sesion [ID]         Alias for --session
      --close              Save and end the session selected with -s ID
      --close-all          Save and end all sessions for this user
      --discard            End without saving (with --close or --close-all)
  -h, --help               Show this help

Without input, starts blank. Automatic filenames never overwrite existing files:
workbook.xlsx, workbook-2.xlsx, workbook-3.xlsx, ... in the current directory.
Sessions keep workbook changes in memory until closed. A failed save keeps the
session alive; retry with -o <file.xlsx>, or close with --discard.
";

#[derive(Default, Debug)]
pub struct Args {
    pub input: Option<PathBuf>,
    pub output: Option<PathBuf>,
    pub eval: Option<String>,
    pub script: Option<PathBuf>,
    pub session: Option<Option<String>>,
    pub recalculate: bool,
    pub close: bool,
    pub close_all: bool,
    pub discard: bool,
    pub help: bool,
}

impl Args {
    pub fn parse(raw: Vec<String>) -> Result<Self> {
        let mut result = Self::default();
        let mut args = raw.into_iter().peekable();
        while let Some(arg) = args.next() {
            if arg == "--" {
                for path in args.by_ref() {
                    set(&mut result.script, path.into(), "script file")?;
                }
                break;
            }
            let (flag, inline) = arg
                .split_once('=')
                .map_or((arg.as_str(), None), |(a, b)| (a, Some(b)));
            let mut value = || -> Result<String> {
                inline
                    .map(str::to_owned)
                    .or_else(|| args.next().filter(|s| !s.starts_with('-')))
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| format!("{flag} requires a value").into())
            };
            match flag {
                "-i" | "--input" => set(&mut result.input, value()?.into(), flag)?,
                "-o" | "--output" => set(&mut result.output, value()?.into(), flag)?,
                "-e" | "--eval" => set(&mut result.eval, value()?, flag)?,
                "-s" | "--session" | "--sesion" => {
                    let id = if let Some(id) = inline {
                        if id.is_empty() {
                            return Err("session ID cannot be empty".into());
                        }
                        Some(id.to_owned())
                    } else if args.peek().is_some_and(|s| !s.starts_with('-')) {
                        args.next()
                    } else {
                        None
                    };
                    set(&mut result.session, id, flag)?;
                }
                "-r" | "--recalculate" if inline.is_none() => result.recalculate = true,
                "--close" if inline.is_none() => result.close = true,
                "--close-all" if inline.is_none() => result.close_all = true,
                "--discard" if inline.is_none() => result.discard = true,
                "-h" | "--help" if inline.is_none() => result.help = true,
                _ if arg.starts_with('-') => {
                    return Err(format!("unknown option: {arg}\nUse mog --help for usage.").into());
                }
                _ => set(&mut result.script, arg.into(), "script file")?,
            }
        }
        if result.eval.is_some() && result.script.is_some() {
            return Err("use either --eval or a script file".into());
        }
        if matches!(result.session, Some(Some(_))) && result.input.is_some() {
            return Err(
                "--input is only valid when opening a workbook or starting a session".into(),
            );
        }
        if result.close && !matches!(result.session, Some(Some(_))) {
            return Err("--close requires -s <ID>".into());
        }
        if result.close_all
            && (result.session.is_some()
                || result.close
                || result.input.is_some()
                || result.output.is_some()
                || result.eval.is_some()
                || result.script.is_some()
                || result.recalculate)
        {
            return Err("--close-all can only be combined with --discard".into());
        }
        if result.discard
            && (!result.close && !result.close_all
                || result.output.is_some()
                || result.eval.is_some()
                || result.script.is_some()
                || result.recalculate)
        {
            return Err("--discard requires --close or --close-all, without script, output, or recalculation".into());
        }
        Ok(result)
    }
}

fn set<T>(slot: &mut Option<T>, value: T, name: &str) -> Result<()> {
    if slot.is_some() {
        return Err(format!("{name} specified more than once").into());
    }
    *slot = Some(value);
    Ok(())
}
