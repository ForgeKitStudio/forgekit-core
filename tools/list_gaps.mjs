import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const matrix = readFileSync(resolve(here, '..', 'docs', 'coverage_matrix.md'), 'utf8');

const rows = [];
for (const line of matrix.split('\n')) {
    // | ❌ | Req N — title | N.M — text | files |
    const m = line.match(/^\| ([❌✅⚠️]+) \| Req (\d+) — ([^|]+?) \| (\d+\.\d+) — (.+?) \| (.+) \|\s*$/);
    if (!m) continue;
    rows.push({
        flag: m[1],
        req: Number.parseInt(m[2], 10),
        title: m[3].trim(),
        criterion: m[4],
        text: m[5],
        files: m[6],
    });
}

const uncovered = rows.filter((r) => r.flag === '❌');
console.log(`Total uncovered criteria: ${uncovered.length}`);
console.log('');
const byReq = new Map();
for (const r of uncovered) {
    if (!byReq.has(r.req)) byReq.set(r.req, []);
    byReq.get(r.req).push(r);
}
for (const [req, items] of [...byReq.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`Req ${req} — ${items[0].title}`);
    for (const it of items) {
        const trimmed = it.text.length > 180 ? it.text.slice(0, 177) + '...' : it.text;
        console.log(`  ${it.criterion}  ${trimmed}`);
    }
    console.log('');
}
