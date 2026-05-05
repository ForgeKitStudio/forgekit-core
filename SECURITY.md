# Security Policy

## Supported Versions

ForgeKit Core follows Semantic Versioning. Security fixes are backported only to the latest minor release line. Older versions receive fixes on a best-effort basis.

| Version       | Supported          |
| ------------- | ------------------ |
| Latest minor  | :white_check_mark: |
| Previous minor| :warning: best-effort |
| Older         | :x:                |

## Reporting a Vulnerability

Please do not open public GitHub issues for security problems.

Report vulnerabilities privately using one of the following channels:

1. **GitHub Security Advisories** (preferred): open a private advisory at <https://github.com/ForgeKitStudio/forgekit-core/security/advisories/new>.
2. **Email**: send details to `security@forgekitstudio.dev`. For sensitive reports you may encrypt the message with our PGP key (published in the same advisories page).

When reporting, please include:

- A clear description of the issue and the component affected (`addons/forgekit_core/`, `mcp-server/`, git hooks, CI workflow, etc.).
- Steps to reproduce, ideally with a minimal project or unit test.
- The version, commit SHA, or release tag where the issue was observed.
- Any known mitigations or workarounds.

## Disclosure Process

1. We acknowledge receipt within **3 business days**.
2. We triage and confirm the issue within **10 business days**.
3. We prepare a fix on a private branch and coordinate a release with the reporter.
4. We publish a security advisory with credit to the reporter (unless anonymity is requested).
5. We release a patched version on npm (`@forgekit/core-mcp`) and GitHub Releases, and notify downstream consumers via the changelog.

## Scope

In scope:

- Code and assets in `addons/forgekit_core/`, `mcp-server/`, `docs/SKILLS/`.
- Default CI workflows under `.github/workflows/`.
- Git hooks shipped via `npx @forgekit/core-mcp install-hooks`.

Out of scope:

- Third-party addons installed by the consumer (for example `addons/forgekit_rpg/`).
- Forked or modified derivatives of this repository.
- Social engineering attacks against project maintainers.
