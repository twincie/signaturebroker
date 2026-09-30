/**
 * Structured logging for the Signature Broker backend.
 *
 * Goals:
 *   - Make production problems diagnosable from the log stream alone.
 *   - Never write customer personal data to disk.
 *
 * Every line is `[timestamp] LEVEL scope key=value ...` so a log can be
 * grepped or parsed without a JSON logging dependency.
 *
 * Levels, most severe first:
 *   error   something failed and a human needs to act
 *   warn    unexpected but recoverable
 *   info    normal lifecycle events (startup, request completion)
 *   debug   per-step detail, enabled with LOG_LEVEL=debug
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configuredLevel] ?? LEVELS.info;

const useColour = process.env.NO_COLOR ? false : process.stdout.isTTY && process.env.NODE_ENV !== 'production';

const COLOURS = {
  error: '\u001b[31m',
  warn: '\u001b[33m',
  info: '\u001b[36m',
  debug: '\u001b[90m',
  reset: '\u001b[0m',
  dim: '\u001b[90m',
};

/** Values that must never be written to a log file verbatim. */
const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'confirmpassword',
  'authorization',
  'cookie',
  'apikey',
  'resendapikey',
  'mongouri',
  'token',
  'secret',
]);

/**
 * Mask an email address so support can confirm which mailbox a problem
 * relates to without the log file becoming a list of customer addresses.
 */
export function maskEmail(value) {
  const address = String(value ?? '').trim();
  if (!address) return '(none)';
  const at = address.indexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at + 1)}`;
}

/** Keep only the last few characters of a phone number. */
export function maskPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

/** A short, non-reversible fingerprint used to correlate log lines. */
export function fingerprint(value) {
  const text = String(value ?? '');
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

function redact(key, value) {
  if (REDACTED_KEYS.has(String(key).toLowerCase())) return '[redacted]';
  return value;
}

function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Error) return JSON.stringify(value.message);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '"[unserialisable]"';
    }
  }
  if (typeof value === 'string' && /[\s"=]/.test(value)) return JSON.stringify(value);
  return String(value);
}

/** Turn a context object into `key=value` pairs. */
function formatContext(context) {
  const parts = [];
  for (const [key, raw] of Object.entries(context || {})) {
    if (raw === undefined) continue;
    const safe = redact(key, raw);
    parts.push(`${key}=${formatValue(safe)}`);
  }
  return parts;
}

function write(level, scope, message, context) {
  if (LEVELS[level] > threshold) return;

  const timestamp = new Date().toISOString();
  const pairs = formatContext(context);
  const line = `${COLOURS.dim}${timestamp}${COLOURS.reset} ${COLOURS[level]}${level.toUpperCase().padEnd(5)}${COLOURS.reset} ${COLOURS.dim}${scope}${COLOURS.reset} ${message}`;

  const output = pairs.length ? `${line} ${COLOURS.dim}${pairs.join(' ')}${COLOURS.reset}` : line;

  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

/**
 * Create a logger bound to a scope, e.g. `createLogger('quote')`.
 * The returned object exposes `debug`, `info`, `warn` and `error`.
 */
export function createLogger(scope) {
  return {
    debug: (message, context) => write('debug', scope, message, context),
    info: (message, context) => write('info', scope, message, context),
    warn: (message, context) => write('warn', scope, message, context),
    error: (message, context) => write('error', scope, message, context),
  };
}

/** Format a duration for a log line. */
export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'unknown';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

/** Log an unexpected error together with its stack, for diagnosis. */
export function logError(logger, message, error, context = {}) {
  logger.error(message, { ...context, error });
  if (error?.stack) {
    console.error(COLOURS.dim + error.stack.split('\n').slice(1, 5).join('\n') + COLOURS.reset);
  }
}
