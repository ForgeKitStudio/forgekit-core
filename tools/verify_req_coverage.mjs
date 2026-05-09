import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const matrix = readFileSync(resolve(here, '..', 'docs', 'coverage_matrix.md'), 'utf8');

const reqs = new Map();
for (const line of matrix.split('\n')) {
    const m = line.match(/^\| ([❌✅⚠️]+) \| Req (\d+) /);
    if (!m) continue;
    const n = Number.parseInt(m[2], 10);
    if (n < 1 || n > 46) continue;
    if (!reqs.has(n)) reqs.set(n, []);
    reqs.get(n).push(m[1]);
}

const uncovered = [];
const fullyCovered = [];
const partial = [];
for (let n = 1; n <= 46; n += 1) {
    const arr = reqs.get(n);
    if (!arr || arr.length === 0) {
        uncovered.push(n);
        continue;
    }
    const good = arr.filter((f) => f !== '❌').length;
    const bad = arr.filter((f) => f === '❌').length;
    if (bad === arr.length) uncovered.push(n);
    else if (bad === 0) fullyCovered.push(n);
    else partial.push({ n, good, bad });
}

console.log('Wym 1-46 with zero passing tests:', uncovered.length ? uncovered : 'none');
console.log('Wym 1-46 fully covered (all criteria):', fullyCovered);
console.log('Wym 1-46 partially covered (some criteria uncovered):',
    partial.map(({ n, good, bad }) => `${n}[${good}✅/${bad}❌]`));
console.log(`\nSummary: ${fullyCovered.length} fully covered, ${partial.length} partial, ${uncovered.length} uncovered — of 46 total.`);
