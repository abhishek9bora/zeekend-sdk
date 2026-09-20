// The smallest test that would have caught every SDK breakage so far: does
// each entry point load, and does the tarball contain exactly what it should.
// Runs before every pack and publish (see package.json "prepack"), so a
// broken build cannot reach npm.
import { execFileSync } from 'node:child_process';

const zk = await import('../sdk/zeekend.js');
if (typeof zk.Zeekend?.init !== 'function') throw new Error('sdk/zeekend.js: Zeekend.init missing');
if (typeof zk.deriveContext !== 'function') throw new Error('sdk/zeekend.js: deriveContext missing');

// auto.js runs against a DOM, so only check that it parses.
execFileSync(process.execPath, ['--check', new URL('../sdk/auto.js', import.meta.url).pathname]);
// react.jsx is JSX and cannot be parsed by node; the React peer is optional,
// so it is deliberately not imported here. Its one import target is checked above.
// The CLI runs on load and waits for a terminal, so it is parsed, not required.
execFileSync(process.execPath, ['--check', new URL('../bin/init.cjs', import.meta.url).pathname]);

const expected = ['LICENSE', 'README.md', 'SKILL.md', 'SKILL_DASHBOARD.md',
  'bin/init.cjs', 'package.json', 'sdk/auto.js', 'sdk/react.jsx', 'sdk/zeekend.js'];
const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
// npm 10 prints an array of packages; npm 11 prints an object keyed by name.
const parsed = JSON.parse(out);
const pkg = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
const files = pkg.files.map(f => f.path).sort();
const missing = expected.filter(f => !files.includes(f));
const extra = files.filter(f => !expected.includes(f));
if (missing.length || extra.length) {
  throw new Error('tarball mismatch. missing: ' + missing.join(', ') + ' extra: ' + extra.join(', '));
}
console.log('ok: entry points load, tarball has exactly ' + files.length + ' files');
