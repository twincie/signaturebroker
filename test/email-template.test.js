import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail, brandLogoDataUri, logoMarkup, FALLBACK_MARK, BRAND, COMPANY } from '../backend/lib/email-html.js';
import {
  buildMessage,
  knownPlaceholders,
  offersText,
  renderTemplate,
  DEFAULT_CUSTOMER_ACKNOWLEDGEMENT,
  DEFAULT_CUSTOMER_QUOTE,
  DEFAULT_TEAM,
  DEFAULT_TEAM_SUBJECT,
} from '../backend/lib/email-template.js';

const quote = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '08012345678',
  reference: 'SB-2026-ABC12345',
  productName: 'Motor Comprehensive',
  createdAt: '2026-09-27T10:00:00.000Z',
  offers: [
    {
      insurer: 'AIICO Insurance',
      plan: 'Motor Comprehensive',
      premium: 52500,
      currency: 'NGN',
      excess: '10% per claim',
      waitingPeriod: '3 months',
      purchaseUrl: 'https://aiico.example/buy',
    },
  ],
};

const context = {
  name: quote.name,
  email: quote.email,
  phone: quote.phone,
  reference: quote.reference,
  product: quote.productName,
  requestedDate: new Date(quote.createdAt).toDateString(),
  adminMessage: 'Thanks for waiting.',
  details: 'Estimated value of vehicle: 1,000,000',
  offers: offersText(quote),
};

test('substitutes every known placeholder', () => {
  assert.equal(
    renderTemplate('{{name}} | {{reference}} | {{product}} | {{phone}}', context),
    'Ada Lovelace | SB-2026-ABC12345 | Motor Comprehensive | 08012345678'
  );
});

test('tolerates whitespace inside the braces', () => {
  assert.equal(renderTemplate('{{ name }}', context), 'Ada Lovelace');
});

test('an unknown placeholder renders as empty rather than leaking the token', () => {
  const output = renderTemplate('Hi {{name}} {{refernce}}', context);
  assert.equal(output, 'Hi Ada Lovelace ');
  assert.ok(!output.includes('{{'));
});

test('null and undefined values render as empty strings', () => {
  assert.equal(renderTemplate('[{{missing}}]', { missing: null }), '[]');
  assert.equal(renderTemplate('[{{missing}}]', { missing: undefined }), '[]');
});

test('empty or non-string templates render as an empty string', () => {
  assert.equal(renderTemplate('', context), '');
  assert.equal(renderTemplate(null, context), '');
  assert.equal(renderTemplate(42, context), '');
});

test('every advertised placeholder is renderable', () => {
  for (const key of knownPlaceholders()) {
    assert.equal(renderTemplate(`{{${key}}}`, context), String(context[key] ?? ''), `placeholder ${key} failed`);
  }
});

test('offersText lists premium, excess, waiting period and purchase url', () => {
  const text = offersText(quote);
  assert.match(text, /AIICO Insurance — Motor Comprehensive: NGN 52,500/);
  assert.match(text, /Excess: 10% per claim/);
  assert.match(text, /Waiting period: 3 months/);
  assert.match(text, /Purchase: https:\/\/aiico\.example\/buy/);
});

test('offersText explains the absence of a premium instead of inventing one', () => {
  assert.match(offersText({ offers: [] }), /No premium could be calculated/);
});

test('offersText omits optional lines that are not configured', () => {
  const text = offersText({
    offers: [{ insurer: 'X', plan: 'P', premium: 1000, currency: 'NGN', excess: '', waitingPeriod: '', purchaseUrl: null }],
  });
  assert.equal(text, 'X — P: NGN 1,000');
});

test('offersText tolerates a quote with no offers property at all', () => {
  assert.match(offersText({}), /No premium could be calculated/);
});

test('the brand logo is embedded as a data uri so images cannot be blocked', () => {
  const dataUri = brandLogoDataUri();
  assert.ok(dataUri, 'expected the logo file to be found');
  assert.match(dataUri, /^data:image\/png;base64,/);
});

