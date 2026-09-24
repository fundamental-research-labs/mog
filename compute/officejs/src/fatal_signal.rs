//! Capture SIGBUS and SIGSEGV into the diagnostics file, then re-raise.
//!
//! A fatal signal never runs `Drop`, so the open stage stays `started`. This
//! handler appends the fault address and instruction pointers. `SA_RESETHAND`
//! restores the default action before the handler runs, and the handler raises
//! the same signal again so the shell still reports it.

#[cfg(unix)]
use std::{
    cell::UnsafeCell,
    env,
    os::unix::ffi::OsStrExt,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering, compiler_fence},
};

/// Install process-wide handlers for `SIGBUS` and `SIGSEGV`.
///
/// A fatal signal never runs [`Drop`], so the open stage stays `started`. The
/// handler appends the fault address and instruction pointers, then restores
/// the default action and re-raises so the shell still reports the signal.
#[cfg(unix)]
pub(crate) fn install_fatal_signal_handlers() {
    cache_diagnostics_path();
    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = handle_fatal_signal as *const () as usize;
        action.sa_flags = libc::SA_SIGINFO | libc::SA_RESETHAND | libc::SA_NODEFER;
        libc::sigemptyset(&mut action.sa_mask);
        libc::sigaction(libc::SIGBUS, &action, std::ptr::null_mut());
        libc::sigaction(libc::SIGSEGV, &action, std::ptr::null_mut());
    }
}

#[cfg(not(unix))]
pub(crate) fn install_fatal_signal_handlers() {}

/// Debug builds only. Used by the CLI test to prove the handler runs inside `mog`.
pub(crate) fn raise_configured_self_test() {
    #[cfg(all(unix, debug_assertions))]
    {
        let Ok(value) = env::var("MOG_DIAGNOSTICS_SELF_TEST") else {
            return;
        };
        let signal = match value.as_str() {
            "sigbus" => libc::SIGBUS,
            "sigsegv" => libc::SIGSEGV,
            _ => return,
        };
        unsafe { libc::raise(signal) };
    }
}

#[cfg(unix)]
const FRAME_LIMIT: usize = 48;

#[cfg(unix)]
struct DiagnosticsPath {
    bytes: UnsafeCell<[u8; 4096]>,
    len: AtomicUsize,
}

#[cfg(unix)]
unsafe impl Sync for DiagnosticsPath {}

#[cfg(unix)]
static DIAGNOSTICS_PATH: DiagnosticsPath = DiagnosticsPath {
    bytes: UnsafeCell::new([0; 4096]),
    len: AtomicUsize::new(0),
};

#[cfg(unix)]
static HANDLER_ENTERED: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
fn cache_diagnostics_path() {
    let Some(path) = env::var_os("MOG_DIAGNOSTICS_FILE").filter(|path| !path.is_empty()) else {
        return;
    };
    let bytes = path.as_bytes();
    // Leave room for the terminating NUL passed to open().
    if bytes.len() >= 4095 {
        return;
    }
    unsafe {
        let dest = &mut *DIAGNOSTICS_PATH.bytes.get();
        dest[..bytes.len()].copy_from_slice(bytes);
        dest[bytes.len()] = 0;
    }
    compiler_fence(Ordering::Release);
    DIAGNOSTICS_PATH.len.store(bytes.len(), Ordering::Release);
}

#[cfg(unix)]
extern "C" fn handle_fatal_signal(
    signal: libc::c_int,
    info: *mut libc::siginfo_t,
    _context: *mut libc::c_void,
) {
    // SA_RESETHAND already restored SIG_DFL. A nested fault, or a second entry,
    // must die with the default action instead of looping in this handler.
    if HANDLER_ENTERED.swap(true, Ordering::Relaxed) {
        unsafe { libc::raise(signal) };
        return;
    }
    let address = unsafe {
        info.as_ref()
            .map(|info| info.si_addr())
            .unwrap_or(std::ptr::null_mut())
    };
    let mut frames = [std::ptr::null_mut(); FRAME_LIMIT];
    let count = unsafe { backtrace(frames.as_mut_ptr(), FRAME_LIMIT as libc::c_int) };
    let count = count.max(0) as usize;
    let record = format_fault_record(signal, address, &frames[..count.min(FRAME_LIMIT)]);
    write_stderr(&record);
    append_diagnostics_file(&record);
    unsafe { libc::raise(signal) };
}

#[cfg(unix)]
unsafe extern "C" {
    fn backtrace(buffer: *mut *mut libc::c_void, size: libc::c_int) -> libc::c_int;
}

