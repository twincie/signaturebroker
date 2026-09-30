import { findInsurer, isPlaceholderInsurer } from './insurers.js';

const DEFAULT_VALUE_FIELDS = ['vehicleValue', 'sumInsured'];
const DEFAULT_AGE_FIELD = 'dateOfBirth';
const DEFAULT_MULTIPLIER_FIELD = 'members';

export function ageFromDate(value, now = new Date()) {
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate()))
    age--;
  return age;
}

function numericDetail(details, fields) {
  for (const field of [].concat(fields).filter(Boolean)) {
    const raw = details?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = Number(String(raw).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isRateLive(rate, today) {
  if (rate.active === false) return false;
  if (rate.validFrom && rate.validFrom > today) return false;
  if (rate.validTo && rate.validTo < today) return false;
  return true;
}

function basePremium(rate, details) {
  if (rate.model === 'fixed') return Number(rate.amount);
  if (rate.model === 'percentage') {
    const base = numericDetail(details, rate.valueField || DEFAULT_VALUE_FIELDS);
    return base === null ? null : (base * Number(rate.percentage)) / 100;
  }
  if (rate.model === 'age-bands') {
    const age = ageFromDate(details?.[rate.ageField || DEFAULT_AGE_FIELD]);
    if (age === null) return null;
    const band = (rate.ageBands || []).find((item) => age >= item.minAge && age <= item.maxAge);
    if (!band) return null;
    const multiplier = rate.multiplierField === null ? 1 : numericDetail(details, rate.multiplierField || DEFAULT_MULTIPLIER_FIELD);
    return Number(band.amount) * (multiplier === null ? 1 : multiplier);
  }
  return null;
}

export function configuredOffers(product, details, insurers = [], selectedInsurerId = '', today = new Date().toISOString().slice(0, 10)) {
  return (product.rates || [])
    .filter((rate) => isRateLive(rate, today) && (!selectedInsurerId || findInsurer(insurers, rate)?.id === selectedInsurerId))
    .map((rate) => {
      let premium = basePremium(rate, details);
      if (premium === null) return null;
      for (const loading of rate.loadings || []) {
        if (String(details?.[loading.field]) === loading.equals) premium *= 1 + Number(loading.percentage) / 100;
      }
      if (!Number.isFinite(premium) || premium <= 0) return null;
      const insurer = findInsurer(insurers, rate);
      return {
        id: rate.id,
        insurer: insurer?.name || rate.insurer || 'Insurer',
        // Empty when the premium came from the broker's default table rather
        // than a real insurer, so customer emails leave the insurer out instead
        // of printing the placeholder name.
        insurerName: isPlaceholderInsurer(insurer) ? '' : insurer.name,
        insurerId: insurer?.id || rate.insurerId || '',
        plan: product.name,
        premium: Math.round(premium),
        currency: rate.currency || 'NGN',
        benefits: product.benefits || [],
        exclusions: product.exclusions || [],
        excess: rate.excess || '',
        waitingPeriod: rate.waitingPeriod || '',
        purchaseUrl: insurer?.website || null,
      };
    })
    .filter(Boolean);
}
