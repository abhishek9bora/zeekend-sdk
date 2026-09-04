#!/usr/bin/env node
/**
 * `npx @zeekend/sdk` / `npx @zeekend/sdk init`
 *
 * Installs @zeekend/sdk into the project in the current directory AND wires
 * <ZeekendSlot> into wherever that project already renders its chat messages
 * — no manual copy/paste. Same integration SKILL_DASHBOARD.md describes to a
 * coding agent, done here with plain heuristics instead of an LLM reading the
 * code.
 *
 * Deliberately zero dependencies, same as the SDK itself — this only uses
 * Node's own fs/path/child_process/readline.
 *
 * Honest limitations (falls back to printing manual instructions instead of
 * guessing wrong):
 *   - Needs a JSX expression shaped like `{something.map(...)}` where
 *     "something" contains the word "message"/"messages". Chat UIs built
 *     some other way (a class-based renderer, a non-JS template engine, a
 *     messages array assembled from multiple sources with no single .map)
 *     won't be found.
 *   - Bracket matching skips strings/template literals and comments, but is
 *     not a full JS parser. On anything it isn't confident about, it stops
 *     and prints the manual snippet rather than risk corrupting a file.
 *   - Picks the first project it can find under the current directory,
 *     starting from where the command was run. Run it from your app's root.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const CWD = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', '.vercel', 'dist', 'build',
  'out', 'coverage', '.cache', '.svelte-kit'
]);
const SCAN_EXTS = new Set(['.tsx', '.jsx', '.ts', '.js']);
const MAX_FILES_SCANNED = 8000;
const MAX_FILE_BYTES = 500 * 1024;

function main() {
  const args = process.argv.slice(2).filter((a) => a !== 'init');
  if (args.includes('--help') || args.includes('-h')) { return printHelp(); }

  const yes = args.includes('--yes') || args.includes('-y');
  const skipInstall = args.includes('--skip-install');
  const fileFlagIdx = args.indexOf('--file');
  const forcedFile = fileFlagIdx !== -1 ? args[fileFlagIdx + 1] : null;
  // Pre-supplying either key skips its own prompt — e.g. a per-app "run this"
  // command generated on the dashboard bakes in --app-key so the only thing
  // still asked interactively is the one key that's genuinely unknown to us
  // (the ad-serving publisherKey). Read as `--flag value`, not `--flag=value`.
  const forcedPublisherKey = flagValue(args, '--publisher-key');
  const forcedAppKey = flagValue(args, '--app-key');

  log('');
  log(bold('zeekend init'));
  log('Installing the SDK and wiring it into your app.');
  log('');

  const pkgPath = path.join(CWD, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fail('No package.json here (' + CWD + '). Run this from your app\'s project root.');
  }
  const pkg = readJson(pkgPath);

  const alreadyDep =
    (pkg.dependencies && pkg.dependencies['@zeekend/sdk']) ||
    (pkg.devDependencies && pkg.devDependencies['@zeekend/sdk']);

  if (skipInstall || alreadyDep) {
    log((alreadyDep ? '@zeekend/sdk already in package.json' : '--skip-install passed') + ' — skipping install.');
  } else {
    const pm = detectPackageManager(CWD);
    log('Installing @zeekend/sdk with ' + pm + '...');
    const result = installPackage(pm, CWD);
    if (result.status !== 0) {
      fail('Install failed (' + pm + ' exited ' + result.status + '). Run it yourself and re-run `zeekend init --skip-install`.');
    }
    log('Installed.');
  }
  log('');

  askKeys(yes, forcedPublisherKey, forcedAppKey, function (keys) {
    const target = forcedFile
      ? { file: path.join(CWD, forcedFile), matches: null }
      : findTargetFile();

    if (!target) {
      return printManualFallback(keys, null);
    }

    let outcome;
    try {
      outcome = wireFile(target.file, keys);
    } catch (err) {
      log(yellow('Could not safely edit that file automatically: ' + err.message));
      return printManualFallback(keys, target.file);
    }

    if (outcome === 'already-installed') {
      log(bold('Already wired up') + ' — found an existing ZeekendSlot in ' + relPath(target.file) + '. Nothing changed.');
    } else if (outcome === 'not-confident') {
      return printManualFallback(keys, target.file);
    } else {
      log(bold('Done.') + ' Added the Zeekend slot to ' + relPath(target.file) + '.');
    }

    writeEnvFile(keys);
    printVerifySteps(!!keys.appKey);
  });
}

/* --------------------------------------------------------------- keys -- */

