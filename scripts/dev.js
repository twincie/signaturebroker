/**
 * Run the API and the Vite dev server together.
 *
 * The dashboard is useless without the API behind Vite's proxy, and starting
 * them in two terminals is easy to get wrong, so one command brings up both.
 * Each child's output is prefixed so it is clear which side spoke.
 *
 * Two details keep the startup quiet. The API waits for MongoDB before it
 * listens, which takes some seconds against a remote cluster, so Vite is held
 * back until the API reports that it is ready rather than filling the log with
 * connection errors. And if an API is already listening on the port, that one
 * is used instead of starting a second and failing to bind.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Vite's package exports do not expose its bin, so go via the local shim that
// npm creates rather than trying to resolve the path directly.
const viteBin = path.join(root, 'node_modules', '.bin', 'vite');
if (!existsSync(viteBin)) {
  process.stderr.write('Vite is not installed. Run "npm install" first.\n');
  process.exit(1);
}

// Must match how backend/server.js picks its port, otherwise the check below
// looks at the wrong one.
const apiPort = Number(process.env.PORT || process.env.SIGNATURE_PORT || 3000);
const API_READY = /is running on http/;
const READY_TIMEOUT_MS = 60_000;

// dotenv announces how many variables it injected. Every variable is already
// in the environment by this point, so the banner reads as a confusing zero.
process.env.DOTENV_CONFIG_QUIET = 'true';

const children = [];
let shuttingDown = false;

function prefix(stream, label, target, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    // The last element is an incomplete line, so hold it back until it arrives.
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      target.write(`${label} ${line}\n`);
      onLine?.(line);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      target.write(`${label} ${buffer}\n`);
      onLine?.(buffer);
    }
  });
}

function start(name, command, args, onLine) {
  const child = spawn(command, args, { cwd: root, env: process.env });
  prefix(child.stdout, `[${name}]`, process.stdout, onLine);
  prefix(child.stderr, `[${name}]`, process.stderr, onLine);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // If either half stops, take the other down rather than leaving a
    // half-running dev environment that fails in a confusing way.
    process.stdout.write(`[dev] ${name} exited (${signal || code}); stopping\n`);
    shutdown(typeof code === 'number' ? code : 1);
  });
  children.push(child);
  return child;
}

const startWeb = () => start('web', viteBin, ['--host', '0.0.0.0']);

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** Resolve true when something is already accepting connections on the port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

let webStarted = false;
function startWebOnce(reason) {
  if (webStarted) return;
  webStarted = true;
  if (reason) process.stdout.write(`[dev] ${reason}\n`);
  startWeb();
}

function onApiLine(line) {
  if (webStarted) return;
  if (API_READY.test(line)) return startWebOnce();
  if (/error|fail|EADDRINUSE/i.test(line)) {
    return startWebOnce('the API reported a problem; starting the UI anyway');
  }
}

async function main() {
  if (await portInUse(apiPort)) {
    // Reuse it so the dashboard works immediately. It was not started here, so
    // it will not pick up changes to the backend until it is restarted.
    return startWebOnce(`an API is already running on port ${apiPort}; reusing it (restart it to pick up backend changes)`);
  }
  start('api', process.execPath, ['--watch', 'backend/server.js'], onApiLine);
  // Never leave the developer staring at a blank terminal if the log wording
  // changes and the ready line is never seen.
  setTimeout(() => startWebOnce('still waiting for the API; starting the UI anyway'), READY_TIMEOUT_MS).unref?.();
}

main();
