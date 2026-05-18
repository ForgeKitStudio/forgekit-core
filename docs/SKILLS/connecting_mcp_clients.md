---
skill: connecting-mcp-clients
title: Connecting an LLM client to ForgeKit MCP and discovering its tools
api_version: 0.9.0
updated: 2026-05-16
---

# Connecting an LLM client to ForgeKit MCP and discovering its tools

Use this skill when the user wants to attach a new LLM client (Claude
Desktop, Cursor, Kiro, Antigravity, or any other MCP-aware shell) to a
ForgeKit project and confirm the agent can see the full tool surface
exposed by `@forgekitstudio/core-mcp`. The skill walks through the
canonical `tools/list` → `tools/call` sequence the MCP SDK uses and
points at the per-category sample output an agent can expect when the
server runs in `--profile Full`.

The skill covers:

- Picking the right transport (stdio is the only client-facing option;
  WebSocket and UDP run between the server and Godot).
- Registering the server in the client's MCP config file.
- Calling `tools/list` to enumerate the active tool surface.
- Reading the response shape and channel attribute for any tool.
- Calling `tools/call` against a representative read-only tool and
  reading the canonical success / failure envelopes.

## When to invoke

Trigger this skill when the user asks one of:

- "How do I hook up Claude Desktop / Cursor / Kiro / Antigravity to
  ForgeKit?"
- "Why doesn't my agent see any ForgeKit tools?"
- "Show me the tool surface ForgeKit exposes."
- "What's the difference between editor / runtime / cli / cross
  channels?"

Do not invoke this skill for license activation flows — use
[`module_licensing.md`](./module_licensing.md) instead.

## Background: what ForgeKit MCP exposes

`@forgekitstudio/core-mcp` ships a single server binary that
multiplexes 271 tools across four channels at `--profile Full`
(`mcp-server/profiles.json`):

| Channel  | Count | Examples                                                   |
| -------- | ----- | ---------------------------------------------------------- |
| `editor` | 154   | `scene.open`, `node.set_property`, `resource.save`         |
| `runtime`| 99    | `runtime.get_logs`, `physics_runtime.raycast`              |
| `cli`    | 13    | `tests.run_unit`, `export.run_preset`, `android.list_devices` |
| `cross`  | 5     | `runtime.handshake`, `runtime.heartbeat`, `runtime.is_connected`, `runtime.shutdown`, `input.list_actions` |

Profile filtering and module licensing further narrow the active set:

- `--profile Minimal` exposes ~21 `core-minimal` tools (always
  available, no license required).
- `--profile Lite` adds the rest of `core` for ~194 tools.
- `--profile Full` adds every module the active license set unlocks.
- `--profile RPG-only` exposes `core-minimal` plus the fifteen RPG
  subsystem categories once `forgekit_rpg.key` is present in the
  license directory.

Tools the active profile or license set hides from the response are
still callable through `tools/call`, but the dispatcher returns
`-32024 PROFILE_TOOL_FILTERED` so the agent can prompt the user to
switch profile or activate the license.

## MCP tool call sequence

Execute these calls in order. Stop on the first error and report the
server response verbatim to the user.

### 1. Confirm the server binary is reachable

Ask the user (or the shell) to run:

```sh
npx -y @forgekitstudio/core-mcp --stdio --profile Full
```

The server exits immediately if stdin closes. The readiness banner on
stderr is:

```
[mcp] stdio bridge ready (profile=Full, tools=271)
```

`tools=271` is the `Full` profile snapshot at v0.9.x; lower numbers
indicate the active license set unlocks fewer modules, or the
`--profile` flag selects a smaller subset.

### 2. Register the server in the client's MCP config

Pick the snippet that matches the user's client. Each one points at
`npx` so the binary is fetched on demand without a global install.

**Claude Desktop** —
`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "forgekit": {
      "command": "npx",
      "args": ["-y", "@forgekitstudio/core-mcp", "--stdio", "--profile", "Full"]
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json` or `<projectRoot>/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "forgekit": {
      "command": "npx",
      "args": ["-y", "@forgekitstudio/core-mcp", "--stdio", "--profile", "Full"]
    }
  }
}
```

**Kiro** — `<projectRoot>/.kiro/settings/mcp.json` or
`~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "forgekit": {
      "command": "npx",
      "args": ["-y", "@forgekitstudio/core-mcp", "--stdio", "--profile", "Full"],
      "disabled": false,
      "autoApprove": ["project.info", "project.list_modules"]
    }
  }
}
```

