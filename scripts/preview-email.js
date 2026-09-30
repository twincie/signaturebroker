/**
 * Render the emails the system would really send, using the live product and
 * rate configuration, without sending anything.
 *
 *   npm run preview:email            all products
 *   npm run preview:email -- travel  one product
 *   open preview/email-preview.html
 *
 * Product names, field labels, email templates and premiums come from the
 * database and the real pricing engine, so what you review is what a customer
 * would receive. Only the customer's own details are illustrative.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoClient } from 'mongodb';

import { buildMessage, offersText } from '../backend/lib/email-template.js';
import { configuredOffers } from '../backend/lib/pricing.js';
import { detailsText } from '../shared/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'preview');
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

// Illustrative customer. Never a real customer's details.
const CUSTOMER = {
  name: 'Ada Lovelace',
  email: 'customer@example.com',
  phone: '0803 123 4567',
  reference: 'SB-2026-PREVIEW1',
};

/**
 * Answers are built from the product's own declared fields only. Inventing keys
 * the product does not have would show up in the email as extra rows, so every
 * value must correspond to a real field.
 */
const VALUE_FOR_KEY = {
  vehicleValue: 4500000,
  vehicleType: 'Sedan',
  duration: '1 year',
  usage: 'Private',
  dateOfBirth: '1990-04-12',
  destination: 'NG',
  startDate: '2026-11-01',
  endDate: '2026-11-08',
  travellers: 2,
  members: 2,
  coverArea: 'Lagos',
};

const VALUE_FOR_TYPE = {
  currency: 4500000,
  date: '2026-11-01',
  number: 2,
};

const PER_PRODUCT = {
  'motor-comprehensive': { vehicleValue: 4500000, duration: '1 year', usage: 'Private' },
  'motor-third-party': { vehicleType: 'Sedan', duration: '1 year' },
  travel: { dateOfBirth: '1990-04-12', destination: 'NG', startDate: '2026-11-01', endDate: '2026-11-08', travellers: 2 },
  health: { dateOfBirth: '1990-04-12', startDate: '2026-10-01', members: 2, coverArea: 'Lagos' },
};

/** Only the fields this product actually asks the customer for. */
function answersFor(product) {
  const overrides = PER_PRODUCT[product.id] || {};
  const answers = {};
  for (const field of product.fields || []) {
    if (field.key in overrides) answers[field.key] = overrides[field.key];
    else if (field.key in VALUE_FOR_KEY) answers[field.key] = VALUE_FOR_KEY[field.key];
    else if (VALUE_FOR_TYPE[field.type] !== undefined) answers[field.key] = VALUE_FOR_TYPE[field.type];
  }
  return answers;
}

const countryNames = (() => {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, 'data', 'countries.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.countries || [];
    return Object.fromEntries(list.map((item) => [item.code, item.name]));
  } catch {
    return {};
  }
})();

async function loadProducts() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set, so the real product configuration cannot be read.');

  const client = await MongoClient.connect(uri);
  try {
    const db = client.db();
    // The insurer list resolves rate insurer names and purchase links, exactly
    // as the running server does.
    const insurers = await db
      .collection('insurers')
      .find({ active: { $ne: false } })
      .toArray();
    const products = await db
      .collection('products')
      .find({ active: { $ne: false } })
      .sort({ name: 1 })
      .toArray();
    const matching = products.filter(
      (product) => !only.length || only.includes(product.id) || only.some((arg) => product.name.toLowerCase().includes(arg.toLowerCase()))
    );
    return { products: matching, insurers };
  } finally {
    await client.close();
  }
}

const money = (value, currency = 'NGN') => `${currency} ${Number(value || 0).toLocaleString('en-NG')}`;

/** Build the emails a single product would actually send today. */
function messagesFor(product, insurers) {
  const answers = answersFor(product);
  const config = product.emailConfig || {};
  const immediate = config.sendEmailImmediately ?? product.sendEmailImmediately === true;
  const mode = config.immediateEmailMode === 'quote' ? 'quote' : 'acknowledgement';
  const notifyTeam = config.notifyTeam !== false;

  // The real pricing engine, so the premiums shown are the real ones.
  const offers = configuredOffers(product, answers, insurers).map((offer) => ({
    id: offer.id,
    insurer: offer.insurer,
    plan: offer.plan,
    premium: offer.premium,
    currency: offer.currency || 'NGN',
    excess: offer.excess || '',
    waitingPeriod: offer.waitingPeriod || '',
    purchaseUrl: offer.purchaseUrl || '',
  }));

  const quote = {
    id: 'preview',
    reference: CUSTOMER.reference,
    name: CUSTOMER.name,
    email: CUSTOMER.email,
    phone: CUSTOMER.phone,
    productName: product.name,
    createdAt: new Date().toISOString(),
    details: answers,
    offers,
  };

  const context = {
    name: quote.name,
    email: quote.email,
    phone: quote.phone,
    reference: quote.reference,
    product: product.name,
    requestedDate: new Date(quote.createdAt).toDateString(),
    adminMessage: '',
    details: detailsText(product, answers, { countries: countryNames }),
    // The server fills this with the same helper, so use it here too.
    offers: offersText(quote),
  };

  const settings = {
    customerSubject: config.customerSubject ?? product.emailSubject ?? '',
    customerBody: config.customerBody ?? product.emailIntroduction ?? '',
    teamSubject: config.teamSubject || '',
    teamBody: config.teamBody || '',
  };

  const adminMessage = 'I have reviewed your request and these are the best rates I could find for you.';
  const out = [];

  if (immediate) {
    // This is what a customer gets the moment they submit the form.
    out.push({
      title: 'Customer — sent immediately on submission',
      note: `sendEmailImmediately=true, immediateEmailMode=${mode}`,
      to: CUSTOMER.email,
      kind: mode,
      message: buildMessage(
        mode,
        { ...context, adminMessage: mode === 'quote' ? adminMessage : '' },
        quote,
        settings,
        mode === 'quote' ? adminMessage : ''
      ),
    });
  } else {
    out.push({
      title: 'Customer — sent when you press "send quote" in the dashboard',
      note: `sendEmailImmediately=false, so the request waits at awaiting-review`,
      to: CUSTOMER.email,
      kind: 'quote',
      message: buildMessage('quote', context, quote, settings, adminMessage),
    });
  }

  if (notifyTeam) {
    out.push({
      title: 'Internal team notification',
      note: 'Sent to the brokerage team so a human can follow up',
      to: 'QUOTE_EMAIL_TO (internal)',
      kind: 'team',
      message: buildMessage('team', context, quote, settings),
    });
  } else {
    out.push({ title: 'Internal team notification', note: 'notifyTeam is off, so nothing is sent internally', skipped: true });
  }

  return { product, config, immediate, mode, offers, out };
}