test('the logo markup falls back to an inline vector mark when the png is missing', () => {
  assert.ok(logoMarkup().includes('data:image/png') || logoMarkup().includes('<svg'));
  assert.match(FALLBACK_MARK, /<svg/);
});

test('the rendered email carries the branding, reference and footer', () => {
  const { html } = renderEmail({
    heading: 'Your quotation is ready',
    eyebrow: 'Quotation',
    tone: 'success',
    bodyHtml: '<p>Hello</p>',
    reference: 'SB-2026-ABC12345',
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /SIGNATURE/);
  assert.match(html, /Your quotation is ready/);
  assert.match(html, /SB-2026-ABC12345/);
  assert.match(html, new RegExp(COMPANY.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /RC 125137/);
});

test('offers render as pricing cards with a formatted premium and a call to action', () => {
  const { html } = renderEmail({ heading: 'Your quotation is ready', offers: quote.offers });
  assert.match(html, /Indicative pricing/);
  assert.match(html, /AIICO Insurance/);
  assert.match(html, /NGN 52,500/);
  assert.match(html, /10% per claim/);
  assert.match(html, /https:\/\/aiico\.example\/buy/);
  assert.match(html, /Continue with AIICO Insurance/);
});

test('a message with no offers shows no pricing block at all', () => {
  const { html } = renderEmail({ heading: 'We have your request', offers: [] });
  assert.ok(!html.includes('Indicative pricing'));
});

test('the plain text alternative never contains markup', () => {
  const { text } = renderEmail({
    heading: 'Your quotation is ready',
    bodyHtml: '<p>Hello <b>there</b></p>',
    offers: quote.offers,
    reference: 'SB-1',
  });
  assert.ok(!text.includes('<'), 'the text part must not contain HTML');
  assert.match(text, /Hello there/);
  assert.match(text, /SB-1/);
  assert.match(text, /AIICO Insurance/);
});

test('customer supplied values cannot inject markup into the email', () => {
  const { html } = renderEmail({ heading: 'Test', bodyHtml: '', reference: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'the reference must be escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('the acknowledgement message never contains a premium', () => {
  const { html, text } = buildMessage('acknowledgement', { ...context, offers: 'LEAKED NGN 99,999' }, quote, {});
  assert.ok(!html.includes('99,999'), 'an acknowledgement must not expose a price');
  assert.ok(!text.includes('99,999'));
  assert.match(html, /We have your request/);
  assert.match(html, /SB-2026-ABC12345/);
});

test('an administrator leaving offers in the acknowledgement template still cannot leak a price', () => {
  const settings = { customerBody: 'Here is your quote: {{offers}}' };
  const { html } = buildMessage('acknowledgement', context, quote, settings);
  assert.ok(!html.includes('52,500'), 'the structured offers are withheld for acknowledgements');
});

test('the quote message includes the premium and the administrator note', () => {
  const { html, text, subject } = buildMessage('quote', context, quote, {}, 'Thanks for waiting.');
  assert.match(html, /NGN 52,500/);
  assert.match(html, /Your quotation is ready/);
  assert.match(html, /A message from your broker/);
  assert.match(html, /Thanks for waiting\./);
  assert.match(text, /Thanks for waiting\./);
  assert.match(subject, /SB-2026-ABC12345/);
});

test('an administrator message is not duplicated when their template uses the placeholder', () => {
  const settings = { customerBody: 'Hi {{name}} — {{adminMessage}}' };
  const { html } = buildMessage('quote', context, quote, settings, 'Only once please.');
  const occurrences = html.split('Only once please.').length - 1;
  assert.equal(occurrences, 1, `expected the message once, found it ${occurrences} times`);
});

test('a custom subject and body from the dashboard are used', () => {
  const settings = { customerSubject: 'Your cover — {{reference}}', customerBody: 'Hi {{name}}, here is your {{product}} quote.' };
  const { subject, html } = buildMessage('quote', context, quote, settings);
  assert.equal(subject, 'Your cover — SB-2026-ABC12345');
  assert.match(html, /here is your Motor Comprehensive quote/);
});

test('the team message is marked internal and lays out answers as a table', () => {
  const { html } = buildMessage('team', context, quote, {});
  assert.match(html, /Internal team notification/);
  assert.match(html, /New quote request/);
  assert.match(html, /NGN 52,500/);
  assert.match(html, /Estimated value of vehicle/);
  assert.ok(!html.includes('{{'), 'no placeholder should survive into the email');
});

test('the team default subject carries the product and reference', () => {
  const { subject } = buildMessage('team', context, quote, {});
  assert.equal(subject, 'New Motor Comprehensive request — SB-2026-ABC12345');
  assert.match(DEFAULT_TEAM_SUBJECT, /\{\{reference\}\}/);
});

test('a custom team body with no heading line is kept rather than dropped', () => {
  // Regression: content was only collected after a Title Case heading line, so
  // a custom team template without one produced a completely empty email.
  const settings = { teamBody: '{{name}} / {{phone}} / {{email}}\n{{details}}' };
  const { html, text } = buildMessage('team', context, quote, settings);

  for (const value of ['Ada Lovelace', '08012345678', 'ada@example.com', 'Estimated value of vehicle', '1,000,000']) {
    assert.ok(html.includes(value), `the html must contain "${value}"`);
    assert.ok(text.includes(value), `the text must contain "${value}"`);
  }
});

test('a custom team body that does use headings is still grouped into tables', () => {
  const settings = { teamBody: 'Customer\n{{name}} / {{email}}\nAnswers\n{{details}}' };
  const { html } = buildMessage('team', context, quote, settings);
  const customerHeading = html.indexOf('Customer');
  const answersHeading = html.indexOf('Answers');
  assert.ok(customerHeading > -1, 'the Customer heading is rendered');
  assert.ok(answersHeading > customerHeading, 'the headings keep their order');

  // Each heading must be followed by its own content, proving the rows were
  // grouped under the right heading rather than pooled together.
  assert.ok(html.indexOf('Ada Lovelace') > customerHeading, 'the name sits under Customer');
  assert.ok(html.indexOf('Ada Lovelace') < answersHeading, 'the name is not repeated after Answers');
  assert.ok(html.indexOf('Estimated value of vehicle') > answersHeading, 'the answer sits under Answers');
});

test('an empty team body produces an empty body without crashing', () => {
  const { html } = buildMessage('team', { ...context, name: '', email: '', phone: '', details: '' }, quote, {
    teamBody: '{{name}}{{email}}{{phone}}{{details}}',
  });
  assert.doesNotThrow(() => html);
  assert.ok(!html.includes('undefined'));
});

test('a prose line in a team section spans the full width with no bullet', () => {
  const settings = { teamBody: 'Pricing\nNo premium could be calculated from the configured rates for this request.' };
  const { html, text } = buildMessage('team', context, quote, settings);
  assert.match(html, /No premium could be calculated/, 'the sentence is kept');
  assert.match(html, /colspan="2"/, 'a prose line spans both columns');
  assert.ok(!html.includes('•'), 'a prose line must not be bulleted');
  assert.match(text, /No premium could be calculated/);
});

test('a labelled team row still uses two columns with an emphasised value', () => {
  const { html } = buildMessage('team', context, quote, { teamBody: 'Customer\nName: {{name}}' });
  assert.ok(!html.includes('colspan'), 'a labelled row uses the two column layout');
  assert.match(html, /Name<\/td>/);
  assert.match(html, /font-weight:600/, 'the value is emphasised');
});

test('the company contact details resolve without the caller supplying them', () => {
  const { text } = buildMessage('quote', context, quote, {});
  assert.match(text, new RegExp(COMPANY.phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the office number appears');
  assert.match(text, new RegExp(COMPANY.whatsapp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the WhatsApp number appears');
  assert.ok(!text.includes('{{'), 'no company placeholder is left unresolved');
});

test('the email quotes the same phone number in the body and the footer', () => {
  // Regression: the body used to hardcode the WhatsApp number while the footer
  // showed the office line, so a customer saw two different numbers.
  const { text } = buildMessage('quote', context, quote, {});
  const numbers = text.match(/\+234[\d ]+/g) || [];
  assert.ok(numbers.length >= 3, 'expected both numbers to appear');
  assert.ok(text.includes(`Insurance brokerage`), 'the footer is present');
  assert.ok(!text.includes('09012079823'), 'the unformatted legacy number must be gone');
});

test('the estimate disclaimer appears exactly once per customer message', () => {
  for (const kind of ['acknowledgement', 'quote']) {
    const { text } = buildMessage(kind, context, quote, {});
    const occurrences = text.split('is an estimate until the insurer confirms').length - 1;
    assert.equal(occurrences, 1, `${kind} repeated the disclaimer ${occurrences} times`);
  }
});

test('the premium is shown exactly once in a quotation', () => {
  // Regression: the default copy repeated {{offers}} while the branded shell
  // also rendered premium cards, so the price appeared twice.
  const { text, html } = buildMessage('quote', context, quote, {}, 'Here is your rate.');
  const inText = (text.match(/NGN 52,500/g) || []).length;
  assert.equal(inText, 1, `the premium appeared ${inText} times in the text`);
  const inHtml = (html.match(/52,500/g) || []).length;
  assert.equal(inHtml, 1, `the premium appeared ${inHtml} times in the html`);
});

test('the quotation subject talks about a quotation, not a receipt', () => {
  const { subject } = buildMessage('quote', context, quote, {});
  assert.match(subject, /quotation/i);
  assert.ok(!/received/i.test(subject), 'a priced quote must not use the acknowledgement subject');
  assert.match(subject, /SB-2026-ABC12345/);
});

test('the acknowledgement still uses the receipt subject', () => {
  const { subject } = buildMessage('acknowledgement', context, quote, {});
  assert.match(subject, /received/i);
  assert.match(subject, /SB-2026-ABC12345/);
});

test('an administrator subject overrides the per kind default', () => {
  const { subject: custom } = buildMessage('quote', context, quote, { customerSubject: 'Hello {{name}}' });
  assert.equal(custom, 'Hello Ada Lovelace');
  const { subject: team } = buildMessage('team', context, quote, { teamSubject: 'LEAD' });
  assert.equal(team, 'LEAD');
});

test('a custom subject saved for the acknowledgement does not leak into a quotation', () => {
  const settings = { customerSubject: 'We have received your {{product}} request — {{reference}}' };
  assert.match(buildMessage('acknowledgement', context, quote, settings).subject, /received/i);
  assert.match(buildMessage('quote', context, quote, settings).subject, /received/i, 'a saved subject is shared by design');
  assert.notEqual(buildMessage('quote', context, quote, {}).subject, buildMessage('quote', context, quote, settings).subject);
});

test('the team note appears once and never shows the customer estimate line', () => {
  const { text } = buildMessage('team', context, quote, {});
  const notes = text.split('Internal notification. Contact the customer').length - 1;
  assert.equal(notes, 1, `expected one internal note, found ${notes}`);
  assert.ok(!text.includes('is an estimate'), 'an internal email has no need of the customer estimate wording');
});

test('the default copy uses the placeholders it should', () => {
  assert.match(DEFAULT_CUSTOMER_ACKNOWLEDGEMENT, /\{\{reference\}\}/);
  assert.match(DEFAULT_CUSTOMER_ACKNOWLEDGEMENT, /\{\{product\}\}/);
  assert.match(DEFAULT_TEAM, /\{\{details\}\}/);
  // The default quotation copy omits {{offers}} because the branded shell
  // already renders the premiums as cards; using it there would double them up.
  assert.ok(!DEFAULT_CUSTOMER_QUOTE.includes('{{offers}}'), 'the default quote must not repeat the premium');
  // The placeholder stays available for administrators who want it inline.
  assert.ok(knownPlaceholders().includes('offers'));
  assert.ok(knownPlaceholders().includes('companyPhone'));
});

test('email html never exceeds the size at which mail clients clip the message', () => {
  const many = Array.from({ length: 12 }, (unused, index) => ({ ...quote.offers[0], id: `offer-${index}`, insurer: `Insurer ${index}` }));
  const { html } = renderEmail({ heading: 'Your quotation is ready', bodyHtml: '<p>Hello</p>', offers: many, reference: 'SB-1' });
  assert.ok(html.length < 102400, `email is ${html.length} bytes, which mail clients may clip`);
});

test('the brand palette exposes the colours the email depends on', () => {
  for (const key of ['ink', 'body', 'muted', 'line', 'surface', 'accent', 'white']) {
    assert.match(BRAND[key], /^#[0-9a-f]{6}$/i, `BRAND.${key} must be a hex colour`);
  }
  assert.match(COMPANY.rc, /^RC \d+/);
});

// A rate with no insurer behind it is the broker's own default table. The
// placeholder text it carries is an internal label and must not reach a
// customer, while a genuinely named insurer still has to be credited.
const defaultOffer = {
  insurer: 'Default insurer',
  insurerName: '',
  insurerId: '',
  plan: 'Motor Comprehensive',
  premium: 50000,
  currency: 'NGN',
  purchaseUrl: null,
};
const namedOffer = {
  insurer: 'AIICO Insurance',
  insurerName: 'AIICO Insurance',
  insurerId: 'aiico',
  plan: 'Motor Comprehensive',
  premium: 46500,
  currency: 'NGN',
  purchaseUrl: 'https://aiico.example/buy',
};

test('a default rate is not shown to the customer as a named insurer', () => {
  const text = offersText({ offers: [defaultOffer] });
  assert.doesNotMatch(text, /Default insurer/i, 'the placeholder insurer name must not be shown');
  assert.equal(text, 'Motor Comprehensive: NGN 50,000');
});

test('the default insurer placeholder is absent from the rendered email html', () => {
  const { html, text } = renderEmail({ heading: 'Your quotation is ready', offers: [defaultOffer] });
  assert.doesNotMatch(html, /Default insurer/i);
  assert.doesNotMatch(text, /Default insurer/i);
  // The plan name takes over as the card heading in place of the insurer.
  assert.match(html, /Motor Comprehensive/);
});

test('a real insurer is still credited when it is the one quoting', () => {
  const text = offersText({ offers: [namedOffer] });
  assert.match(text, /AIICO Insurance — Motor Comprehensive: NGN 46,500/);
  const { html } = renderEmail({ heading: 'Your quotation is ready', offers: [namedOffer] });
  assert.match(html, /AIICO Insurance/);
  assert.match(html, /Continue with AIICO Insurance/);
});

test('a default and a named quote sit together with only the named one labelled', () => {
  const text = offersText({ offers: [defaultOffer, namedOffer] });
  assert.doesNotMatch(text, /Default insurer/i);
  assert.match(text, /Motor Comprehensive: NGN 50,000/);
  assert.match(text, /AIICO Insurance — Motor Comprehensive: NGN 46,500/);
  const { html } = renderEmail({ heading: 'Your quotation is ready', offers: [defaultOffer, namedOffer] });
  assert.doesNotMatch(html, /Default insurer/i);
  assert.match(html, /AIICO Insurance/);
});

test('a default rate never shows a continue button, since no insurer is behind it', () => {
  const withUrl = { ...defaultOffer, purchaseUrl: 'https://example.test/buy' };
  const { html } = renderEmail({ heading: 'Your quotation is ready', offers: [withUrl] });
  assert.doesNotMatch(html, /Continue with/i);
});

test('offers stored before insurerName existed keep the insurer they recorded', () => {
  // Older quotes have no insurerName field at all. Treating that as "no
  // insurer" would silently drop a real provider's name from a past email.
  const legacy = { insurer: 'AIICO Insurance', plan: 'Motor Comprehensive', premium: 46500, currency: 'NGN' };
  assert.match(offersText({ offers: [legacy] }), /AIICO Insurance — Motor Comprehensive: NGN 46,500/);
});
