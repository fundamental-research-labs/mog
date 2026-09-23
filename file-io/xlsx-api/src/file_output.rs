//! Publish completed exports, including on filesystems without rename support.

use std::{
    fs::{self, File, OpenOptions},
    io,
    path::Path,
};
use tempfile::{NamedTempFile, PathPersistError, TempPath};

/// How a completed file reached its destination.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Publication {
    Atomic,
    /// Sequential copying succeeded, but replacement was not atomic.
    Copied,
}

/// Prefer destination-side staging so rename remains atomic on local filesystems.
/// Use the host's temporary directory only when this operation is unsupported.
pub fn temporary_in(directory: &Path) -> io::Result<NamedTempFile> {
    match NamedTempFile::new_in(directory) {
        Err(error) if error.kind() == io::ErrorKind::Unsupported => NamedTempFile::new()
            .map_err(|error| context("create system temporary file for", directory, error)),
        result => result.map_err(|error| context("create temporary file in", directory, error)),
    }
}

/// Move a flushed, synced and closed temporary file into place.
///
/// With `overwrite = false`, both publication paths refuse an existing destination.
/// Only unsupported operations and cross-device moves fall back to copying. A
/// failed copy may leave an incomplete destination; errors retain the temporary
/// path so callers can retry name collisions without serializing again.
pub fn publish(
    temporary: TempPath,
    destination: &Path,
    overwrite: bool,
) -> Result<Publication, PathPersistError> {
    let result = if overwrite {
        temporary.persist(destination)
    } else {
        temporary.persist_noclobber(destination)
    };
    finish_publication(result, destination, overwrite)
}

fn finish_publication(
    result: Result<(), PathPersistError>,
    destination: &Path,
    overwrite: bool,
) -> Result<Publication, PathPersistError> {
    match result {
        Ok(()) => Ok(Publication::Atomic),
        Err(mut error) => {
            if matches!(
                error.error.kind(),
                io::ErrorKind::Unsupported | io::ErrorKind::CrossesDevices
            ) {
                if let Err(copy_error) = copy_completed(&error.path, destination, overwrite) {
                    error.error = copy_error;
                    return Err(error);
                }
                // Explicit removal reports cleanup errors rather than silently leaking files.
                if let Err(remove_error) = fs::remove_file(&error.path) {
                    error.error =
                        context("remove published temporary file", &error.path, remove_error);
                    return Err(error);
                }
                Ok(Publication::Copied)
            } else {
                error.error = context("publish temporary file to", destination, error.error);
                Err(error)
            }
        }
    }
}

fn copy_completed(source: &Path, destination: &Path, overwrite: bool) -> io::Result<()> {
    // Reopen after closing the writer: object mounts disallow simultaneous
    // readers and writers, even for a file opened with read/write access.
    let mut source = File::open(source)
        .map_err(|error| context("open completed temporary file", source, error))?;
    let mut target = OpenOptions::new()
        .write(true)
        .create(overwrite)
        .truncate(overwrite)
        .create_new(!overwrite)
        .open(destination)
        .map_err(|error| context("open destination for copy", destination, error))?;
    // fs::copy also copies permissions, which object mounts may not support.
    io::copy(&mut source, &mut target).map_err(|error| {
        context(
            "copy export (destination may be incomplete)",
            destination,
            error,
        )
    })?;
    // File::drop cannot report close/upload errors. Mountpoint's fsync completes
    // the upload and reports failures before we remove the temporary source.
    target.sync_all().map_err(|error| {
        context(
            "sync copied export (destination may be incomplete)",
            destination,
            error,
        )
    })
}

pub(crate) fn context(operation: &str, path: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!("{operation} {}: {error}", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn completed(directory: &Path) -> TempPath {
        let mut file = temporary_in(directory).unwrap();
        file.write_all(b"completed workbook").unwrap();
        file.as_file().sync_all().unwrap();
        file.into_temp_path()
    }

    fn rename_failed(path: TempPath, kind: io::ErrorKind) -> Result<(), PathPersistError> {
        Err(PathPersistError {
            error: kind.into(),
            path,
        })
    }

    #[test]
    fn supported_rename_moves_without_copying() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("output.xlsx");
        fs::write(&path, b"old workbook").unwrap();
        assert_eq!(
            publish(completed(directory.path()), &path, true).unwrap(),
            Publication::Atomic
        );
        assert_eq!(fs::read(&path).unwrap(), b"completed workbook");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn unsupported_and_cross_device_moves_copy_new_and_existing_destinations() {
        for kind in [io::ErrorKind::Unsupported, io::ErrorKind::CrossesDevices] {
            for existing in [false, true] {
                let directory = tempfile::tempdir().unwrap();
                let path = directory.path().join("output.xlsx");
                if existing {
                    fs::write(&path, b"old workbook with a longer trailing suffix").unwrap();
                }
                let result = rename_failed(completed(directory.path()), kind);
                assert_eq!(
                    finish_publication(result, &path, true).unwrap(),
                    Publication::Copied
                );
                assert_eq!(fs::read(&path).unwrap(), b"completed workbook");
                assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
            }
        }
    }

    #[test]
    fn copy_does_not_clobber_a_claimed_name_and_can_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("output.xlsx");
        fs::write(&path, b"another writer").unwrap();
        let result = rename_failed(completed(directory.path()), io::ErrorKind::Unsupported);
        let error = finish_publication(result, &path, false).unwrap_err();
        assert_eq!(error.error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&path).unwrap(), b"another writer");
        let next = directory.path().join("output-2.xlsx");
        let result = rename_failed(error.path, io::ErrorKind::Unsupported);
        assert_eq!(
            finish_publication(result, &next, false).unwrap(),
            Publication::Copied
        );
        assert_eq!(fs::read(next).unwrap(), b"completed workbook");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }

    #[test]
    fn real_rename_errors_do_not_touch_destination() {
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::NotFound,
            io::ErrorKind::StorageFull,
            io::ErrorKind::Other,
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("output.xlsx");
            fs::write(&path, b"old workbook").unwrap();
            let result = rename_failed(completed(directory.path()), kind);
            let error = finish_publication(result, &path, true).unwrap_err();
            assert_eq!(error.error.kind(), kind);
            assert!(error.error.to_string().contains("publish temporary file"));
            assert_eq!(fs::read(&path).unwrap(), b"old workbook");
            assert_eq!(fs::read(&error.path).unwrap(), b"completed workbook");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn failed_copy_reports_failure_and_retains_completed_source() {
        let directory = tempfile::tempdir().unwrap();
        let result = rename_failed(completed(directory.path()), io::ErrorKind::Unsupported);
        let error = finish_publication(result, Path::new("/dev/full"), true).unwrap_err();
        assert!(
            error
                .error
                .to_string()
                .contains("copy export (destination may be incomplete)")
        );
        assert_eq!(fs::read(&error.path).unwrap(), b"completed workbook");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn failed_destination_sync_is_not_reported_as_success() {
        let directory = tempfile::tempdir().unwrap();
        let result = rename_failed(completed(directory.path()), io::ErrorKind::Unsupported);
        // Writes to /dev/null succeed, but fsync is invalid for that device.
        let error = finish_publication(result, Path::new("/dev/null"), true).unwrap_err();
        assert!(
            error
                .error
                .to_string()
                .contains("sync copied export (destination may be incomplete)")
        );
        assert_eq!(fs::read(&error.path).unwrap(), b"completed workbook");
    }
}
