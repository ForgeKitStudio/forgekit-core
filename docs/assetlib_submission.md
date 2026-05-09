# Submitting ForgeKit Core to the Godot Asset Library

Godot's Asset Library is a manual web form — there is no public API
that accepts new submissions. This document describes the one-time
submission and the per-release update flow that the studio runs from
`ForgeKitStudio/forgekit-core` whenever a new tag is cut.

`tools/prepare-assetlib-submission.js` prints a ready-to-paste payload
for the form. It reads `addons/forgekit_core/plugin.cfg` and, by
default, assembles a download URL of the form
`https://github.com/<owner>/<repo>/archive/refs/tags/v<version>.zip`.

## First submission

1. Tag and push a release on `ForgeKitStudio/forgekit-core`. The
   `release.yml` workflow creates a GitHub Release with the archived
   source, which is what the AssetLib download URL points to.
2. Run the payload helper and capture its output:
   ```sh
   node tools/prepare-assetlib-submission.js
   ```
   Pass `--version <semver>` when the `plugin.cfg` version has not
   caught up with the git tag yet; pass `--release-url <url>` to
   override the default archive URL when the studio wants to ship a
   signed ZIP instead of GitHub's auto-generated archive.
3. Visit <https://godotengine.org/asset-library/asset/submit> while
   signed in as the ForgeKit publishing account.
4. Paste each field from the payload into the matching form field:
   - **Title**, **Version**, **Category**, **Support level**,
     **Author**, **License**, **Description** — direct copy.
   - **Godot version** — the minimum Godot version the addon parses
     cleanly against (default `4.6`). Keep this aligned with the
     `[application] config/features=PackedStringArray(...)` line in
     `project.godot`.
   - **Download provider** — GitHub.
   - **Download URL**, **Commit**, **Browse URL**, **Issues URL** —
     direct copy.
5. Under **Previews**, click **Add preview** once per URL listed in
   the payload. If the preview images are not yet uploaded to the
   repository, leave the list empty and add them after merging the
   screenshots under `docs/media/`.
6. Submit. A Godot moderator reviews the submission; the studio's
   publishing account receives an email when the asset is approved.

## Updating an existing asset

AssetLib replaces the submission flow with an **Update this asset**
action once the initial submission is approved.

1. Tag and push the new release (for example `v0.8.0`).
2. Regenerate the payload:
   ```sh
   node tools/prepare-assetlib-submission.js
   ```
   The helper reads the new version from `plugin.cfg` and produces a
   download URL that points at the fresh tag.
3. Visit the asset's public page on
   <https://godotengine.org/asset-library>. Click **Update this
   asset**.
4. Paste the new **Version**, **Download URL**, and **Commit** from
   the payload. AssetLib preserves the existing description,
   previews, and metadata unless the update form overwrites them.
5. Save. The moderator review queue also applies to updates.

## When not to submit

The helper is safe to run at any time — it does not touch the
network. The studio gates submissions on two conditions:

- The git tag referenced by `--tag` (or the `v<plugin.version>`
  default) exists on `ForgeKitStudio/forgekit-core` and carries the
  matching source archive. AssetLib rejects downloads that 404.
- The `plugin.cfg` version and the git tag agree. The
  `validate-release-tag` check in the npm publish workflow enforces
  this for the MCP server; re-run `node tools/prepare-assetlib-submission.js`
  and spot-check the `Version` / `Download commit` lines before
  pasting into the form.

Automation-wise the AssetLib step is the only publishing channel that
is intentionally manual in this repository — the itch.io / Gumroad /
npm pipelines all run on tag push, but the AssetLib form has no
equivalent entry point, so the payload helper is as far as the
automation goes today.