#[cfg(unix)]
fn format_fault_record(
    signal: libc::c_int,
    address: *mut libc::c_void,
    frames: &[*mut libc::c_void],
) -> [u8; 4096] {
    let mut buf = [0u8; 4096];
    let mut len = 0;
    let status = if signal == libc::SIGBUS {
        "sigbus"
    } else {
        "sigsegv"
    };
    push(&mut buf, &mut len, b"{\"timestamp_ms\":");
    push_u64(&mut buf, &mut len, unix_time_ms());
    push(&mut buf, &mut len, b",\"pid\":");
    push_u64(&mut buf, &mut len, unsafe { libc::getpid() } as u64);
    push(
        &mut buf,
        &mut len,
        b",\"stage\":\"native_fault\",\"status\":\"",
    );
    push(&mut buf, &mut len, status.as_bytes());
    push(&mut buf, &mut len, b"\",\"signal\":");
    push_u64(&mut buf, &mut len, signal as u64);
    push(&mut buf, &mut len, b",\"fault_address\":\"");
    push_ptr(&mut buf, &mut len, address);
    push(&mut buf, &mut len, b"\",\"backtrace\":[");
    for (index, frame) in frames.iter().enumerate() {
        let mut next = len;
        if index > 0 {
            push(&mut buf, &mut next, b",");
        }
        push(&mut buf, &mut next, b"\"");
        push_ptr(&mut buf, &mut next, *frame);
        push(&mut buf, &mut next, b"\"");
        // Keep the closing bytes reserved so a long trace stays valid JSON.
        // `push` may have written past `len`; rewind those bytes if they do not fit.
        if next + 4 >= buf.len() {
            let end = next.min(buf.len());
            buf[len..end].fill(0);
            break;
        }
        len = next;
    }
    push(&mut buf, &mut len, b"]}\n");
    if len < buf.len() {
        buf[len] = 0;
    }
    buf
}

#[cfg(unix)]
fn push(buf: &mut [u8], len: &mut usize, src: &[u8]) {
    let room = buf.len().saturating_sub(*len + 1);
    let n = src.len().min(room);
    buf[*len..*len + n].copy_from_slice(&src[..n]);
    *len += n;
}

#[cfg(unix)]
fn push_u64(buf: &mut [u8], len: &mut usize, mut value: u64) {
    let mut digits = [0u8; 20];
    let mut count = 0;
    loop {
        digits[count] = b'0' + (value % 10) as u8;
        count += 1;
        value /= 10;
        if value == 0 {
            break;
        }
    }
    while count > 0 {
        count -= 1;
        push(buf, len, &digits[count..count + 1]);
    }
}

#[cfg(unix)]
fn push_ptr(buf: &mut [u8], len: &mut usize, ptr: *mut libc::c_void) {
    push(buf, len, b"0x");
    let value = ptr as usize;
    if value == 0 {
        push(buf, len, b"0");
        return;
    }
    let mut digits = [0u8; 16];
    let mut count = 0;
    let mut rest = value;
    while rest > 0 {
        let nibble = (rest & 0xf) as u8;
        digits[count] = if nibble < 10 {
            b'0' + nibble
        } else {
            b'a' + (nibble - 10)
        };
        count += 1;
        rest >>= 4;
    }
    while count > 0 {
        count -= 1;
        push(buf, len, &digits[count..count + 1]);
    }
}

#[cfg(unix)]
fn unix_time_ms() -> u64 {
    let mut time = unsafe { std::mem::zeroed() };
    if unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, &mut time) } != 0 {
        return 0;
    }
    time.tv_sec as u64 * 1000 + time.tv_nsec as u64 / 1_000_000
}

#[cfg(unix)]
fn record_len(record: &[u8]) -> usize {
    record
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(record.len())
}

#[cfg(unix)]
fn write_stderr(record: &[u8]) {
    write_fd(libc::STDERR_FILENO, record);
}

#[cfg(unix)]
fn append_diagnostics_file(record: &[u8]) {
    let path_len = DIAGNOSTICS_PATH.len.load(Ordering::Acquire);
    if path_len == 0 {
        return;
    }
    let fd = unsafe {
        libc::open(
            DIAGNOSTICS_PATH.bytes.get() as *const libc::c_char,
            libc::O_WRONLY | libc::O_CREAT | libc::O_APPEND | libc::O_CLOEXEC,
            0o644,
        )
    };
    if fd < 0 {
        return;
    }
    write_fd(fd, record);
    unsafe { libc::close(fd) };
}

#[cfg(unix)]
fn write_fd(fd: libc::c_int, record: &[u8]) {
    let bytes = &record[..record_len(record)];
    let mut offset = 0;
    while offset < bytes.len() {
        let wrote = unsafe {
            libc::write(
                fd,
                bytes[offset..].as_ptr() as *const libc::c_void,
                bytes.len() - offset,
            )
        };
        if wrote < 0 {
            let err = errno::errno().0;
            if err == libc::EINTR {
                continue;
            }
            break;
        }
        if wrote == 0 {
            break;
        }
        offset += wrote as usize;
    }
}
