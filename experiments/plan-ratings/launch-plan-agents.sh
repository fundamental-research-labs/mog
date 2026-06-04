#!/usr/bin/env bash
#
# Launch Codex or Claude Code planning agents for the Mog codebase review folder queue.
#
# Usage:
#   ./launch-plan-agents.sh --dry-run
#   ./launch-plan-agents.sh --agent codex --jobs 10
#   ./launch-plan-agents.sh --agent claude-code --jobs 25 --resume

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INTERNAL_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WORKSPACE_ROOT="$(cd "$INTERNAL_ROOT/.." && pwd)"
MOG_ROOT="$WORKSPACE_ROOT/mog"

QUEUE_FILE="$SCRIPT_DIR/2026-06-02-mog-codebase-review-folders.md"
AGENT="${AGENT:-codex}"
JOBS=""
JOBS_SET=false
DRY_RUN=false
RESUME=false
OVERWRITE=false
STOP_ON_FAILURE=false
START_AT=1
END_AT=100
MODEL=""
CODEX_BIN="${CODEX_BIN:-codex}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
OUTPUT_DIR=""
LOG_ROOT=""
AGENT_LABEL=""
AGENT_STATUS_PREFIX=""
BASELINE_INTERNAL_STATUS=""

normalize_agent() {
  case "$1" in
    codex)
      printf 'codex'
      ;;
    claude|claude-code|claude_code)
      printf 'claude-code'
      ;;
    *)
      return 1
      ;;
  esac
}

agent_label() {
  case "$1" in
    codex)
      printf 'Codex'
      ;;
    claude-code)
      printf 'Claude Code'
      ;;
  esac
}

default_jobs() {
  case "$1" in
    codex)
      printf '10'
      ;;
    claude-code)
      printf '25'
      ;;
  esac
}

agent_status_prefix() {
  case "$1" in
    codex)
      printf 'codex'
      ;;
    claude-code)
      printf 'claude'
      ;;
  esac
}

refresh_derived_config() {
  AGENT_LABEL="$(agent_label "$AGENT")"
  AGENT_STATUS_PREFIX="$(agent_status_prefix "$AGENT")"
  OUTPUT_DIR="$SCRIPT_DIR/$AGENT-plans"
  LOG_ROOT="$SCRIPT_DIR/$AGENT-agent-logs"

  if [[ "$JOBS_SET" == "false" ]]; then
    JOBS="$(default_jobs "$AGENT")"
  fi
}

if ! AGENT="$(normalize_agent "$AGENT")"; then
  echo "Error: AGENT must be codex or claude-code" >&2
  exit 2
fi

refresh_derived_config

usage() {
  cat <<EOF
Usage:
  $0 [options]

Options:
  --agent NAME         Agent backend: codex or claude-code. Default: $AGENT.
  --codex              Alias for --agent codex.
  --claude-code        Alias for --agent claude-code.
  --jobs N             Number of planning agents to run per batch. Default: $JOBS (codex: 10, claude-code: 25).
  --start N            Start at queue number N. Default: $START_AT.
  --end N              End at queue number N. Default: $END_AT.
  --model MODEL        Pass a model to the selected agent CLI.
  --resume             Skip plans whose target output file already exists.
  --overwrite          Allow agents to overwrite existing target plan files.
  --stop-on-failure    Stop after any batch that has a failed worker.
  --dry-run            Print the planned launches without starting agents.
  -h, --help           Show this help.

Environment:
  AGENT                Default agent backend. Default: codex.
  CODEX_BIN            Codex executable to use. Default: codex.
  CLAUDE_BIN           Claude Code executable to use. Default: claude.

The script parses:
  $QUEUE_FILE

Selected agent:
  $AGENT_LABEL

Agents write plans to:
  $OUTPUT_DIR

Each prompt begins with the requested sentence:
  Can you make a plan to improve Mog's folder: <folder>. Place it in ${OUTPUT_DIR#"$WORKSPACE_ROOT"/} and number it accordingly
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent|--runner|--backend)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "Error: --agent requires codex or claude-code" >&2
        exit 2
      fi
      if ! AGENT="$(normalize_agent "$2")"; then
        echo "Error: --agent requires codex or claude-code" >&2
        exit 2
      fi
      shift 2
      ;;
    --codex)
      AGENT="codex"
      shift
      ;;
    --claude|--claude-code)
      AGENT="claude-code"
      shift
      ;;
    --jobs)
      if [[ $# -lt 2 || ! "$2" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: --jobs requires a positive integer" >&2
        exit 2
      fi
      JOBS="$2"
      JOBS_SET=true
      shift 2
      ;;
    --start)
      if [[ $# -lt 2 || ! "$2" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: --start requires a positive integer" >&2
        exit 2
      fi
      START_AT="$2"
      shift 2
      ;;
    --end)
      if [[ $# -lt 2 || ! "$2" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: --end requires a positive integer" >&2
        exit 2
      fi
      END_AT="$2"
      shift 2
      ;;
    --model)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "Error: --model requires a model name" >&2
        exit 2
      fi
      MODEL="$2"
      shift 2
      ;;
    --resume)
      RESUME=true
      shift
      ;;
    --overwrite)
      OVERWRITE=true
      shift
      ;;
    --stop-on-failure)
      STOP_ON_FAILURE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      refresh_derived_config
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      refresh_derived_config
      usage >&2
      exit 2
      ;;
  esac