**Antigravity** — `~/.antigravity/mcp.json`:

```json
{
  "mcpServers": {
    "forgekit": {
      "command": "npx",
      "args": ["-y", "@forgekitstudio/core-mcp", "--stdio", "--profile", "Minimal"]
    }
  }
}
```

Restart the client (Claude Desktop, Antigravity) or trigger a chat
session (Cursor, Kiro) so the client process re-reads the config.

### 3. List tools

Issue an MCP `tools/list` request. Most clients expose this through a
"refresh tools" or "list MCP tools" action; the wire request is:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

The server response is an array of MCP `Tool` records, one per active
tool. Each record carries `name`, `description`, and an `inputSchema`
ready for the SDK to validate `params` against:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "project.info",
        "description": "Returns a stable summary of a Godot project: name, godot_version, api_version, modules_count, root_path.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "projectRoot": { "type": "string", "minLength": 1 },
            "apiVersion": { "type": "string", "minLength": 1 }
          },
          "required": ["projectRoot", "apiVersion"],
          "additionalProperties": false
        }
      },
      {
        "name": "project.list_modules",
        "description": "Returns every `forgekit_*` module under the project with manifest fields (id, version, license_id, core_min_version, source_repo, enabled).",
        "inputSchema": {
          "type": "object",
          "properties": { "projectRoot": { "type": "string", "minLength": 1 } },
          "required": ["projectRoot"],
          "additionalProperties": false
        }
      }
    ]
  }
}
```

`tools/list` is read-only; clients can call it as often as they want.
The active set is recomputed on every call so license activations
(`modules.activate_license`) and licence file changes are honoured
without restarting the server.

### 4. Read the channel mapping

The `tools/list` response intentionally does not echo the `channel`
attribute back to the client. The channel is documented in
[`docs/mcp_api.md#channel-routing`](../mcp_api.md#channel-routing) and
in the table below; agents that want to reason about channel
availability should keep the table in context.

| Tool name prefix         | Channel  |
| ------------------------ | -------- |
| `project.*`              | `editor` (12 tools, including `project.list_workspaces`, `project.add`, etc.) |
| `scene.*`, `node.*`      | `editor` |
| `resource.*`             | `editor` |
| `animation.*`, `tilemap.*`, `theme.*`, `ui.*`, `shader.*`, `physics.*`, `scene3d.*`, `particle.*`, `navigation.*`, `audio.*`, `animation_tree.*`, `state_machine.*`, `blend_tree.*` | `editor` |
| `assetgen.*`, `visualizer.*`, `healing.*`, `transaction.*` | `editor` |
| `runtime.*` (except handshake / heartbeat / is_connected / shutdown) | `runtime` |
| `physics_runtime.*`, `audio_runtime.*`, `state_machine_runtime.*`, `navigation_runtime.*`, `profiling.*` | `runtime` |
| `tests.run_unit`, `tests.run_suite`, `tests.run_gameplay`, `tests.run_property`, `test_report.*`, `crafting.validate_recipe`, `export.list_presets`, `export.run_preset`, `export.validate_preset`, `android.list_devices`, `android.install_apk`, `android.run_logcat` | `cli` |
| `runtime.handshake`, `runtime.heartbeat`, `runtime.is_connected`, `runtime.shutdown`, `input.list_actions` | `cross` |

The first three RPG-domain tool prefixes — `combat.*`, `crafting.*`,
`inventory.*`, `stats.*`, `effects.*`, `magic.*`, `equipment.*`,
`progression.*`, `enemies.*`, `loot.*`, `spawner.*`, `chests.*`,
`npc.*`, `dialog.*`, `vendor.*` — also live on `editor` once
`forgekit_rpg.key` activates the module.

### 5. Call a representative read-only tool

`project.info` is the canonical "is the connection healthy?" probe
because every profile exposes it and it has no side effects.

Wire request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "project.info",
    "arguments": {
      "projectRoot": "/abs/path/to/project",
      "apiVersion": "0.9.2"
    }
  }
}
```

Successful response (`editor` channel runs entirely server-side for
`project.info`, so a Godot editor connection is not required):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"name\":\"ForgeKit Core Template\",\"godot_version\":\"4.6\",\"api_version\":\"0.9.2\",\"modules_count\":1,\"root_path\":\"/abs/path/to/project\"}"
      }
    ]
  }
}
```

