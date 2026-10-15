//! Task-owned, single-attempt staging for registered live workbooks.
//!
//! A candidate is partial evidence, never a published task result. Native cell
//! edit evidence covers only the audited typed setter; unsupported mutations,
//! expired requests and lost sessions fail closed without guessing a workbook.
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use compute_api::{CellEditCheckpoint, CellEditEvidence, CellEditStatus, Workbook};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{Result, session};

const MAX_CANDIDATE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Registration {
    pub task_id: String,
    pub declared_output: PathBuf,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct PrepareRequest {
    pub task_id: String,
    pub workbook_id: String,
    pub request_id: String,
    pub deadline_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    registration: Registration,
    workbook_id: String,
    ambiguous: bool,
    attempted_request: Option<String>,
    result: Option<Candidate>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Candidate {
    protocol: u8,
    task_id: String,
    workbook_id: String,
    request_id: String,
    declared_output: PathBuf,
    outcome: String,
    reason: Option<String>,
    path: Option<PathBuf>,
    sha256: Option<String>,
    size_bytes: Option<u64>,
    evidence: Option<CellEditEvidence>,
}

fn id(value: &str) -> Result<String> {
    Ok(Uuid::parse_str(value)
        .map_err(|_| "output identity must be a UUID")?
        .simple()
        .to_string())
}

fn path(task: &str, extension: &str) -> Result<PathBuf> {
    Ok(session::directory()?.join(format!("output-{}.{}", id(task)?, extension)))
}

struct Lock(PathBuf);
impl Lock {
    fn acquire(task: &str) -> Result<Self> {
        let path = path(task, "lock")?;
        fs::create_dir(&path).map_err(|_| "output_registry_busy")?;
        Ok(Self(path))
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}

fn read_record(task: &str) -> Result<Record> {
    let path = path(task, "json")?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| "output_registration_missing")?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 {
        return Err("output_registration_invalid".into());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_record(record: &Record, create: bool) -> Result<()> {
    let destination = path(&record.registration.task_id, "json")?;
    let mut file = tempfile::NamedTempFile::new_in(destination.parent().unwrap())?;
    file.write_all(&serde_json::to_vec(record)?)?;
    file.as_file().sync_all()?;
    if create {
        file.persist_noclobber(destination)?;
    } else {
        file.persist(destination)?;
    }
    Ok(())
}

pub(super) fn register(mut registration: Registration, workbook: &str) -> Result<Registration> {
    registration.task_id = id(&registration.task_id)?;
    let _lock = Lock::acquire(&registration.task_id)?;
    if path(&registration.task_id, "json")?.exists() {
        let mut previous = read_record(&registration.task_id)?;
        previous.ambiguous = true;
        write_record(&previous, false)?;
        return Err("ambiguous_output_registration".into());
    }
    let parent = registration
        .declared_output
        .parent()
        .ok_or("output path has no parent")?;
    fs::create_dir_all(parent)?;
    registration.declared_output = fs::canonicalize(parent)?.join(
        registration
            .declared_output
            .file_name()
            .ok_or("invalid output path")?,
    );
    write_record(
        &Record {
            registration: registration.clone(),
            workbook_id: id(workbook)?,
            ambiguous: false,
            attempted_request: None,
            result: None,
        },
        true,
    )?;
    Ok(registration)
}

fn now_ms() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

fn ensure_active(request: &PrepareRequest) -> Result<()> {
    if path(&request.task_id, "cancelled")?.exists() {
        return Err("output_cancelled".into());
    }
    if now_ms()? >= request.deadline_ms {
        return Err("output_budget_exhausted".into());
    }
    Ok(())
}

struct Budget(Instant);
impl Budget {
    fn new(request: &PrepareRequest) -> Result<Self> {
        let remaining = request
            .deadline_ms
            .checked_sub(now_ms()?)
            .filter(|ms| (1..=50_000).contains(ms))
            .ok_or("output_budget_invalid_or_exhausted")?;
        Ok(Self(Instant::now() + Duration::from_millis(remaining)))
    }
    fn check(&self, request: &PrepareRequest) -> Result<()> {
        if Instant::now() >= self.0 {
            return Err("output_budget_exhausted".into());
        }
        ensure_active(request)
    }
}

fn digest(path: &Path, budget: &Budget, request: &PrepareRequest) -> Result<(String, u64)> {
    budget.check(request)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_CANDIDATE_BYTES {
        return Err("candidate_size_or_type_invalid".into());
    }
    let mut reader = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0u64;
    loop {
        budget.check(request)?;
        let size = reader.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        total += size as u64;
        if total > MAX_CANDIDATE_BYTES {
            return Err("candidate_size_or_type_invalid".into());
        }
        digest.update(&buffer[..size]);
    }
    if total != metadata.len() {
        return Err("candidate_changed".into());
    }
    Ok((format!("{:x}", digest.finalize()), metadata.len()))
}

fn verified_result(
    record: &Record,
    request: &PrepareRequest,
    budget: &Budget,
) -> Result<Option<Candidate>> {
    budget.check(request)?;
    if record.ambiguous {
        return Err("ambiguous_output_registration".into());
    }
    if let Some(attempted) = &record.attempted_request {
        if attempted != &request.request_id {
            return Err("output_repair_already_attempted".into());
        }
        let result = record
            .result
            .clone()
            .ok_or("output_repair_outcome_unknown")?;
        if result.outcome == "candidate_saved" {
            let (hash, size) = digest(
                result.path.as_ref().ok_or("candidate_path_missing")?,
                budget,
                request,
            )?;
            if Some(hash) != result.sha256 || Some(size) != result.size_bytes {
                return Err("candidate_changed".into());
            }
        }
        return Ok(Some(result));
    }
    Ok(None)
}

pub(super) fn prepare_task(task: &str, request: &str, budget_ms: u64) -> Result<String> {
    if !(1..=50_000).contains(&budget_ms) {
        return Err("output budget must be between 1 and 50000 ms".into());
    }
    let deadline_ms = now_ms()?
        .checked_add(budget_ms)
        .ok_or("deadline overflow")?;
    let task = id(task)?;
    let request = id(request)?;
    if path(&task, "cancelled")?.exists() {
        return Err("output_cancelled".into());
    }
    let record = read_record(&task)?;
    let prepare = PrepareRequest {
        task_id: task,
        workbook_id: record.workbook_id.clone(),
        request_id: request,
        deadline_ms,
    };
    let budget = Budget::new(&prepare)?;
    if let Some(result) = verified_result(&record, &prepare, &budget)? {
        return Ok(serde_json::to_string(&result)?);
    }
    let native_request = super::Request {
        prepare_output: Some(prepare.clone()),
        ..Default::default()
    };
    let result = session::execute_bounded(
        &record.workbook_id,
        &native_request,
        budget.0.saturating_duration_since(Instant::now()),
    )?;
    budget.check(&prepare)?;
    Ok(result)
}

pub(super) fn cancel(task: &str) -> Result<()> {
    let _lock = Lock::acquire(task)?;
    read_record(task)?;
    let destination = path(task, "cancelled")?;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
    {
        Ok(file) => file.sync_all()?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

pub(super) fn prepare(
    workbook: &Workbook,
    checkpoint: CellEditCheckpoint,
    registration: &Registration,
    workbook_id: &str,
    request: &PrepareRequest,
) -> Result<String> {
    if request.task_id != registration.task_id || request.workbook_id != workbook_id {
        return Err("output_identity_mismatch".into());
    }
    if id(&request.request_id)? != request.request_id {
        return Err("output_request_identity_invalid".into());
    }
    let budget = Budget::new(request)?;
    let _lock = Lock::acquire(&request.task_id)?;
    let mut record = read_record(&request.task_id)?;
    if record.workbook_id != workbook_id
        || record.registration.declared_output != registration.declared_output
    {
        return Err("output_identity_mismatch".into());
    }
    if let Some(result) = verified_result(&record, request, &budget)? {
        return Ok(serde_json::to_string(&result)?);
    }
    ensure_active(request)?;
    record.attempted_request = Some(request.request_id.clone());
    write_record(&record, false)?;
    drop(_lock);
    let mut result = Candidate {
        protocol: 1,
        task_id: request.task_id.clone(),
        workbook_id: workbook_id.into(),
        request_id: request.request_id.clone(),
        declared_output: registration.declared_output.clone(),
        outcome: "unavailable".into(),
        reason: None,
        path: None,
        sha256: None,
        size_bytes: None,
        evidence: None,
    };
    let staged = (|| -> Result<()> {
        let evidence = workbook.freeze_cell_edit_checkpoint(checkpoint)?;
        let status = evidence.status.clone();
        result.evidence = Some(evidence);
        match status {
            CellEditStatus::NetCellEdit => {}
            CellEditStatus::NoNetCellEdit => return Err("no_net_cell_edits".into()),
            CellEditStatus::Unavailable => return Err("edit_identity_unavailable".into()),
        }
        budget.check(request)?;
        let parent = registration.declared_output.parent().unwrap();
        if fs::canonicalize(parent)? != parent {
            return Err("output_directory_changed".into());
        }
        let temporary = tempfile::Builder::new()
            .prefix(".mog-candidate-")
            .suffix(".xlsx")
            .tempfile_in(parent)?
            .into_temp_path();
        // Keep the private staging path if export, validation or deadline checks fail.
        let partial = temporary.keep()?;
        result.path = Some(partial.clone());
        workbook.to_xlsx_path(partial.to_str().ok_or("candidate path must be UTF-8")?)?;
        budget.check(request)?;
        let (hash, size) = digest(&partial, &budget, request)?;
        Workbook::from_xlsx_path(partial.to_str().unwrap()).map_err(|_| "candidate_unreadable")?;
        budget.check(request)?;
        if digest(&partial, &budget, request)? != (hash.clone(), size) {
            return Err("candidate_changed".into());
        }
        let destination = parent.join(format!(
            ".mog-{}-{}.candidate.xlsx",
            request.task_id, request.request_id
        ));
        // Cancellation and publication serialize here; export does not hold this
        // lock, so cancellation can win while serialization is still running.
        let _publication_lock = Lock::acquire(&request.task_id)?;
        budget.check(request)?;
        if read_record(&request.task_id)?.ambiguous {
            return Err("ambiguous_output_registration".into());
        }
        // Publish a complete destination-side file atomically, with no copy fallback.
        let temporary = tempfile::TempPath::try_from_path(partial)?;
        temporary.persist_noclobber(&destination).map_err(|error| {
            let _ = error.path.keep();
            "atomic_candidate_publish_unavailable"
        })?;
        result.path = Some(destination.clone());
        if digest(&destination, &budget, request)? != (hash.clone(), size) {
            return Err("candidate_changed".into());
        }
        result.outcome = "candidate_saved".into();
        result.path = Some(destination);
        result.sha256 = Some(hash);
        result.size_bytes = Some(size);
        Ok(())
    })();
    if let Err(error) = staged {
        result.reason = Some(error.to_string());
    }
    let _result_lock = Lock::acquire(&request.task_id)?;
    // Preserve a competing registration's ambiguity; never overwrite it with a
    // stale pre-export record when writing the completed attempt receipt.
    record.ambiguous |= read_record(&request.task_id)?.ambiguous;
    if record.ambiguous {
        result.outcome = "unavailable".into();
        result.reason = Some("ambiguous_output_registration".into());
    }
    if result.outcome == "candidate_saved" {
        if let Err(error) = budget.check(request) {
            result.outcome = "unavailable".into();
            result.reason = Some(error.to_string());
        }
    }
    record.result = Some(result.clone());
    write_record(&record, false)?;
    Ok(serde_json::to_string(&result)?)
}
