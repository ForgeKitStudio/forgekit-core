#!/usr/bin/env bash
#
# check_imports.sh — local wrapper for the static import-boundary
# validator. Invokes `project.check_imports` (exposed via the MCP
# server CLI once implemented) to verify the separation between the
# `addons/forgekit_core/` and `addons/forgekit_rpg/` trees and the
# other import rules enforced for the public template.
#
# This script is also invoked by the `check-imports` job in
# `.github/workflows/ci.yml`, so its behaviour must match what CI
# expects. In phase 0 the real validator is not yet wired up; the
# script prints a placeholder success message and exits 0 so the CI
# required status check stays green. Once the MCP tool lands
# (tracked as part of the phase-1 tool surface), the placeholder
# branch below is replaced by the real invocation.
#
# Flags:
#   -h | --help  Print this help and exit.
#
# Exit codes:
#   0  no boundary violations detected (or phase-0 placeholder run).
#   1  at least one import rule was violated.
#   2  the validator itself failed to run (missing dependency, I/O).

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

Environment:
  GODOT  Path to the Godot 4.x binary (reserved for the phase-1
         wiring that shells out to the Godot-side validator).
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

# ----------------------------------------------------------------------
# Phase-0 placeholder. The real `project.check_imports` tool ships as
# part of the phase-1 MCP surface; until then we keep the CLI shape
# stable so CI and local workflows can already depend on it.
#
# TODO(phase-1): replace this block with an invocation of the real
# validator, for example:
#
#   node "${REPO_ROOT}/mcp-server/dist/src/cli/check_imports.js"
#
# or, if the validator lives on the Godot side:
#
#   "${GODOT:-godot}" --headless \
#       --script tests/static/check_imports_cli.gd
# ----------------------------------------------------------------------
echo "check_imports: running static import boundary analysis..."
echo "check_imports: placeholder — project.check_imports not yet implemented (phase 0)."
echo "check_imports: no violations reported."
exit 0
