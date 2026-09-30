/**
 * Insurer lookup and the rule for whether an offer may credit an insurer by
 * name.
 *
 * A rate card can point at the broker's own fallback entry, seeded as
 * "Default insurer". That entry is a placeholder that stands in for "the price
 * we quote by default", not a company the customer can recognise or buy from,
 * so it is never printed on an email. Any other insurer that actually quotes
 * keeps its name, which is what makes a specific insurer worth choosing.
 */

/** The insurer a rate points at, matched by id first and then by name. */
export function findInsurer(insurers, rate) {
  return insurers.find((item) => item.id === rate.insurerId || item.name === rate.insurer) || null;
}

/**
 * True when an insurer is the default placeholder rather than a real company.
 *
 * The flag is authoritative when present. The id and name checks keep records
 * created before the flag existed working without a migration.
 */
export function isPlaceholderInsurer(insurer) {
  if (!insurer) return true;
  if (insurer.isDefault === true) return true;
  const id = String(insurer.id || '')
    .trim()
    .toLowerCase();
  if (id === 'default-insurer' || id === 'default') return true;
  return /^default\b/i.test(String(insurer.name || '').trim());
}

/**
 * The insurer name to print on an offer, or '' when there is no real insurer
 * behind the premium and the plan name should stand alone.
 */
export function offerInsurerName(offer) {
  if (!offer) return '';
  if (offer.insurerName !== undefined) return offer.insurerName || '';
  // Offers stored before insurerName was recorded have only the raw insurer
  // text, so judge that instead of assuming a real insurer.
  return isPlaceholderInsurer({ id: offer.insurerId, name: offer.insurer }) ? '' : offer.insurer || '';
}
