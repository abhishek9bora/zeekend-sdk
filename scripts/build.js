// Compiles sdk/react.jsx to sdk/react.js so a consumer's bundler never has to
// parse JSX out of node_modules. The compiled file is committed: what npm
// ships is what the repo shows, and the check script fails if the two drift.
import { buildSync } from 'esbuild';
import fs from 'node:fs';

const HEADER = '// Generated from react.jsx by scripts/build.js. Edit the .jsx, then `npm run build`.\n';

export function compileReact() {
  const out = buildSync({
    entryPoints: [new URL('../sdk/react.jsx', import.meta.url).pathname],
    jsx: 'transform',            // React.createElement; the source imports React itself
    format: 'esm',
    target: 'es2018',
    write: false,
    logLevel: 'warning',
  });
  return HEADER + out.outputFiles[0].text;
}

if (process.argv[1] && process.argv[1].endsWith('build.js')) {
  fs.writeFileSync(new URL('../sdk/react.js', import.meta.url).pathname, compileReact());
  console.log('sdk/react.js written');
}