done

refresh_derived_config

if [[ "$RESUME" == "true" && "$OVERWRITE" == "true" ]]; then
  echo "Error: --resume and --overwrite are mutually exclusive" >&2
  exit 2
fi

if (( START_AT > END_AT )); then
  echo "Error: --start must be less than or equal to --end" >&2
  exit 2
fi

if [[ ! -f "$QUEUE_FILE" ]]; then
  echo "Error: missing queue file: $QUEUE_FILE" >&2
  exit 1
fi

if [[ ! -d "$MOG_ROOT" ]]; then
  echo "Error: missing public Mog repo: $MOG_ROOT" >&2
  exit 1
fi

if [[ "$DRY_RUN" == "false" ]]; then
  case "$AGENT" in
    codex)
      if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
        echo "Error: Codex CLI not found on PATH: $CODEX_BIN" >&2
        exit 1
      fi
      ;;
    claude-code)
      if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
        echo "Error: Claude Code CLI not found on PATH: $CLAUDE_BIN" >&2
        exit 1
      fi
      ;;
  esac
fi

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

slug_for_folder() {
  printf '%s' "$1" |
    sed -E 's#^mog/##; s#[^A-Za-z0-9]+#-#g; s#^-+##; s#-+$##' |
    tr '[:upper:]' '[:lower:]'
}

make_prompt() {
  local number="$1"
  local folder="$2"
  local description="$3"
  local output_file="$4"
  local rel_output_file="${output_file#"$WORKSPACE_ROOT"/}"
  local rel_output_dir="${OUTPUT_DIR#"$WORKSPACE_ROOT"/}"
  local abs_folder="$WORKSPACE_ROOT/$folder"
  local overwrite_note
  local baseline_status_note

  if [[ "$OVERWRITE" == "true" ]]; then
    overwrite_note="- If the required output file already exists, replace it with the new plan for this run."
  else
    overwrite_note="- The required output file should be new for this run."
  fi

  if [[ -n "$BASELINE_INTERNAL_STATUS" ]]; then
    baseline_status_note="$(cat <<STATUS

Pre-existing dirty status in mog-internal before this worker was launched:
$(printf '%s\n' "$BASELINE_INTERNAL_STATUS")

Do not revert, edit, or count those pre-existing paths as your own changes.
STATUS
)"
  else
    baseline_status_note=""
  fi

  cat <<EOF
Can you make a plan to improve Mog's folder: $folder. Place it in $rel_output_dir and number it accordingly

You are $AGENT_LABEL planning worker $number of 100 for the Mog codebase review folder queue.

Queue item:
- Number: $number
- Folder: $folder
- Description: $description
- Public source folder: $abs_folder
- Required output file: $rel_output_file
$baseline_status_note

Hard constraints:
- Write exactly one Markdown plan file at $rel_output_file.
$overwrite_note
- Do not edit production code, tests, fixtures, configs, package files, lockfiles, generated artifacts, or any files outside $rel_output_file.
- Do not commit, branch, create a worktree, open a PR, run formatters, or run cargo/rustc/pnpm/npm/yarn/build/test/typecheck/verification commands.
- You may inspect source with read-only commands such as rg, sed, git grep, git status, git log, find, ls, and jq.
- Treat $folder as a public Mog source folder; keep internal planning text in mog-internal only.
- Build the right production-path improvement plan. Do not propose reduced scope, test-only fixes, compatibility shims, or temporary workarounds.
- If the folder no longer exists or evidence is insufficient, still write the plan file as a blocked plan that states the missing evidence and smallest investigation needed.