function askKeys(yes, forcedPublisherKey, forcedAppKey, cb) {
  // Both already known (the common case for a per-app generated command,
  // which bakes in --app-key and often --publisher-key too) — no prompt at
  // all, fully non-interactive regardless of --yes or TTY state.
  if (forcedPublisherKey != null && forcedAppKey != null) {
    return cb({
      publisherKey: forcedPublisherKey.trim() || 'pub_test',
      appKey: forcedAppKey.trim()
    });
  }

  if (yes || !process.stdin.isTTY) {
    if (!yes) { log(yellow('Not an interactive terminal — using defaults. Pass --yes to silence this.')); }
    return cb({
      publisherKey: forcedPublisherKey != null ? (forcedPublisherKey.trim() || 'pub_test') : 'pub_test',
      appKey: forcedAppKey != null ? forcedAppKey.trim() : ''
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Only ask for whichever key wasn't already supplied via flag.
  if (forcedAppKey != null) {
    rl.question(
      'Publisher key from zeekend.com (Enter for the pub_test sandbox key): ',
      function (publisherKeyRaw) {
        rl.close();
        cb({ publisherKey: (publisherKeyRaw || '').trim() || 'pub_test', appKey: forcedAppKey.trim() });
      }
    );
    return;
  }
  if (forcedPublisherKey != null) {
    rl.question(
      'Publisher app key from publisher.zeekend.com/apps, for dashboard reporting (Enter to skip): ',
      function (appKeyRaw) {
        rl.close();
        cb({ publisherKey: forcedPublisherKey.trim() || 'pub_test', appKey: (appKeyRaw || '').trim() });
      }
    );
    return;
  }

  rl.question(
    'Publisher key from zeekend.com (Enter for the pub_test sandbox key): ',
    function (publisherKeyRaw) {
      rl.question(
        'Publisher app key from publisher.zeekend.com/apps, for dashboard reporting (Enter to skip): ',
        function (appKeyRaw) {
          rl.close();
          cb({
            publisherKey: (publisherKeyRaw || '').trim() || 'pub_test',
            appKey: (appKeyRaw || '').trim()
          });
        }
      );
    }
  );
}

/* ------------------------------------------------------------ scanning -- */

/** messages.map(, chatMessages.map(, thread.messages.map(, etc, inside a JSX expression container. */
const MESSAGE_MAP_RE = /\{\s*([A-Za-z0-9_.]*\bmessages?\b[A-Za-z0-9_.]*)\s*\.map\s*\(/;

function findTargetFile() {
  const files = walk(CWD);
  const candidates = [];
  for (const file of files) {
    let src;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) { continue; }
      src = fs.readFileSync(file, 'utf8');
    } catch (e) { continue; }
    if (MESSAGE_MAP_RE.test(src)) { candidates.push(file); }
  }
  if (candidates.length === 0) {
    log(yellow('Could not find a `{messages.map(...)}`-shaped chat render anywhere under ' + CWD + '.'));
    return null;
  }
  if (candidates.length > 1) {
    log(yellow('Found more than one possible chat file, so not guessing:'));
    candidates.forEach((f) => log('  - ' + relPath(f)));
    log('Re-run with ' + bold('--file <path>') + ' to pick one.');
    return null;
  }
  return { file: candidates[0] };
}

function walk(dir, out, count) {
  out = out || [];
  count = count || { n: 0 };
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const entry of entries) {
    if (count.n > MAX_FILES_SCANNED) { return out; }
    if (entry.name.startsWith('.') && entry.name !== '.env') { if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) { /* allow dotfolders like .storybook to be skipped below anyway */ } }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) { continue; }
      walk(full, out, count);
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
      count.n++;
    }
  }
  return out;
}

