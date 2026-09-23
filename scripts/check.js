// The smallest test that would have caught every SDK breakage so far: does
// each entry point load, and does the tarball contain exactly what it should.
// Runs before every pack and publish (see package.json "prepack"), so a
// broken build cannot reach npm.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const zk = await import('../sdk/zeekend.js');
if (typeof zk.Zeekend?.init !== 'function') throw new Error('sdk/zeekend.js: Zeekend.init missing');
if (typeof zk.deriveContext !== 'function') throw new Error('sdk/zeekend.js: deriveContext missing');

// auto.js runs against a DOM, so only check that it parses.
execFileSync(process.execPath, ['--check', new URL('../sdk/auto.js', import.meta.url).pathname]);
// react.jsx is JSX and cannot be parsed by node; the React peer is optional,
// so it is deliberately not imported here. Its one import target is checked above.
// The CLI runs on load and waits for a terminal, so it is parsed, not required.
execFileSync(process.execPath, ['--check', new URL('../bin/init.cjs', import.meta.url).pathname]);

// The compiled React entry must match its source. A stale build here would
// ship a component that does not do what the .jsx in the repo says it does.
const { compileReact } = await import('./build.js');
const committed = fs.readFileSync(new URL('../sdk/react.js', import.meta.url).pathname, 'utf8');
if (committed !== compileReact()) throw new Error('sdk/react.js is stale: run `npm run build` and commit it');

// React entry: the compiled file must load and export the hook and component.
// (It imports react, which is a peer, so it is checked by parsing only.)
execFileSync(process.execPath, ['--check', new URL('../sdk/react.js', import.meta.url).pathname]);

// The version the SDK reports must be the version that was published. It
// drifted from 0.2.0 to 0.5.2 unnoticed, which made the version every
// publisher reports to the exchange meaningless.
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'));
const core = fs.readFileSync(new URL('../sdk/zeekend.js', import.meta.url).pathname, 'utf8');
const declared = (core.match(/^var VERSION = '([^']*)';/m) || [])[1];
if (declared !== manifest.version) {
  throw new Error(`sdk/zeekend.js says VERSION '${declared}' but package.json says '${manifest.version}'`);
}

// The README promises zero dependencies, and the package once depended on
// itself. Keep the promise checkable rather than remembered.
if (manifest.dependencies && Object.keys(manifest.dependencies).length) {
  throw new Error('package.json declares runtime dependencies: ' + Object.keys(manifest.dependencies).join(', '));
}

const expected = ['LICENSE', 'README.md', 'SKILL.md', 'SKILL_DASHBOARD.md',
  'bin/init.cjs', 'package.json', 'sdk/auto.js', 'sdk/react.js', 'sdk/react.jsx', 'sdk/zeekend.js'];
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
