import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { BSON } from 'mongodb';
import { configuredOffers, ageFromDate } from '../backend/lib/pricing.js';

const insurers = [
  { id: 'default-insurer', name: 'Default insurer', website: '' },
  { id: 'aiico', name: 'AIICO Insurance', website: 'https://aiico.example' },
];

const product = (rates, extra = {}) => ({ id: 'test', name: 'Test Cover', benefits: ['B1'], exclusions: ['E1'], rates, ...extra });

test('ageFromDate computes whole years and respects birthdays', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  assert.equal(ageFromDate('1990-09-27', now), 36, 'birthday today has not yet occurred in UTC terms');
  assert.equal(ageFromDate('1990-09-26', now), 36);
  assert.equal(ageFromDate('1990-09-28', now), 35);
  assert.equal(ageFromDate('not-a-date', now), null);
  assert.equal(ageFromDate(undefined, now), null);
});

test('fixed model returns the configured amount', () => {
  const offers = configuredOffers(
    product([{ id: 'r1', insurerId: 'aiico', model: 'fixed', amount: 15000, currency: 'NGN' }]),
    {},
    insurers
  );
  assert.equal(offers.length, 1);
  assert.equal(offers[0].premium, 15000);
  assert.equal(offers[0].insurer, 'AIICO Insurance');
});

test('percentage model uses the insured value', () => {
  const offers = configuredOffers(
    product([{ id: 'r1', insurerId: 'default-insurer', model: 'percentage', percentage: 5 }]),
    { vehicleValue: 1000000 },
    insurers
  );
  assert.equal(offers[0].premium, 50000);
});

test('percentage model accepts sumInsured as an alternative value field', () => {
  const offers = configuredOffers(
    product([{ id: 'r1', insurerId: 'default-insurer', model: 'percentage', percentage: 5 }]),
    { sumInsured: '2,000,000' },
    insurers
  );
  assert.equal(offers[0].premium, 100000);
});

test('percentage model honours an explicit valueField over the defaults', () => {
  const offers = configuredOffers(
    product([{ id: 'r1', insurerId: 'default-insurer', model: 'percentage', percentage: 10, valueField: 'declaredValue' }]),
    { declaredValue: 500000, vehicleValue: 900000 },
    insurers
  );
  assert.equal(offers[0].premium, 50000);
});

test('percentage model yields no offer when the value is missing or zero', () => {
  assert.deepEqual(
    configuredOffers(product([{ id: 'r1', insurerId: 'default-insurer', model: 'percentage', percentage: 5 }]), {}, insurers),
    []
  );
  assert.deepEqual(
    configuredOffers(
      product([{ id: 'r1', insurerId: 'default-insurer', model: 'percentage', percentage: 5 }]),
      { vehicleValue: 0 },
      insurers
    ),
    []
  );
});

test('age-bands selects the matching band and multiplies by members', () => {
  const rates = [
    {
      id: 'r1',
      insurerId: 'default-insurer',
      model: 'age-bands',
      ageBands: [
        { minAge: 0, maxAge: 17, amount: 50000 },
        { minAge: 18, maxAge: 35, amount: 89500 },
      ],
    },
  ];
  const now = new Date();
  const birth = new Date(Date.UTC(now.getUTCFullYear() - 30, 0, 1)).toISOString().slice(0, 10);
  const offers = configuredOffers(product(rates), { dateOfBirth: birth, members: 2 }, insurers);
  assert.equal(offers[0].premium, 179000);
});

test('age-bands drops the offer when the age falls outside every band', () => {
  const rates = [{ id: 'r1', insurerId: 'default-insurer', model: 'age-bands', ageBands: [{ minAge: 0, maxAge: 17, amount: 50000 }] }];
  const now = new Date();
  const birth = new Date(Date.UTC(now.getUTCFullYear() - 50, 0, 1)).toISOString().slice(0, 10);
  assert.deepEqual(configuredOffers(product(rates), { dateOfBirth: birth }, insurers), []);
});

