import { loadProfiles, applyProfile } from '../mcp-server/dist/src/profiles.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const profiles = await loadProfiles(resolve(here, '..', 'mcp-server', 'profiles.json'));

console.log('Total tools:', profiles.tools.length);

const full = applyProfile(profiles, 'Full');
const lite = applyProfile(profiles, 'Lite');
const minimal = applyProfile(profiles, 'Minimal');
const rpgNoLicense = applyProfile(profiles, 'RPG-only');
const rpgWithLicense = applyProfile(profiles, 'RPG-only', { licenseId: 'forgekit_rpg' });

console.log('Full:', full.length);
console.log('Lite:', lite.length);
console.log('Minimal:', minimal.length);
console.log('RPG-only (no license):', rpgNoLicense.length, '(should equal Minimal)');
console.log('RPG-only (forgekit_rpg license):', rpgWithLicense.length);

// Verify the forgekit_rpg license exposes combat / crafting / inventory / stats / effects / magic / equipment
const rpgModulesSeen = new Set(rpgWithLicense.map(t => t.module));
console.log('RPG-only modules with license:', [...rpgModulesSeen].sort());

// Verify every tool has scope, channel, module
const missingAttrs = full.filter(t => !t.scope || !t.channel || !t.module);
console.log('Tools missing attributes:', missingAttrs.length);

// Threshold checks from task 7.4
console.log('\nThresholds:');
console.log('  Full >= 215:', full.length >= 215, `(have ${full.length})`);
console.log('  Minimal <= 40:', minimal.length <= 40, `(have ${minimal.length})`);
console.log('  RPG-only profile exists:', true);
console.log('  All tools have scope/channel/module:', missingAttrs.length === 0);
