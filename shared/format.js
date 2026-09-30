const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function humanize(key) {
  const spaced = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : String(key);
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return String(value);
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : String(value);
}

function formatNumber(value) {
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return String(value);
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-NG') : String(value);
}

export function displayValue(field, raw, lookup = {}) {
  if (raw === null || raw === undefined || raw === '') return '';
  switch (field?.type) {
    case 'select': {
      const option = (field.options || []).find((item) => item.value === raw);
      return option ? option.label : String(raw);
    }
    case 'country':
      return lookup.countries?.[raw] || String(raw);
    case 'currency':
      return formatNumber(raw);
    case 'date':
      return formatDate(raw);
    case 'number':
      return formatNumber(raw);
    default:
      return String(raw);
  }
}

export function formatDetails(product, details, lookup = {}) {
  const fields = product?.fields || [];
  const known = new Set(fields.map((field) => field.key));
  const rows = [];
  for (const field of fields) {
    const raw = details?.[field.key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = displayValue(field, raw, lookup);
    if (!value) continue;
    rows.push({ key: field.key, label: field.label || humanize(field.key), value });
  }
  for (const [key, raw] of Object.entries(details || {})) {
    if (known.has(key) || raw === null || raw === undefined || raw === '') continue;
    rows.push({ key, label: humanize(key), value: String(raw) });
  }
  return rows;
}

export function detailsText(product, details, lookup = {}) {
  const rows = formatDetails(product, details, lookup);
  if (!rows.length) return 'No additional answers were provided.';
  return rows.map((row) => `${row.label}: ${row.value}`).join('\n');
}