const asAttribute = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const asText = (value) => String(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);

const loaded = await loadProducts();
const results = loaded.products.map((product) => messagesFor(product, loaded.insurers));
if (!results.length) throw new Error(`No active products matched ${JSON.stringify(only)}.`);

const blocks = results
  .map(({ product, config, immediate, mode, offers, out }) => {
    const usingDefaults = !config.customerSubject && !config.customerBody && !config.teamSubject && !config.teamBody;

    const summary = `
      <div class="config">
        <h2>${product.name}</h2>
        <table>
          <tr><th>Emails the customer immediately</th><td>${immediate ? 'yes' : 'no (held for review)'}</td></tr>
          <tr><th>Immediate mode</th><td>${immediate ? mode : 'n/a'}</td></tr>
          <tr><th>Notify the team</th><td>${config.notifyTeam !== false ? 'yes' : 'no'}</td></tr>
          <tr><th>Templates</th><td>${usingDefaults ? 'built-in defaults (nothing customised)' : 'customised'}</td></tr>
          <tr><th>Premiums produced</th><td>${offers.length ? offers.map((offer) => `${offer.insurer || '(no insurer name)'} — ${money(offer.premium, offer.currency)}`).join('<br>') : 'none'}</td></tr>
        </table>
      </div>`;

    const samples = out
      .map((sample) => {
        if (sample.skipped) return `<div class="sample skipped"><strong>${sample.title}</strong> — ${sample.note}</div>`;
        return `
        <div class="sample">
          <div class="sample-head">
            <h3>${sample.title}</h3>
            <p class="meta">${sample.note}</p>
            <p class="meta"><strong>To:</strong> ${sample.to}</p>
            <p class="meta"><strong>Subject:</strong> ${asText(sample.message.subject)}</p>
            <p class="meta"><strong>Size:</strong> ${(sample.message.html.length / 1024).toFixed(1)} kB</p>
          </div>
          <iframe class="frame" title="${sample.title}" sandbox srcdoc="${asAttribute(sample.message.html)}"></iframe>
          <details><summary>Plain text version</summary><pre>${asText(sample.message.text)}</pre></details>
        </div>`;
      })
      .join('');

    return `<section class="product">${summary}${samples}</section>`;
  })
  .join('');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signature Insurance Brokers — email preview</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px; background: #e2e8f0; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .intro { margin: 0 0 24px; color: #475569; max-width: 70ch; }
  .product { margin-bottom: 28px; background: #fff; border-radius: 14px; box-shadow: 0 1px 3px rgba(15,23,42,.12); overflow: hidden; }
  .config { padding: 18px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  .config h2 { margin: 0 0 10px; font-size: 17px; }
  .config table { border-collapse: collapse; font-size: 13px; }
  .config th { text-align: left; padding: 3px 14px 3px 0; color: #64748b; font-weight: 600; }
  .config td { padding: 3px 0; }
  .sample { border-bottom: 1px solid #e2e8f0; }
  .sample:last-child { border-bottom: 0; }
  .sample.skipped { padding: 14px 20px; color: #64748b; font-size: 13px; background: #fffbeb; }
  .sample-head { padding: 16px 20px 10px; }
  .sample-head h3 { margin: 0 0 6px; font-size: 15px; }
  .meta { margin: 2px 0; font-size: 13px; color: #475569; word-break: break-word; }
  .frame { border: 0; width: 100%; height: 760px; background: #fff; }
  details summary { padding: 12px 20px; cursor: pointer; font-size: 13px; color: #475569; }
  pre { margin: 0; padding: 0 20px 18px; white-space: pre-wrap; font-size: 12px; color: #334155; }
</style>
</head>
<body>
  <h1>Signature Insurance Brokers — email preview</h1>
  <p class="intro">Generated by <code>npm run preview:email</code>. Nothing was sent. Product names, field labels, templates and premiums are read from the live database and calculated by the real pricing engine, so this is what a customer would receive. The customer's own details are illustrative.</p>
  ${blocks}
</body>
</html>`;

mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'email-preview.html');
writeFileSync(outFile, page, 'utf8');

console.log(`Wrote ${path.relative(root, outFile)} for ${results.length} product(s).`);
for (const { product, offers } of results) {
  console.log(
    `  ${product.id}: ${offers.length} premium(s)${offers.length ? ` — ${offers.map((offer) => offer.insurer || '(no insurer name)').join(', ')}` : ''}`
  );
}
console.log(`\nOpen it with:  open ${path.relative(root, outFile)}`);
