#!/usr/bin/env bash
#
# check_imports.sh — local wrapper for the static import-boundary
# validator. Invokes the Node-only driver `tools/run_check_imports.mjs`
# which loads the compiled `project.check_imports` tool from
# `mcp-server/dist/src/tools/project/check_imports.js` and runs it
# against the repository root. Any cross-module import that violates
# rule 1.2 (Core -> forgekit_<module>) or rule 1.3 (forgekit_rpg
# subsystem -> non-public API) is printed to stdout and the script
# exits non-zero.
#
# The script is also invoked by the `check-imports` job in
# `.github/workflows/ci.yml`. CI builds `mcp-server` first and then
# calls this wrapper.
#
# Flags:
#   -h | --help  Print this help and exit.
#
# Exit codes:
#   0  no boundary violations detected.
#   1  at least one import rule was violated.
#   2  the Node driver or build artefact could not be found / invoked.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
    cat <<'EOF'
Usage: check_imports.sh [options]

Runs the static import-boundary validator (`project.check_imports`)
against the ForgeKit Core repository and fails on any rule violation.

Options:
  -h, --help  Show this help message and exit.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
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

cd "${REPO_ROOT}"

driver="tools/run_check_imports.mjs"
if [ ! -f "${driver}" ]; then
    echo "check_imports: missing ${driver}" >&2
    exit 2
fi

compiled="mcp-server/dist/src/tools/project/check_imports.js"
if [ ! -f "${compiled}" ]; then
    echo "check_imports: compiled tool missing — run 'npm --prefix mcp-server run build' first" >&2
    exit 2
fi

exec node "${driver}"
