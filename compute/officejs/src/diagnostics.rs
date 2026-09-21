//! Opt-in, best-effort stage records. Write each record immediately so a native
//! crash leaves the last started stage on disk, without logging workbook data.
use std::{
    env,
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

pub(crate) struct Stage {
    path: Option<PathBuf>,
    name: &'static str,
    started: Instant,
    completed: bool,
}

impl Stage {
    pub(crate) fn start(name: &'static str) -> Self {
        let stage = Self {
            path: env::var_os("MOG_DIAGNOSTICS_FILE")
                .filter(|path| !path.is_empty())
                .map(PathBuf::from),
            name,
            started: Instant::now(),
            completed: false,
        };
        stage.record("started");
        stage
    }

    pub(crate) fn complete(mut self) {
        self.completed = true;
        self.record("completed");
    }

    fn record(&self, status: &str) {
        let Some(path) = &self.path else { return };
        let record = serde_json::json!({
            "timestamp_ms": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
            "pid": std::process::id(),
            "stage": self.name,
            "status": status,
            "elapsed_ms": self.started.elapsed().as_millis(),
        });
        // Diagnostics must not change the command's result, even on a full disk.
        let _ = writeln!(std::io::stderr().lock(), "[mog] {record}");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{record}");
        }
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        if !self.completed {
            self.record(if std::thread::panicking() {
                "panicked"
            } else {
                "failed"
            });
        }
    }
}