Plan format:
- Title
- Source folder and scope
- Current role of this folder in Mog
- Improvement objectives
- Production-path contracts and invariants to preserve or strengthen
- Concrete implementation plan
- Tests and verification gates
- Risks, edge cases, and non-goals
- Parallelization notes and dependencies on other folders, if any

Before finishing, verify that the only file you changed is $rel_output_file.
EOF
}

NUMBERS=()
FOLDERS=()
DESCRIPTIONS=()
line_re='^([0-9]+)[.] `([^`]*)` - (.*)$'

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ $line_re ]]; then
    number="${BASH_REMATCH[1]}"
    folder="${BASH_REMATCH[2]}"
    description="$(trim "${BASH_REMATCH[3]}")"
    NUMBERS+=("$number")
    FOLDERS+=("$folder")
    DESCRIPTIONS+=("$description")
  fi
done < "$QUEUE_FILE"

if (( ${#NUMBERS[@]} != 100 )); then
  echo "Error: expected 100 queue items, parsed ${#NUMBERS[@]} from $QUEUE_FILE" >&2
  exit 1
fi

SELECTED_INDEXES=()
for i in "${!NUMBERS[@]}"; do
  number="${NUMBERS[$i]}"
  if (( number >= START_AT && number <= END_AT )); then
    SELECTED_INDEXES+=("$i")
  fi
done

if (( ${#SELECTED_INDEXES[@]} == 0 )); then
  echo "Error: no queue items selected for range $START_AT-$END_AT" >&2
  exit 1
fi

for i in "${SELECTED_INDEXES[@]}"; do
  folder="${FOLDERS[$i]}"
  if [[ ! -d "$WORKSPACE_ROOT/$folder" ]]; then
    echo "Error: queue folder does not exist: $WORKSPACE_ROOT/$folder" >&2
    exit 1
  fi
done

PLAN_FILES=()
for i in "${SELECTED_INDEXES[@]}"; do
  number="${NUMBERS[$i]}"
  folder="${FOLDERS[$i]}"
  slug="$(slug_for_folder "$folder")"
  PLAN_FILES+=("$OUTPUT_DIR/$(printf '%03d-%s.md' "$number" "$slug")")
done

for i in "${!PLAN_FILES[@]}"; do
  output_file="${PLAN_FILES[$i]}"
  if [[ -e "$output_file" && "$RESUME" == "false" && "$OVERWRITE" == "false" ]]; then
    echo "Error: target plan already exists: $output_file" >&2
    echo "Use --resume to skip existing plans or --overwrite to rerun them." >&2
    exit 1
  fi
done

RUN_INDEXES=()
for pos in "${!SELECTED_INDEXES[@]}"; do
  output_file="${PLAN_FILES[$pos]}"
  if [[ -s "$output_file" && "$RESUME" == "true" ]]; then
    echo "Skipping existing plan: ${output_file#"$WORKSPACE_ROOT"/}"
    continue
  fi
  RUN_INDEXES+=("$pos")
done

if (( ${#RUN_INDEXES[@]} == 0 )); then
  echo "No agents to launch; every selected plan already exists."
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run: would launch ${#RUN_INDEXES[@]} $AGENT_LABEL planning agent(s) in batches of $JOBS."
  echo "Plans: ${OUTPUT_DIR#"$WORKSPACE_ROOT"/}"
  for pos in "${RUN_INDEXES[@]}"; do
    idx="${SELECTED_INDEXES[$pos]}"
    number="${NUMBERS[$idx]}"
    folder="${FOLDERS[$idx]}"
    output_file="${PLAN_FILES[$pos]}"
    printf '%03d %s -> %s\n' "$number" "$folder" "${output_file#"$WORKSPACE_ROOT"/}"
  done
  exit 0
fi

mkdir -p "$OUTPUT_DIR" "$LOG_ROOT"
RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
LOG_DIR="$LOG_ROOT/$RUN_ID"
mkdir -p "$LOG_DIR"
BASELINE_INTERNAL_STATUS="$(git -C "$INTERNAL_ROOT" status --short)"

echo "Launching ${#RUN_INDEXES[@]} $AGENT_LABEL planning agent(s) in batches of $JOBS."
echo "Workspace: $WORKSPACE_ROOT"
echo "Plans: ${OUTPUT_DIR#"$WORKSPACE_ROOT"/}"
echo "Logs: ${LOG_DIR#"$WORKSPACE_ROOT"/}"

run_planning_cli() {
  local prompt_file="$1"
  local log_file="$2"
  local last_message_file="$3"

  case "$AGENT" in
    codex)
      local codex_args=(
        exec
        --dangerously-bypass-approvals-and-sandbox
        --skip-git-repo-check
        -C "$WORKSPACE_ROOT"
        -o "$last_message_file"
      )
      if [[ -n "$MODEL" ]]; then
        codex_args+=(--model "$MODEL")
      fi
      "$CODEX_BIN" "${codex_args[@]}" - < "$prompt_file" > "$log_file" 2>&1
      ;;
    claude-code)
      local claude_args=(
        --dangerously-skip-permissions
        --no-session-persistence
        -p
      )
      if [[ -n "$MODEL" ]]; then
        claude_args+=(--model "$MODEL")
      fi
      (cd "$WORKSPACE_ROOT" && "$CLAUDE_BIN" "${claude_args[@]}" < "$prompt_file") > "$log_file" 2>&1
      ;;
  esac
}

run_agent() {
  local pos="$1"
  local idx="${SELECTED_INDEXES[$pos]}"
  local number="${NUMBERS[$idx]}"
  local folder="${FOLDERS[$idx]}"
  local description="${DESCRIPTIONS[$idx]}"
  local output_file="${PLAN_FILES[$pos]}"
  local slug
  local prompt_file
  local log_file
  local last_message_file
  local status_file
  local exit_file

  slug="$(slug_for_folder "$folder")"
  prompt_file="$LOG_DIR/$(printf '%03d-%s.prompt.txt' "$number" "$slug")"
  log_file="$LOG_DIR/$(printf '%03d-%s.log' "$number" "$slug")"
  last_message_file="$LOG_DIR/$(printf '%03d-%s.last-message.md' "$number" "$slug")"
  status_file="$LOG_DIR/$(printf '%03d-%s.status' "$number" "$slug")"
  exit_file="$LOG_DIR/$(printf '%03d-%s.exit' "$number" "$slug")"

  if [[ "$OVERWRITE" == "true" && -e "$output_file" ]]; then
    : > "$output_file"
  fi

  make_prompt "$number" "$folder" "$description" "$output_file" > "$prompt_file"

  echo "[$(printf '%03d' "$number")] starting $folder"

  if run_planning_cli "$prompt_file" "$log_file" "$last_message_file"; then
    if [[ -s "$output_file" ]]; then
      echo "ok" > "$status_file"
      echo "0" > "$exit_file"
      echo "[$(printf '%03d' "$number")] wrote ${output_file#"$WORKSPACE_ROOT"/}"
      return 0
    fi
    echo "missing-output" > "$status_file"
    echo "1" > "$exit_file"
    echo "[$(printf '%03d' "$number")] failed: missing output ${output_file#"$WORKSPACE_ROOT"/}" >&2
    return 1
  else
    local code=$?
    echo "$AGENT_STATUS_PREFIX-exit-$code" > "$status_file"
    echo "$code" > "$exit_file"
    echo "[$(printf '%03d' "$number")] failed: $AGENT_LABEL exited $code" >&2
    return "$code"
  fi
}

FAILURES=0
BATCH=1
TOTAL="${#RUN_INDEXES[@]}"
offset=0

while (( offset < TOTAL )); do
  PIDS=()
  BATCH_FAILURES=0
  batch_start=$((offset + 1))
  batch_end=$((offset + JOBS))
  if (( batch_end > TOTAL )); then
    batch_end="$TOTAL"
  fi

  echo
  echo "Batch $BATCH: launching items $batch_start-$batch_end of $TOTAL"
  count=0
  while (( count < JOBS && offset < TOTAL )); do
    run_agent "${RUN_INDEXES[$offset]}" &
    PIDS+=("$!")
    offset=$((offset + 1))
    count=$((count + 1))
  done

  for pid in "${PIDS[@]}"; do
    if ! wait "$pid"; then
      BATCH_FAILURES=$((BATCH_FAILURES + 1))
    fi
  done

  if (( BATCH_FAILURES > 0 )); then
    FAILURES=$((FAILURES + BATCH_FAILURES))
    echo "Batch $BATCH finished with $BATCH_FAILURES failure(s)." >&2
    if [[ "$STOP_ON_FAILURE" == "true" ]]; then
      echo "Stopping because --stop-on-failure was set." >&2
      break
    fi
  else
    echo "Batch $BATCH finished successfully."
  fi

  BATCH=$((BATCH + 1))
done

echo
echo "$AGENT_LABEL plan-agent run complete."
echo "Logs: $LOG_DIR"
echo "Plans: $OUTPUT_DIR"

if (( FAILURES > 0 )); then
  echo "Failures: $FAILURES" >&2
  exit 1
fi

echo "Failures: 0"
