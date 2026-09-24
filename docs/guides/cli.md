# CLI reference

Running `mog` with no arguments shows help without creating a file.
For workbook operations, Mog starts blank unless `-i` / `--input` is supplied. It saves
in place when an input is supplied; `-o` / `--output` chooses another destination.
Without either path, it saves in the current directory with the first available
name: `workbook.xlsx`, `workbook-2.xlsx`, `workbook-3.xlsx`, and so on. Existing
automatic filenames are never overwritten, including concurrent invocations.

```bash
mog                                      # show help
mog -o workbook.xlsx                     # create a blank workbook
mog -i input.xlsx                         # open and save in place
mog -i input.xlsx -o copy.xlsx            # save a copy
mog -i input.xlsx -r                      # recalculate and save in place
mog -i input.xlsx -f script.js            # run a script file, then save
mog -e 'console.log("hello")' -o new.xlsx  # run inline JavaScript
mog --help
mog --version
```

`-e` / `--eval` takes inline JavaScript; `-f` / `--file` loads a script file.
Use `--file=-script.js` for a filename beginning with `-`. Opening and saving without
a script preserves imported formula caches. `-r` / `--recalculate` evaluates
formulas before export. Scripts automatically trigger full recalculation after
they finish, including workbooks imported in manual calculation mode. Within a
script, `context.sync()` retains the Office.js calculation behavior.

Exports finish serialization before touching an explicit destination, so a
serialization failure does not truncate the input. Mog first tries atomic rename.
If the filesystem does not support it, or the move crosses filesystems, Mog
copies the completed file sequentially, syncs the destination, then removes the
temporary source. A warning on stderr identifies this non-atomic fallback:
transfer failures can leave an incomplete destination. Other errors, including
permission failures, are reported without retrying as a copy. Temporary files
are staged beside the destination where supported, otherwise in the host's
standard temporary directory (respecting its temporary-directory configuration).
Permission bits are preserved where supported; bucket mounts can use fixed modes.
This applies to explicit paths, automatic filenames, and session saves. A writable
bucket mount must also allow overwriting to replace an existing file.

Script failures do not save the workbook. Script
console output is printed once; a non-null return value is printed as JSON if
there was no console output.

### Sessions

Start a session with `-s` / `--session`. This launches
a detached background process that keeps the workbook in memory and prints its
ID. Pass the ID to later invocations:

```bash
ID=$(mog -s -i input.xlsx)
mog -s "$ID" -e 'await Excel.run(async c => {
  c.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [[42]];
  await c.sync();
});'
mog -s "$ID" -f another-script.js
mog -s "$ID" --close                       # save and end the session
```

| Action | Command |
| --- | --- |
| Save to another path and end | `mog -s ID --close -o result.xlsx` |
| End without saving | `mog -s ID --close --discard` |
| Save and end every session | `mog --close-all` |
| End every session without saving | `mog --close-all --discard` |

A session writes no workbook file until closed. Its default output is the input
path, or an available `workbook*.xlsx` in the directory where it started. `-o`
changes the session's destination; relative paths are resolved from the caller's
current directory. The automatic filename is selected at save time. `--input`
is only valid when starting a session. A script may also run during startup;
its output goes to stderr so stdout contains only the ID.

Requests to a session run sequentially. Workbook state persists; each script has
a fresh JavaScript scope. A script error leaves the session alive, and earlier
successful `context.sync()` calls remain applied. A failed save also leaves the
session alive so you can retry with another output path. Closing all sessions
attempts each one and reports failures without discarding unsaved workbooks.
Sessions survive the launching shell, but their unsaved contents do not survive
a process crash or reboot.

Sessions use authenticated loopback connections and a private registry under
`~/.mog/sessions` (`%USERPROFILE%\.mog\sessions` on Windows). `MOG_SESSION_DIR`
can select another private directory, including for isolated test runs.
`--close-all` covers sessions in that registry. Stale records from crashed
workers are removed when a connection is refused.