/* --------------------------------------------------------- file editing -- */

function wireFile(file, keys) {
  const src = fs.readFileSync(file, 'utf8');
  if (/ZeekendSlot/.test(src)) { return 'already-installed'; }

  const match = MESSAGE_MAP_RE.exec(src);
  if (!match) { throw new Error('expected file to match the chat-render pattern, it did not on re-check'); }

  const mapCallOpenIdx = src.indexOf('(', match.index + match[0].length - 1);
  const mapCallCloseIdx = findMatchingBracket(src, mapCallOpenIdx);
  if (mapCallCloseIdx === -1) { throw new Error('could not find the matching close for .map('); }

  let after = mapCallCloseIdx + 1;
  while (after < src.length && /\s/.test(src[after])) { after++; }
  if (src[after] !== '}') { throw new Error('the .map( call is not the whole JSX expression — not confident enough to edit'); }
  const containerCloseIdx = after; // index of the '}'

  // Indentation: reuse the indent of the line the opening `{` sits on.
  const lineStart = src.lastIndexOf('\n', match.index) + 1;
  const indent = src.slice(lineStart, match.index).match(/^[ \t]*/)[0];
  const messagesExpr = match[1];

  const jsxBlock =
    '\n' + indent + '<ZeekendSlot' +
    '\n' + indent + '  publisherKey={ZEEKEND_PUBLISHER_KEY}' +
    '\n' + indent + '  zeekendAppKey={ZEEKEND_APP_KEY || undefined}' +
    '\n' + indent + '  messages={' + messagesExpr + '}' +
    '\n' + indent + '/>';

  const insertions = [{ at: containerCloseIdx + 1, text: jsxBlock }];

  // Import + config consts, placed after the last top-of-file import.
  const importRe = /^import[^\n]*\n/gm;
  let lastImportEnd = 0;
  let m;
  while ((m = importRe.exec(src))) { lastImportEnd = m.index + m[0].length; }

  const header =
    'import { ZeekendSlot } from "@zeekend/sdk/react";\n\n' +
    'const ZEEKEND_PUBLISHER_KEY = process.env.NEXT_PUBLIC_ZEEKEND_KEY || "' + keys.publisherKey + '";\n' +
    'const ZEEKEND_APP_KEY = process.env.NEXT_PUBLIC_ZEEKEND_APP_KEY || "";\n\n';

  insertions.push({ at: lastImportEnd, text: header });

  // Apply from the highest offset down, so earlier offsets stay valid.
  insertions.sort((a, b) => b.at - a.at);
  let out = src;
  for (const ins of insertions) {
    out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  }

  fs.writeFileSync(file, out, 'utf8');
  return 'wired';
}

/** Stack-based bracket matcher: skips string/template literals and comments. */
function findMatchingBracket(src, openIndex) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const open = src[openIndex];
  const close = pairs[open];
  if (!close) { throw new Error('not a bracket at ' + openIndex); }
  let depth = 0;
  let inString = null;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) { inString = null; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { i++; }
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inString = c; continue; }
    if (c === open) { depth++; }
    else if (c === close) { depth--; if (depth === 0) { return i; } }
  }
  return -1;
}

/* -------------------------------------------------------------- env -- */

