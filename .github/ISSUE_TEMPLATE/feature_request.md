---
name: Feature request
about: Propose a new capability for ForgeKit Core or the MCP server
title: "[feat] <short summary>"
labels: ["enhancement", "triage"]
assignees: []
---

## Motivation

What problem does this feature solve? Who benefits from it (indie developer, studio, AI agent, maintainer)?

## Proposed Scope

- [ ] `addons/forgekit_core/` (Godot addon)
- [ ] `mcp-server/` (`@forgekitstudio/core-mcp` npm package)
- [ ] New MCP tool(s): `<category>.<tool>`
- [ ] Documentation / SKILLS
- [ ] CI / release tooling

## Proposed Design

Describe the API, tool signature, file layout, or behavior you envision. Reference the relevant sections of `docs/architecture.md` or `docs/mcp_api.md` when applicable.

If this feature adds a new MCP tool, include:

- Method name (for example `scene.rename_node`).
- Parameters and return shape.
- Error codes and `data.suggestion` fields.
- Which profile(s) expose the tool (`Full`, `Lite`, `Minimal`, `RPG-only`).

## Correctness Properties

List any property-based tests that should validate this feature (for example "round-trip for the new resource", "commutativity of a new inventory operation"). Note the requirement IDs it covers.

## Alternatives Considered

What other approaches did you consider, and why did you rule them out?

## Breaking Changes

- [ ] This change is backwards compatible
- [ ] This change requires a major version bump of `api.version`

## Additional Context

Links to related issues, discussions, or external references.
