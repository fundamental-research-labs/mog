use crate::matrix::CoverageReason;

pub(crate) struct Summary {
    pub(crate) family: &'static str,
    pub(crate) passed: usize,
    pub(crate) failed: usize,
    pub(crate) skipped: usize,
    pub(crate) failures: Vec<String>,
}

impl Summary {
    pub(crate) fn new(family: &'static str) -> Self {
        Self {
            family,
            passed: 0,
            failed: 0,
            skipped: 0,
            failures: Vec::new(),
        }
    }

    pub(crate) fn record(&mut self, name: &str, result: Result<(), String>) {
        match result {
            Ok(()) => self.passed += 1,
            Err(e) => {
                self.failed += 1;
                self.failures.push(format!("  [{}] {}", name, e));
            }
        }
    }

    pub(crate) fn skip(&mut self, _reason: CoverageReason) {
        self.skipped += 1;
    }

    pub(crate) fn counted(&self) -> usize {
        self.passed + self.failed
    }

    pub(crate) fn emit(&self) {
        eprintln!(
            "[Class II · {family}] {p}/{tot} passed, {f} failed, {s} skipped",
            family = self.family,
            p = self.passed,
            tot = self.counted(),
            f = self.failed,
            s = self.skipped,
        );
        if !self.failures.is_empty() {
            eprintln!("[Class II · {family}] failures:", family = self.family);
            for f in &self.failures {
                eprintln!("{}", f);
            }
        }
    }
}
