/**
 * The admin dashboard is a plain page of script and markup, so a typo in an id
 * or a missing element only shows up when a button is clicked in a browser.
 * These checks compare the two files so that drift fails here instead.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'frontend/admin.html'), 'utf8');
const js = await readFile(path.join(root, 'frontend/admin.js'), 'utf8');
const css = await readFile(path.join(root, 'frontend/admin.css'), 'utf8');

// Some of the dashboard is built by the script itself, so an id it reaches for
// may live in a template string rather than in the page file. Collect both.
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const scriptIds = new Set([...js.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
const known = new Set([...htmlIds, ...scriptIds]);

test('every id the admin script reaches for exists in the page', () => {
  const referenced = new Set([...js.matchAll(/querySelector(?:All)?\('#([\w-]+)'\)/g)].map((m) => m[1]));
  const missing = [...referenced].filter((id) => !known.has(id));
  assert.deepEqual(missing, [], `admin.js refers to missing element ids: ${missing.join(', ')}`);
});

test('every id the admin page declares is unique', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], 'duplicate ids make querySelector pick the wrong element');
});

test('the review window offers one place to read, edit and send', () => {
  const start = html.indexOf('<dialog id="preview-dialog">');
  const dialog = html.slice(start, html.lastIndexOf('</dialog>'));
  // The message editor and the send button must live inside the review window,
  // not out in the lead row, so the reviewed text is the text that is sent.
  for (const id of ['preview-message', 'preview-send', 'preview-status', 'preview-frame']) {
    assert.match(dialog, new RegExp(`id="${id}"`), `${id} belongs inside the review window`);
  }
});

test('the lead row keeps no separate message box or send button', () => {
  const row = js.slice(js.indexOf('class="quote-item quote-workflow"'));
  const rowEnd = row.indexOf('</article>');
  const markup = row.slice(0, rowEnd);
  assert.doesNotMatch(markup, /admin-message-editor/, 'the row no longer edits the message');
  assert.doesNotMatch(markup, /send-quote/, 'the row no longer sends on its own');
  // The stored message has to reach the dialog, otherwise reopening a lead
  // would show an empty box and risk sending without what was written before.
  assert.match(markup, /data-admin-message=/, 'the row carries the stored message');
});

test('the review window is only made visible by the open attribute', () => {
  // A bare `display: flex` on the dialog would show it at the foot of the page
  // before the button is pressed, which is the bug this guards against.
  assert.doesNotMatch(css, /(^|[,{}\s])dialog\s*\{[^}]*display:\s*flex/, 'dialogs are not forced open by default');
  assert.match(css, /#preview-dialog\[open\]/, 'the open dialog is laid out as a flex column');
});
