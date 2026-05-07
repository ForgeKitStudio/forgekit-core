#!/usr/bin/env bash
#
# run_tests.sh — local helper that runs the full ForgeKit Core test
# matrix on a developer machine, outside of CI. Mirrors the commands
# executed by the `tests-unit`, `tests-property`, and `check-imports`
# jobs in `.github/workflows/ci.yml`, but makes them easy to invoke
# locally in any combination.
#
# Phases (executed in order, fail-fast):
#   1. GUT unit tests           (godot --headless ... tests/unit)
#   2. GUT property suites      (godot --headless ... tests/property)
#   3. MCP server unit + PBT    (cd mcp-server && npm test)
#   4. Static import boundary   (./tools/cli_runner/check_imports.sh)
#
# Flags:
#   --unit-only         Run phase 1 only (GUT unit tests).
#   --property-only     Run phase 2 only (GUT property suites).
#   --mcp-only          Run phase 3 only (MCP server tests via Vitest).
#   --no-check-imports  Skip phase 4 (static import boundary check).
#   -h | --help         Print this help and exit.
#
# Exit codes:
#   0  all selected phases passed.
#   1  at least one phase failed (including a boundary violation).
#   2  a required toolchain dependency is missing (Godot or Node).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

GODOT_BIN="${GODOT:-godot}"
GUT_SCRIPT="addons/gut/gut_cmdln.gd"

run_unit=1
run_property=1
run_mcp=1
run_check_imports=1

usage() {
    cat <<'EOF'
Usage: run_tests.sh [options]

Runs the ForgeKit Core test matrix locally. By default all phases run
in order (unit → property → mcp → check-imports) and abort on the
first failure.

Options:
  --unit-only         Run GUT unit tests only.
  --property-only     Run GUT property (CoreFuzz) suites only.
  --mcp-only          Run MCP server tests (Vitest + fast-check) only.
  --no-check-imports  Skip the static import boundary check.
  -h, --help          Show this help message and exit.

Environment:
  GODOT  Path to the Godot 4.x binary to use (default: "godot" on PATH).
EOF
}

# ----------------------------------------------------------------------
# Argument parsing. The three *-only flags are mutually exclusive; the
# last one on the command line wins, but we first clear all three and
# then re-enable the requested phase so the behaviour is unambiguous.
# ----------------------------------------------------------------------
only_mode=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --unit-only)
            only_mode="unit"
            ;;
        --property-only)
            only_mode="property"
            ;;
        --mcp-only)
            only_mode="mcp"
            ;;
        --no-check-imports)
            run_check_imports=0
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "error: unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if [ -n "$only_mode" ]; then
    run_unit=0
    run_property=0
    run_mcp=0
    case "$only_mode" in
        unit)     run_unit=1 ;;
        property) run_property=1 ;;
        mcp)      run_mcp=1 ;;
    esac
fi

# ----------------------------------------------------------------------
# Toolchain probes. We only require a tool when a phase that needs it
# is actually scheduled to run, so --mcp-only works on a machine with
# no Godot installation and vice versa.
# ----------------------------------------------------------------------
require_godot() {
    if ! command -v "${GODOT_BIN}" >/dev/null 2>&1; then
        cat >&2 <<EOF
error: Godot binary not found on PATH (looked for: ${GODOT_BIN}).

Install Godot 4.3+ from https://godotengine.org/download and either
add it to PATH or set the GODOT environment variable to the absolute
path of the binary, for example:

    GODOT=/opt/godot/godot.x11.opt.tools.64 ./tools/cli_runner/run_tests.sh
EOF
        exit 2
    fi
}

require_node() {
    if ! command -v node >/dev/null 2>&1; then
        cat >&2 <<'EOF'
error: Node.js not found on PATH.

Install Node.js 20 or newer from https://nodejs.org/ and make sure
`node` and `npm` are available before running the MCP test suite.
EOF
        exit 2
    fi
    if ! command -v npm >/dev/null 2>&1; then
        echo "error: npm not found on PATH (Node.js installation is incomplete)." >&2
        exit 2
    fi
}

# ----------------------------------------------------------------------
# Phase runners. Each prints a banner, runs its command against the
# repository root, and returns the underlying exit code so the
# top-level `set -e` can abort the run.
# ----------------------------------------------------------------------
phase_unit() {
    echo "==> [1/4] Running GUT unit tests..."
    if [ ! -f "${REPO_ROOT}/${GUT_SCRIPT}" ]; then
        echo "    skipped — ${GUT_SCRIPT} not present yet (phase 0 placeholder)."
        return 0
    fi
    if [ ! -d "${REPO_ROOT}/tests/unit" ]; then
        echo "    skipped — tests/unit/ directory not present yet (phase 0 placeholder)."
        return 0
    fi
    require_godot
    ( cd "${REPO_ROOT}" && "${GODOT_BIN}" --headless --script "${GUT_SCRIPT}" -gdir=tests/unit )
}

phase_property() {
    echo "==> [2/4] Running GUT property (CoreFuzz) suites..."
    if [ ! -f "${REPO_ROOT}/${GUT_SCRIPT}" ]; then
        echo "    skipped — ${GUT_SCRIPT} not present yet (phase 0 placeholder)."
        return 0
    fi
    if [ ! -d "${REPO_ROOT}/tests/property" ]; then
        echo "    skipped — tests/property/ directory not present yet (phase 0 placeholder)."
        return 0
    fi
    require_godot
    ( cd "${REPO_ROOT}" && "${GODOT_BIN}" --headless --script "${GUT_SCRIPT}" -gdir=tests/property )
}

phase_mcp() {
    echo "==> [3/4] Running MCP server tests (Vitest + fast-check)..."
    require_node
    if [ ! -f "${REPO_ROOT}/mcp-server/package.json" ]; then
        echo "error: mcp-server/package.json not found under ${REPO_ROOT}." >&2
        return 1
    fi
    if [ ! -d "${REPO_ROOT}/mcp-server/node_modules" ]; then
        echo "    installing MCP server dependencies (npm ci)..."
        ( cd "${REPO_ROOT}/mcp-server" && npm ci --silent )
    fi
    ( cd "${REPO_ROOT}/mcp-server" && npm test --silent )
}

phase_check_imports() {
    echo "==> [4/4] Running static import boundary check..."
    local script="${SCRIPT_DIR}/check_imports.sh"
    if [ ! -f "${script}" ]; then
        echo "error: ${script} not found." >&2
        return 1
    fi
    if [ -x "${script}" ]; then
        "${script}"
    else
        bash "${script}"
    fi
}

# ----------------------------------------------------------------------
# Orchestration. A trap on ERR records the first failing phase name so
# the summary line is informative even under `set -e`.
# ----------------------------------------------------------------------
failed_phase=""
trap 'failed_phase="${current_phase:-unknown}"' ERR

current_phase="unit"
if [ "${run_unit}" -eq 1 ]; then
    phase_unit
fi

current_phase="property"
if [ "${run_property}" -eq 1 ]; then
    phase_property
fi

current_phase="mcp"
if [ "${run_mcp}" -eq 1 ]; then
    phase_mcp
fi

current_phase="check-imports"
if [ "${run_check_imports}" -eq 1 ]; then
    phase_check_imports
fi

trap - ERR

if [ -n "${failed_phase}" ]; then
    echo ""
    echo "==> FAILED during phase: ${failed_phase}"
    exit 1
fi

echo ""
echo "==> All selected phases passed."
