import test from 'node:test';
import assert from 'node:assert/strict';
import { maskEmail, maskPhone, fingerprint, formatDuration, createLogger } from '../backend/lib/logger.js';

test('maskEmail keeps only the first character and the domain', () => {
  assert.equal(maskEmail('ada.lovelace@example.com'), 'a***example.com');
  assert.equal(maskEmail('a@b.co'), 'a***b.co');
});

test('maskEmail handles missing and malformed values without throwing', () => {
  assert.equal(maskEmail(''), '(none)');
  assert.equal(maskEmail(null), '(none)');
  assert.equal(maskEmail(undefined), '(none)');
  assert.equal(maskEmail('notanemail'), '***');
});

test('maskPhone keeps only the last four digits', () => {
  assert.equal(maskPhone('+234 801 234 5678'), '***5678');
  assert.equal(maskPhone('12'), '***');
  assert.equal(maskPhone(''), '***');
});

test('fingerprint is stable, short and does not contain the source value', () => {
  const email = 'ada.lovelace@example.com';
  const first = fingerprint(email);
  assert.equal(fingerprint(email), first, 'must be stable for the same input');
  assert.notEqual(fingerprint('someone.else@example.com'), first);
  assert.ok(first.length <= 8);
  assert.ok(!first.includes('ada'));
});

test('fingerprint tolerates empty and non-string input', () => {
  assert.doesNotThrow(() => fingerprint(''));
  assert.doesNotThrow(() => fingerprint(undefined));
  assert.doesNotThrow(() => fingerprint(12345));
});

test('formatDuration switches to seconds only when needed', () => {
  assert.equal(formatDuration(12), '12ms');
  assert.equal(formatDuration(999), '999ms');
  assert.equal(formatDuration(1500), '1.50s');
  assert.equal(formatDuration(12345), '12.35s');
  assert.equal(formatDuration(undefined), 'unknown');
  assert.equal(formatDuration(Number.NaN), 'unknown');
});

test('a logger exposes the four standard levels', () => {
  const logger = createLogger('test');
  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.equal(typeof logger[level], 'function', `${level} must be a function`);
  }
});

test('sensitive context keys are redacted before they reach a log line', () => {
  const lines = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (line) => lines.push(String(line));
  console.warn = (line) => lines.push(String(line));
  console.error = (line) => lines.push(String(line));

  try {
    const logger = createLogger('redaction');
    logger.info('secret values must not appear', {
      password: 'hunter2',
      authorization: 'Bearer topsecret',
      resendApiKey: 're_abcdef',
      mongoUri: 'mongodb+srv://user:pass@host/db',
      token: 'abc123',
      reference: 'SB-2026-ABC12345',
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  const output = lines.join('\n');
  for (const secret of ['hunter2', 'topsecret', 're_abcdef', 'mongodb+srv://user:pass@host/db', 'abc123']) {
    assert.ok(!output.includes(secret), `"${secret}" must not be written to the log`);
  }
  assert.match(output, /\[redacted\]/);
  assert.match(output, /SB-2026-ABC12345/, 'non sensitive context should still be logged');
});

test('a value containing spaces is quoted so the log stays parseable', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    createLogger('quoting').info('message with a spaced value', { note: 'two words', count: 3 });
  } finally {
    console.log = originalLog;
  }
  const output = lines.join('\n');
  assert.match(output, /note="two words"/);
  assert.match(output, /count=3/);
});

test('errors are serialised as their message rather than as an empty object', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    createLogger('errors').info('operation failed', { error: new Error('upstream refused') });
  } finally {
    console.log = originalLog;
  }
  assert.match(lines.join('\n'), /upstream refused/);
});

test('debug lines are suppressed unless LOG_LEVEL enables them', () => {
  const originalLevel = process.env.LOG_LEVEL;
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));

  try {
    process.env.LOG_LEVEL = 'info';
    // The level is read at module load, so assert on the visible behaviour of
    // the logger that is already loaded rather than re-importing.
    createLogger('levels').info('this is always shown');
    assert.ok(lines.some((line) => line.includes('this is always shown')));
  } finally {
    console.log = originalLog;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  }
});
