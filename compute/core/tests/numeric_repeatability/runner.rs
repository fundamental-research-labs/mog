pub(crate) struct FamilyResult {
    pub(crate) family: &'static str,
    pub(crate) passed: usize,
    pub(crate) failed: usize,
    failures: Vec<String>,
}

impl FamilyResult {
    pub(crate) fn new(family: &'static str) -> Self {
        Self {
            family,
            passed: 0,
            failed: 0,
            failures: Vec::new(),
        }
    }

    pub(crate) fn record(&mut self, case_name: String, outcome: Result<(), String>) {
        match outcome {
            Ok(()) => self.passed += 1,
            Err(e) => {
                self.failed += 1;
                self.failures.push(format!("  [{}] {}", case_name, e));
            }
        }
    }

    pub(crate) fn report(&self) {
        let total = self.passed + self.failed;
        eprintln!(
            "[Class III · {}] {}/{} passed, {} failed",
            self.family, self.passed, total, self.failed
        );
        for f in &self.failures {
            eprintln!("{}", f);
        }
    }
}

/// Delta applied to the root cell for the forward op.
pub(crate) const EDIT_DELTA: f64 = 0.001;