test('age-bands treats a missing member count as a single member', () => {
  const rates = [{ id: 'r1', insurerId: 'default-insurer', model: 'age-bands', ageBands: [{ minAge: 0, maxAge: 120, amount: 10000 }] }];
  const now = new Date();
  const birth = new Date(Date.UTC(now.getUTCFullYear() - 30, 0, 1)).toISOString().slice(0, 10);
  assert.equal(configuredOffers(product(rates), { dateOfBirth: birth }, insurers)[0].premium, 10000);
});

test('risk loadings apply only when the field matches', () => {
  const rates = [
    {
      id: 'r1',
      insurerId: 'default-insurer',
      model: 'fixed',
      amount: 100000,
      loadings: [{ field: 'usage', equals: 'commercial', percentage: 10 }],
    },
  ];
  assert.equal(configuredOffers(product(rates), { usage: 'commercial' }, insurers)[0].premium, 110000);
  assert.equal(configuredOffers(product(rates), { usage: 'private' }, insurers)[0].premium, 100000);
});

test('rates are excluded outside their validity window', () => {
  const expired = [{ id: 'r1', insurerId: 'default-insurer', model: 'fixed', amount: 1000, validTo: '2020-01-01' }];
  const future = [{ id: 'r2', insurerId: 'default-insurer', model: 'fixed', amount: 1000, validFrom: '2999-01-01' }];
  assert.deepEqual(configuredOffers(product(expired), {}, insurers), []);
  assert.deepEqual(configuredOffers(product(future), {}, insurers), []);
});

test('inactive rates are excluded', () => {
  assert.deepEqual(
    configuredOffers(product([{ id: 'r1', insurerId: 'default-insurer', model: 'fixed', amount: 1000, active: false }]), {}, insurers),
    []
  );
});

test('underwriting-only rates produce no premium', () => {
  assert.deepEqual(
    configuredOffers(product([{ id: 'r1', insurerId: 'default-insurer', model: 'underwriting' }]), { vehicleValue: 500000 }, insurers),
    []
  );
});

test('selectedInsurerId narrows results to one insurer', () => {
  const rates = [
    { id: 'r1', insurerId: 'default-insurer', model: 'fixed', amount: 1000 },
    { id: 'r2', insurerId: 'aiico', model: 'fixed', amount: 2000 },
  ];
  const offers = configuredOffers(product(rates), {}, insurers, 'aiico');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].insurerId, 'aiico');
});

test('the insurer website becomes the purchase url when present', () => {
  const offers = configuredOffers(product([{ id: 'r1', insurerId: 'aiico', model: 'fixed', amount: 1000 }]), {}, insurers);
  assert.equal(offers[0].purchaseUrl, 'https://aiico.example');
});

test('premiums are rounded to whole units', () => {
  const offers = configuredOffers(
    product([{ id: 'r1', insurerId: 'default-insurer', model: 'percentage', percentage: 3.333 }]),
    { vehicleValue: 100001 },
    insurers
  );
  assert.equal(offers[0].premium, 3333);
});

test('a product with no rates yields no offers', () => {
  assert.deepEqual(configuredOffers(product([]), { vehicleValue: 100 }, insurers), []);
});

const load = (name, dir) => BSON.EJSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'), { relaxed: true });

function latestBackupDir() {
  if (process.env.SIGNATURE_BACKUP_DIR) return process.env.SIGNATURE_BACKUP_DIR;
  try {
    const root = new URL('../backups/', import.meta.url);
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return entries.length ? new URL(`${entries[entries.length - 1]}/`, root).pathname : '';
  } catch {
    return '';
  }
}

const backupDir = latestBackupDir();

test('reproduces the stored premium for every backed-up quote', { skip: !backupDir }, () => {
  const products = load('products', backupDir);
  const quotes = load('quotes', backupDir);
  const backupInsurers = load('insurers', backupDir);
  let checked = 0;
  for (const quote of quotes) {
    const found = products.find((item) => item.id === quote.productId);
    const offers = configuredOffers(found, quote.details, backupInsurers);
    if (!offers.length || !quote.offers?.length) continue;
    assert.equal(offers[0].premium, quote.offers[0].premium, `premium mismatch for ${quote.reference}`);
    checked++;
  }
  assert.ok(checked > 0, 'expected at least one quote with offers to verify');
});
