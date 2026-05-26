#!/bin/bash
# XLSX Round-Trip Testing Script
#
# Usage:
#   ./scripts/roundtrip.sh <xlsx-file>           # Single file test
#   ./scripts/roundtrip.sh <xlsx-file> -b        # Benchmark mode
#   ./scripts/roundtrip.sh <directory>           # Test all xlsx files in directory
#   ./scripts/roundtrip.sh --all                 # Test all fixture files
#
# Options:
#   -b, --benchmark     Run in benchmark mode
#   -v, --verbose       Verbose output
#   -o, --output <dir>  Save round-tripped files to directory
#   --all               Test all fixture files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# Cargo workspace artifacts land in the workspace-root target-native/ dir
# (set by `<workspace>/.cargo/config.toml`), not the per-member crate dir.
WORKSPACE_DIR="$(cd "$PROJECT_DIR/../../.." && pwd)"
BINARY="$WORKSPACE_DIR/target-native/aarch64-apple-darwin/release/xlsx-roundtrip"
FIXTURE_DIRS=(
    "$PROJECT_DIR/../file-io/__tests__/fixtures"
    "$PROJECT_DIR/../performance/fixtures"
)

# Build if necessary
if [ ! -f "$BINARY" ]; then
    echo "Building xlsx-roundtrip..."
    cd "$PROJECT_DIR"
    cargo build --features cli --bin xlsx-roundtrip --target aarch64-apple-darwin --release
fi

# Parse arguments
BENCHMARK=""
VERBOSE=""
OUTPUT_DIR=""
INPUT=""
ALL_FIXTURES=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--benchmark)
            BENCHMARK="-b"
            shift
            ;;
        -v|--verbose)
            VERBOSE="-v"
            shift
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --all)
            ALL_FIXTURES="true"
            shift
            ;;
        *)
            INPUT="$1"
            shift
            ;;
    esac
done

# Function to test a single file
test_file() {
    local file="$1"
    local output_opt=""

    if [ -n "$OUTPUT_DIR" ]; then
        local basename=$(basename "$file")
        output_opt="-o $OUTPUT_DIR/$basename"
    fi

    "$BINARY" "$file" $BENCHMARK $VERBOSE $output_opt
}

# Function to test all files in a directory
test_directory() {
    local dir="$1"
    local count=0
    local passed=0
    local failed=0

    echo "Testing all XLSX files in: $dir"
    echo "=========================================="

    for file in "$dir"/*.xlsx; do
        if [ -f "$file" ]; then
            count=$((count + 1))
            echo ""
            echo "[$count] Testing: $(basename "$file")"
            if "$BINARY" "$file" $VERBOSE; then
                passed=$((passed + 1))
            else
                failed=$((failed + 1))
            fi
        fi
    done

    echo ""
    echo "=========================================="
    echo "Results: $passed passed, $failed failed (out of $count files)"

    if [ $failed -gt 0 ]; then
        return 1
    fi
}

# Main logic
if [ -n "$ALL_FIXTURES" ]; then
    # Test all fixture directories
    total_passed=0
    total_failed=0

    for dir in "${FIXTURE_DIRS[@]}"; do
        if [ -d "$dir" ]; then
            test_directory "$dir"
        fi
    done
elif [ -z "$INPUT" ]; then
    echo "Usage: $0 <xlsx-file|directory> [options]"
    echo ""
    echo "Options:"
    echo "  -b, --benchmark     Run in benchmark mode"
    echo "  -v, --verbose       Verbose output"
    echo "  -o, --output <dir>  Save round-tripped files to directory"
    echo "  --all               Test all fixture files"
    exit 1
elif [ -d "$INPUT" ]; then
    test_directory "$INPUT"
elif [ -f "$INPUT" ]; then
    test_file "$INPUT"
else
    echo "Error: File or directory not found: $INPUT"
    exit 1
fi
