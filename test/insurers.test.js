import test from 'node:test';
import assert from 'node:assert/strict';
import { findInsurer, isPlaceholderInsurer, offerInsurerName } from '../backend/lib/insurers.js';

const defaultInsurer = { id: 'default-insurer', name: 'Default insurer' };

test('findInsurer matches a rate by insurer id, then by insurer name', () => {
  const insurers = [defaultInsurer, { id: 'aiico', name: 'AIICO Insurance' }];
  assert.equal(findInsurer(insurers, { insurerId: 'aiico' }).id, 'aiico');
  assert.equal(findInsurer(insurers, { insurer: 'AIICO Insurance' }).id, 'aiico');
  // A rate that names the seeded fallback must still resolve, or the premium
  // would be dropped entirely rather than just unnamed.
  assert.equal(findInsurer(insurers, { insurer: 'Default insurer' }).id, 'default-insurer');
  assert.equal(findInsurer(insurers, { insurerId: 'nobody' }), null);
});

test('the default placeholder is recognised however it was seeded', () => {
  assert.equal(isPlaceholderInsurer(null), true);
  assert.equal(isPlaceholderInsurer({ id: 'x', name: 'Default insurer' }), true);
  assert.equal(isPlaceholderInsurer({ id: 'default-insurer', name: 'Anything At All' }), true);
  assert.equal(isPlaceholderInsurer({ id: 'x', name: 'Default' }), true);
  // An explicit flag is authoritative even if the name looks like a company.
  assert.equal(isPlaceholderInsurer({ id: 'x', name: 'AXA Mansard', isDefault: true }), true);
});

test('a real insurer is not mistaken for the placeholder', () => {
  for (const name of ['AIICO Insurance', 'AXA Mansard Insurance', 'Leadway Assurance', 'INCO']) {
    assert.equal(isPlaceholderInsurer({ id: 'x', name }), false, `${name} is a real insurer`);
  }
  // A name that merely starts with the same letters is still a real insurer.
  assert.equal(isPlaceholderInsurer({ id: 'x', name: 'Defaulted Coverage Ltd' }), false);
});

test('offerInsurerName credits a real insurer and drops the placeholder', () => {
  assert.equal(offerInsurerName({ insurerName: 'AXA Mansard Insurance' }), 'AXA Mansard Insurance');
  assert.equal(offerInsurerName({ insurerName: '', insurer: 'Default insurer' }), '');
  assert.equal(offerInsurerName({ insurerName: '', insurer: 'AIICO Insurance', insurerId: 'aiico' }), '');
});

test('offers stored before insurerName existed are judged on what they recorded', () => {
  // Legacy default rate: the placeholder must not appear on a past email.
  assert.equal(offerInsurerName({ insurer: 'Default insurer', insurerId: 'default-insurer' }), '');
  // Legacy real insurer: the name has to survive.
  assert.equal(offerInsurerName({ insurer: 'AIICO Insurance', insurerId: 'aiico' }), 'AIICO Insurance');
  assert.equal(offerInsurerName({ insurer: 'Default insurer' }), '');
  assert.equal(offerInsurerName(null), '');
});
