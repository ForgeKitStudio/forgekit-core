# Installed ForgeKit Modules

This file lists the ForgeKit modules installed in this project together with
their licenses, versions, and source repositories. The table is maintained by
the `Module_Installer` component of the MCP server: when you unzip a paid
module into `addons/`, the installer rewrites the corresponding row. Do not
edit this file by hand unless you are also updating the matching
`module.manifest.tres`.

| Module          | License                                                                 | Version | Repository                                                                                      |
| --------------- | ----------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `forgekit_core` | MIT                                                                     | 0.0.1   | https://github.com/ForgeKitStudio/forgekit-core                                                 |
| `forgekit_rpg`  | _not installed — see `addons/forgekit_rpg/.gitkeep` for purchase steps_ | —       | https://github.com/ForgeKitStudio/forgekit-rpg _(private; purchase required to gain access)_    |

The `forgekit_rpg` row is a placeholder. When you purchase the ForgeKit RPG
Module and extract the distribution ZIP into `addons/forgekit_rpg/`, the
`Module_Installer` populates the License, Version, and Repository columns
from the module's `module.manifest.tres` (fields `license_id`, `version`,
`homepage`).