### 6. Call a representative editor-channel tool

When the editor plugin is connected, the same `tools/call` shape works
for any `editor`-channel tool. `node.get_property` is a good probe:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "node.get_property",
    "arguments": {
      "projectRoot": "/abs/path/to/project",
      "scene_path": "res://scenes/main.tscn",
      "node_path": "Player",
      "property": "name"
    }
  }
}
```

If the plugin is not running the dispatcher returns
`-32000 CHANNEL_UNAVAILABLE` with `data.channel = "editor"` and a
`suggestion` field directing the operator to verify the editor is open
and the plugin is enabled.

### 7. Call a representative CLI-channel tool

`tests.run_unit` is the canonical CLI probe; it spawns
`godot --headless` against the project's GUT suite and returns a
canonical `TestReport`:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "tests.run_unit",
    "arguments": {
      "projectRoot": "/abs/path/to/project"
    }
  }
}
```

A green report looks like:

```json
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"run_id\":\"...\",\"timestamp\":\"...\",\"total\":42,\"passed\":42,\"failed\":0,\"tests\":[],\"suggested_action\":\"\"}"
      }
    ]
  }
}
```

### 8. Call a representative cross-channel tool

`runtime.handshake` orchestrates state from the editor plugin (config,
license registry) and the runtime bridge (UDP socket health) in a
single call:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "runtime.handshake",
    "arguments": {
      "projectRoot": "/abs/path/to/project"
    }
  }
}
```

The response carries `server` (npm version), `core_detected` (git
tag), `api_version`, and `latest_version` (from the editor-plugin
update-check cache); failures surface as `-32000 CHANNEL_UNAVAILABLE`
when neither side is connected.

## Failure envelopes the agent should recognise

| Code     | Symbol                  | What to tell the user |
| -------- | ----------------------- | --------------------- |
| `-32000` | `CHANNEL_UNAVAILABLE`   | Editor or runtime channel is offline. Open the Godot project and enable the ForgeKit plugin (editor) or relaunch the game with `--mcp-bridge` (runtime). |
| `-32001` | `CHANNEL_TIMEOUT`       | The downstream channel did not reply within 30 s. Ask the user to retry; capture `data.method` and `data.elapsed_ms` so they can file a bug if it persists. |
| `-32024` | `PROFILE_TOOL_FILTERED` | The active profile or license set hides this tool. Either restart the server with a wider profile or call `modules.activate_license` for the module listed in `data.required_modules`. |
| `-32601` | `METHOD_NOT_FOUND`      | The method name does not exist in `profiles.json`. Re-run `tools/list` to see the active surface and pick a name from the response. |
| `-32602` | `INVALID_PARAMS`        | The supplied params failed schema validation. Read `data.detail` for the per-field error and resend with the corrected shape. |

The full registry, including the reserved JSON-RPC range and the
disambiguation rules for codes shared between two symbols, is in
[`docs/mcp_api.md#known-error-codes`](../mcp_api.md#known-error-codes).

## Coverage of the 271-tool surface

The skill keeps to `project.info` and the four representative tools
above so the agent has concrete templates to copy for the rest of the
271-tool surface. Each tool category in
[`docs/mcp_api.md`](../mcp_api.md) documents its own params, result,
and channel; the response shape is always the MCP SDK's
`{content: [{type: "text", text: <serialized JSON>}]}` envelope on
success and a JSON-RPC error envelope on failure, regardless of which
channel handled the call. Once the agent has confirmed a successful
`tools/list` and one successful `tools/call` per channel, it can
extrapolate to the remaining tools by following the schema returned
in step 3.

## Example user query

> "Add ForgeKit MCP to my Cursor config and make sure the agent can
> see all 271 tools."

The agent should:

1. Check the user's OS (Cursor uses the same JSON shape on macOS,
   Linux, and Windows but the file path differs).
2. Write or update `~/.cursor/mcp.json` (or
   `<projectRoot>/.cursor/mcp.json` for a per-project entry) with the
   snippet from step 2.
3. Tell the user to open a new chat in Cursor so the client re-reads
   the config.
4. Issue `tools/list` from the new chat and confirm the response
   contains 271 entries (or the expected lower number for `Lite` /
   `Minimal` / `RPG-only`).
5. Issue `tools/call` against `project.info` to validate the
   round-trip.