function writeEnvFile(keys) {
  const isNext = ['next.config.js', 'next.config.mjs', 'next.config.ts']
    .some((f) => fs.existsSync(path.join(CWD, f)));
  const envFile = path.join(CWD, isNext ? '.env.local' : '.env');

  const lines = [];
  const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  if (!/^NEXT_PUBLIC_ZEEKEND_KEY=/m.test(existing)) {
    lines.push('NEXT_PUBLIC_ZEEKEND_KEY=' + keys.publisherKey);
  }
  if (keys.appKey && !/^NEXT_PUBLIC_ZEEKEND_APP_KEY=/m.test(existing)) {
    lines.push('NEXT_PUBLIC_ZEEKEND_APP_KEY=' + keys.appKey);
  }
  if (lines.length === 0) { return; }

  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(envFile, sep + lines.join('\n') + '\n');
  log('Wrote ' + lines.length + ' key(s) to ' + relPath(envFile) + '.');
}

/* ----------------------------------------------------------- fallback -- */

function printManualFallback(keys, file) {
  log('');
  log(yellow(bold('Could not wire this up automatically.')) +
    (file ? ' (' + relPath(file) + ')' : ''));
  log('The package is installed. Paste this yourself, right after your message list:');
  log('');
  log('  import { ZeekendSlot } from "@zeekend/sdk/react";');
  log('');
  log('  <ZeekendSlot');
  log('    publisherKey="' + keys.publisherKey + '"' +
    (keys.appKey ? '' : ''));
  if (keys.appKey) { log('    zeekendAppKey="' + keys.appKey + '"'); }
  log('    messages={messages}');
  log('  />');
  log('');
  log('Or paste this into your AI coding assistant instead — it can find the right spot itself:');
  log('  Read https://exchange.zeekend.com/skill-dashboard.md and install Zeekend in this app.');
  log('');
  writeEnvFile(keys);
}

function printVerifySteps(hasAppKey) {
  log('');
  log(bold('Next:'));
  log('  1. Start your app and send two messages in the chat.');
  log('  2. Turn one never shows anything, by design. Turn two should, on the sandbox key.');
  if (hasAppKey) {
    log('  3. Open https://publisher.zeekend.com/dashboard after that — your app\'s row should update.');
  }
  log('');
}

/* ------------------------------------------------------------- utils -- */

function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) { return 'pnpm'; }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) { return 'yarn'; }
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) { return 'bun'; }
  return 'npm';
}

function installPackage(pm, cwd) {
  const cmd = {
    npm: ['npm', ['install', '@zeekend/sdk']],
    pnpm: ['pnpm', ['add', '@zeekend/sdk']],
    yarn: ['yarn', ['add', '@zeekend/sdk']],
    bun: ['bun', ['add', '@zeekend/sdk']]
  }[pm];
  return spawnSync(cmd[0], cmd[1], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? (args[i + 1] || '') : null;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function relPath(p) { return path.relative(CWD, p) || '.'; }
function log(s) { console.log(s); }
function bold(s) { return '\x1b[1m' + s + '\x1b[0m'; }
function yellow(s) { return '\x1b[33m' + s + '\x1b[0m'; }
function fail(msg) { console.error(yellow(bold('zeekend init: ') + msg)); process.exit(1); }

function printHelp() {
  log([
    'zeekend init',
    '',
    'Installs @zeekend/sdk and wires <ZeekendSlot> into your chat UI automatically.',
    '',
    'Usage:',
    '  npx @zeekend/sdk           (same as `init`, the only command)',
    '  npx @zeekend/sdk init',
    '',
    'Flags:',
    '  --yes, -y                skip prompts, use the pub_test sandbox key, no dashboard key',
    '  --file <path>            edit this file instead of auto-detecting one',
    '  --skip-install           don\'t run npm/pnpm/yarn/bun install (assumes it\'s already a dependency)',
    '  --app-key <key>          pre-fill the dashboard key — skips that prompt',
    '  --publisher-key <key>    pre-fill the ad-serving key — skips that prompt',
    '  --help, -h               this'
  ].join('\n'));
}

main();
