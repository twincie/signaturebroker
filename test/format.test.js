import test from 'node:test';
import assert from 'node:assert/strict';
import { displayValue, formatDetails, detailsText } from '../shared/format.js';

const product = {
  id: 'motor',
  name: 'Motor',
  fields: [
    { key: 'vehicleValue', label: 'Estimated value of vehicle', type: 'currency' },
    {
      key: 'usage',
      label: 'Usage',
      type: 'select',
      options: [
        { value: 'private', label: 'Private' },
        { value: 'commercial', label: 'Commercial' },
      ],
    },
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { key: 'travellers', label: 'Number of travellers', type: 'number' },
    { key: 'destination', label: 'Destination country', type: 'country' },
  ],
};

const lookup = { countries: { IT: 'Italy', NG: 'Nigeria' } };

test('select values resolve to their configured label', () => {
  assert.equal(displayValue(product.fields[1], 'commercial'), 'Commercial');
});

test('an unrecognised select value falls back to the raw value', () => {
  assert.equal(displayValue(product.fields[1], 'mystery'), 'mystery');
});

test('country codes resolve to country names', () => {
  assert.equal(displayValue(product.fields[4], 'IT', lookup), 'Italy');
});

test('an unknown country code falls back to the raw code', () => {
  assert.equal(displayValue(product.fields[4], 'ZZ', lookup), 'ZZ');
});

test('currency values are grouped for readability', () => {
  assert.equal(displayValue(product.fields[0], 1000000), '1,000,000');
  assert.equal(displayValue(product.fields[0], '2,500,000'), '2,500,000');
});

test('number values are grouped for readability', () => {
  assert.equal(displayValue(product.fields[3], 4), '4');
  assert.equal(displayValue(product.fields[3], '12'), '12');
});

test('dates are humanised without a timezone shift', () => {
  assert.equal(displayValue(product.fields[2], '1990-05-12'), '12 May 1990');
  assert.equal(displayValue(product.fields[2], '2026-01-01'), '1 January 2026');
  assert.equal(displayValue(product.fields[2], '2026-12-31'), '31 December 2026');
});

test('a malformed date is passed through unchanged rather than mangled', () => {
  assert.equal(displayValue(product.fields[2], '12/05/1990'), '12/05/1990');
});

test('an unparseable numeric value shows the raw input instead of collapsing to zero', () => {
  assert.equal(displayValue(product.fields[0], 'a lot'), 'a lot');
  assert.equal(displayValue(product.fields[0], {}), '[object Object]');
});

test('empty values render as an empty string', () => {
  assert.equal(displayValue(product.fields[0], ''), '');
  assert.equal(displayValue(product.fields[0], null), '');
  assert.equal(displayValue(product.fields[0], undefined), '');
});

test('formatDetails pairs each answer with its configured label', () => {
  const rows = formatDetails(product, { vehicleValue: 1000000, usage: 'private' }, lookup);
  assert.deepEqual(rows, [
    { key: 'vehicleValue', label: 'Estimated value of vehicle', value: '1,000,000' },
    { key: 'usage', label: 'Usage', value: 'Private' },
  ]);
});

test('answers whose field no longer exists are still shown with a readable label', () => {
  const rows = formatDetails(product, { legacyField: 'kept' }, lookup);
  assert.deepEqual(rows, [{ key: 'legacyField', label: 'Legacy field', value: 'kept' }]);
});

test('camelCase keys are humanised when no label is available', () => {
  const rows = formatDetails({ fields: [] }, { dateOfBirth_x: 'v', plain_key: 'w' });
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Date of birth x', 'Plain key']
  );
});

test('empty and missing answers are omitted entirely', () => {
  const rows = formatDetails(product, { vehicleValue: '', usage: null, travellers: undefined });
  assert.deepEqual(rows, []);
});

test('formatDetails tolerates a product with no field configuration', () => {
  assert.deepEqual(formatDetails({}, {}), []);
  assert.deepEqual(formatDetails(undefined, undefined), []);
});

test('detailsText renders one label and value per line', () => {
  const text = detailsText(product, { vehicleValue: 1000000, usage: 'commercial' }, lookup);
  assert.equal(text, 'Estimated value of vehicle: 1,000,000\nUsage: Commercial');
});

test('detailsText states plainly when nothing was provided', () => {
  assert.equal(detailsText(product, {}), 'No additional answers were provided.');
});
