//! One detached process owns each workbook. Clients send one authenticated JSON
//! request per loopback connection; the worker serializes all workbook access.
use std::{
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use super::{Config, Request, Result, State};

const IO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_MESSAGE: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Record {
    port: u16,
    token: String,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    token: String,
    request: Request,
}

#[derive(Serialize, Deserialize)]
struct Reply {
    output: String,
    error: Option<String>,
    #[serde(default)]
    warning: Option<String>,
}

impl Reply {
    fn from_result(result: Result<String>) -> Self {
        match result {
            Ok(output) => Self {
                output,
                error: None,
                warning: None,
            },
            Err(error) => Self {
                output: String::new(),
                error: Some(error.to_string()),
                warning: None,
            },
        }
    }

    fn into_result(self) -> Result<String> {
        match self.error {
            Some(error) => Err(error.into()),
            None => {
                if let Some(warning) = self.warning {
                    eprintln!("{warning}");
                }
                Ok(self.output)
            }
        }
    }
}

fn directory() -> Result<PathBuf> {
    let path = if let Some(path) = env::var_os("MOG_SESSION_DIR") {
        PathBuf::from(path)
    } else {
        let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .ok_or("cannot locate home directory; set MOG_SESSION_DIR")?;
        PathBuf::from(home).join(".mog").join("sessions")
    };
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::symlink_metadata(&path)?;
        // Refuse shared or foreign registries: these files authorize script execution.
        if !metadata.is_dir()
            || metadata.mode() & 0o077 != 0
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(format!(
                "session directory must be owned by you with mode 0700: {}",
                path.display()
            )
            .into());
        }
    }
    Ok(path)
}

fn record_path(id: &str) -> Result<PathBuf> {
    let uuid = Uuid::parse_str(id).map_err(|_| "invalid session ID")?;
    Ok(directory()?.join(format!("{}.json", uuid.simple())))
}

pub(super) fn start(config: Config) -> Result<(String, String)> {
    // Validate the registry before launching, including its permissions.
    directory()?;
    let mut command = Command::new(env::current_exe()?);
    command
        .arg("--session-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // setsid is async-signal-safe and detaches from the launching terminal.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::{
            Foundation::{HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation},
            System::Console::{
                GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
            },
        };
        // Windows inherits every inheritable handle, including our own captured
        // stdio, even when the worker has different pipes. Keeping those handles
        // in the worker prevents callers from seeing EOF after this process exits.
        for id in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            // SAFETY: GetStdHandle returns borrowed process handles. We only
            // clear their inheritance flag; we neither close nor replace them.
            unsafe {
                let handle = GetStdHandle(id);
                if !handle.is_null()
                    && handle != INVALID_HANDLE_VALUE
                    && SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) == 0
                {
                    return Err(std::io::Error::last_os_error().into());
                }
            }
        }
        command.creation_flags(0x00000008 | 0x00000200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    }
    let mut child = command.spawn()?;
    let startup = (|| -> Result<(String, String)> {
        send(child.stdin.take().ok_or("missing worker stdin")?, &config)?;
        let reply: Reply = receive(child.stdout.take().ok_or("missing worker stdout")?)?;
        let payload = reply.into_result()?;
        Ok(serde_json::from_str(&payload)?)
    })();
    if startup.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    startup
}

pub(super) fn worker() -> Result<()> {
    let initialized = (|| -> Result<_> {
        let config: Config = receive(std::io::stdin().lock())?;
        let mut state = State::load(&config)?;
        let output = state.apply(&config.request)?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let id = Uuid::new_v4().simple().to_string();
        let record = Record {
            port: listener.local_addr()?.port(),
            token: Uuid::new_v4().to_string(),
        };
        let path = record_path(&id)?;
        let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
        send(&mut file, &record)?;
        file.persist_noclobber(&path)?;
        Ok((state, listener, id, record, Registration(path), output))
    })();
    let (mut state, listener, id, record, registration, output) = match initialized {
        Ok(initialized) => initialized,
        Err(error) => {
            send(std::io::stdout().lock(), &Reply::from_result(Err(error)))?;
            return Ok(());
        }
    };
    send(
        std::io::stdout().lock(),
        &Reply::from_result(Ok(serde_json::to_string(&(id, output))?)),
    )?;
    for connection in listener.incoming() {
        let mut stream = connection?;
        stream.set_read_timeout(Some(IO_TIMEOUT))?;
        stream.set_write_timeout(Some(IO_TIMEOUT))?;
        let request = receive::<Envelope>(&mut stream);
        let mut close = false;
        let mut warning = None;
        let result = (|| -> Result<String> {
            let envelope = request?;
            if envelope.token != record.token {
                return Err("invalid session credentials".into());
            }
            let request = envelope.request;
            let output = state.apply(&request)?;
            if request.close {
                if !request.discard {
                    warning = state
                        .save()
                        .map_err(|error| format!("{error}\nSession remains open."))?;
                }
                close = true;
            }
            Ok(output)
        })();
        if close {
            // Remove discovery before acknowledging shutdown. A successful reply
            // means the save is complete and the session is no longer discoverable.
            fs::remove_file(&registration.0)?;
        }
        // A disconnected caller must not kill the workbook or undo a completed close.
        let mut reply = Reply::from_result(result);
        reply.warning = warning;
        let _ = send(&mut stream, &reply);
        if close {
            break;
        }
    }
    Ok(())
}

struct Registration(PathBuf);
impl Drop for Registration {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(super) fn execute(id: &str, request: &Request) -> Result<String> {
    let path = record_path(id)?;
    let record: Record = serde_json::from_slice(
        &fs::read(&path).map_err(|e| format!("session {id} is unavailable: {e}"))?,
    )?;
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, record.port));
    let mut stream = match TcpStream::connect_timeout(&address, IO_TIMEOUT) {
        Ok(stream) => stream,
        Err(error) => {
            if error.kind() == std::io::ErrorKind::ConnectionRefused {
                let _ = fs::remove_file(&path);
            }
            return Err(format!("session {id} is unavailable: {error}").into());
        }
    };
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    // Scripts and large exports can take arbitrarily long; do not time them out
    // and leave the caller unsure whether an operation completed.
    send(
        &mut stream,
        &serde_json::json!({ "token": record.token, "request": request }),
    )?;
    receive::<Reply>(&mut stream)?.into_result()
}

pub(super) fn close_all(request: &Request) -> Result<()> {
    let mut errors = Vec::new();
    for entry in fs::read_dir(directory()?)? {
        let path = entry?.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        if let Err(error) = execute(id, request) {
            // A refused connection is stale and has already been removed. Failed
            // saves remain registered and are reported after trying every session.
            if path.exists() {
                errors.push(format!("{id}: {error}"));
            }
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("\n").into());
    }
    Ok(())
}

fn send(mut writer: impl Write, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() as u64 >= MAX_MESSAGE {
        return Err("session message exceeds 16 MiB".into());
    }
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn receive<T: DeserializeOwned>(reader: impl Read) -> Result<T> {
    let mut bytes = Vec::new();
    BufReader::new(reader.take(MAX_MESSAGE)).read_until(b'\n', &mut bytes)?;
    if bytes.last() != Some(&b'\n') {
        return Err("incomplete or oversized session message".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}
