import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';

const baseUri = process.env.MONGODB_URI;
const hasMongo = Boolean(baseUri);

if (!hasMongo) {
  console.warn('MONGODB_URI is not set; skipping the quote-flow integration tests.');
}

const testUri = hasMongo ? baseUri.replace(/\/[^/?]+(\?|$)/, '/signature_test$1') : null;
process.env.MONGODB_URI = testUri || baseUri;
process.env.RESEND_API_KEY = 're_integration_test_key';
process.env.QUOTE_EMAIL_TO = 'team@example.test';
process.env.QUOTE_EMAIL_FROM = 'Signature Broker <quotes@example.test>';
process.env.ADMIN_API_KEY = 'integration-test-key';
process.env.ADMIN_PASSWORD = 'integration-test-password';
process.env.NODE_ENV = 'test';
delete process.env.QUOTE_PROVIDER_URL;
delete process.env.QUOTE_PROVIDER_API_KEY;

const sent = [];

// The plain text alternative is a readable table, so a value and its label can
// land on separate lines. Collapsing whitespace lets these assertions check
// that the facts are present without pinning them to a line layout.
const flatten = (value) => String(value).replace(/\s+/g, ' ');

globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('api.resend.com')) {
    sent.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ id: 'test' }), text: async () => '{"id":"test"}' };
  }
  throw new Error(`unexpected outbound request to ${url}`);
};

const { handleRequest, closeDB } = await import('../backend/server.js');
const { MongoClient: Client } = await import('mongodb');

function mockRes() {
  const res = { status: 0, headers: {}, body: '' };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
  };
  res.end = (chunk) => {
    res.body = chunk ? chunk.toString() : '';
    res.json = () => JSON.parse(res.body || '{}');
  };
  return res;
}

function mockReq({ method = 'POST', url = '/', body = null, headers = {} } = {}) {
  const payload = body === null ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = { method, url, headers: { host: 'localhost:3000', ...headers }, socket: { remoteAddress: '127.0.0.1' } };
  req[Symbol.asyncIterator] = async function* () {
    for (const chunk of payload) yield chunk;
  };
  return req;
}

async function call(options) {
  const res = mockRes();
  await handleRequest(mockReq(options), res);
  return res;
}

const seedProducts = [
  {
    id: 'immediate-quote',
    name: 'Immediate Quote Cover',
    active: true,
    benefits: ['Benefit one'],
    exclusions: ['Exclusion one'],
    fields: [{ key: 'vehicleValue', label: 'Estimated value of vehicle', type: 'currency', required: true, min: 100000, max: 100000000 }],
    rates: [
      {
        id: 'iq-rate',
        insurerId: 'default-insurer',
        insurer: 'Default insurer',
        model: 'percentage',
        percentage: 5,
        currency: 'NGN',
        active: true,
      },
    ],
    emailConfig: {
      sendEmailImmediately: true,
      immediateEmailMode: 'quote',
      notifyTeam: true,
      requireAdminMessage: false,
      customerSubject: '',
      customerBody: '',
      teamSubject: '',
      teamBody: '',
    },
  },
  {
    id: 'immediate-ack',
    name: 'Immediate Ack Cover',
    active: true,
    benefits: [],
    exclusions: [],
    fields: [{ key: 'vehicleValue', label: 'Estimated value of vehicle', type: 'currency', required: true, min: 100000, max: 100000000 }],
    rates: [
      {
        id: 'ia-rate',
        insurerId: 'default-insurer',
        insurer: 'Default insurer',
        model: 'percentage',
        percentage: 5,
        currency: 'NGN',
        active: true,
      },
    ],
    emailConfig: {
      sendEmailImmediately: true,
      immediateEmailMode: 'acknowledgement',
      notifyTeam: true,
      requireAdminMessage: false,
      customerSubject: '',
      customerBody: '',
      teamSubject: '',
      teamBody: '',
    },
  },
  {
    id: 'held-for-review',
    name: 'Held For Review Cover',
    active: true,
    benefits: [],
    exclusions: [],
    fields: [{ key: 'vehicleValue', label: 'Estimated value of vehicle', type: 'currency', required: true, min: 100000, max: 100000000 }],
    rates: [
      {
        id: 'hr-rate',
        insurerId: 'default-insurer',
        insurer: 'Default insurer',
        model: 'percentage',
        percentage: 5,
        currency: 'NGN',
        active: true,
      },
    ],
    emailConfig: {
      sendEmailImmediately: false,
      immediateEmailMode: 'acknowledgement',
      notifyTeam: false,
      requireAdminMessage: false,
      customerSubject: '',
      customerBody: '',
      teamSubject: '',
      teamBody: '',
    },
  },
  {
    id: 'custom-template',
    name: 'Custom Template Cover',
    active: true,
    benefits: [],
    exclusions: [],
    fields: [{ key: 'vehicleValue', label: 'Estimated value of vehicle', type: 'currency', required: true, min: 100000, max: 100000000 }],
    rates: [
      {
        id: 'ct-rate',
        insurerId: 'default-insurer',
        insurer: 'Default insurer',
        model: 'percentage',
        percentage: 5,
        currency: 'NGN',
        active: true,
      },
    ],
    emailConfig: {
      sendEmailImmediately: false,
      immediateEmailMode: 'acknowledgement',
      notifyTeam: true,
      requireAdminMessage: false,
      customerSubject: 'Your cover — {{reference}}',
      customerBody: 'Hi {{name}}, here is your {{product}} quote.\n\n{{offers}}\n\nFrom the broker: {{adminMessage}}',
      teamSubject: 'LEAD {{product}}',
      teamBody: '{{name}} / {{phone}} / {{email}}\n{{details}}',
    },
  },
];

async function withDb(fn) {
  const client = await Client.connect(testUri);
  const db = client.db();
  try {
    return await fn(db);
  } finally {
    await client.close();
  }
}

async function seed(db) {
  for (const collection of ['products', 'quotes', 'countries', 'insurers']) await db.collection(collection).deleteMany({});
  await db
    .collection('insurers')
    .insertMany([{ id: 'default-insurer', name: 'Default insurer', code: 'DEF', active: true, website: '', contactEmail: '' }]);
  await db.collection('countries').insertMany([
    { code: 'NG', name: 'Nigeria', active: true },
    { code: 'IT', name: 'Italy', active: true },
  ]);
  await db.collection('products').insertMany(seedProducts);
}

const quoteBody = (productId, extra = {}) => ({
  productId,
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  phone: '08012345678',
  consent: true,
  details: { vehicleValue: 1000000 },
  ...extra,
});

test('quote flow', { skip: !hasMongo, concurrency: false }, async (t) => {
  await withDb(seed);

  await t.test('immediate quote mode emails the premium and closes the request', async () => {
    sent.length = 0;
    const res = await call({ url: '/api/quotes', body: quoteBody('immediate-quote') });
    assert.equal(res.status, 202);
    const body = res.json();
    assert.equal(body.status, 'closed');
    assert.equal(body.emailStatus, 'sent');
    assert.equal(body.teamNotificationStatus, 'sent');
    assert.deepEqual(body.offers, [], 'premiums must never be returned to the browser');

    const customer = sent.find((message) => message.to[0] === 'ada@example.test');
    const team = sent.find((message) => message.to[0] === 'team@example.test');
    assert.ok(customer, 'customer email should be sent');
    assert.ok(team, 'team email should be sent');
    assert.match(customer.text, /NGN 50,000/, 'immediate quote mode includes the calculated premium');
    assert.match(flatten(team.text), /Estimated value of vehicle 1,000,000/, 'the team email now carries the customer answers');
    assert.match(team.html, /Estimated value of vehicle/, 'the team html lists the answer label');
    assert.match(team.html, /1,000,000/, 'the team html lists the answer value');
  });

  await t.test('immediate acknowledgement mode never reveals a premium', async () => {
    sent.length = 0;
    const res = await call({ url: '/api/quotes', body: quoteBody('immediate-ack') });
    assert.equal(res.status, 202);
    assert.equal(res.json().status, 'acknowledged');
    assert.equal(res.json().emailStatus, 'sent');

    const customer = sent.find((message) => message.to[0] === 'ada@example.test');
    assert.ok(customer);
    assert.ok(!customer.text.includes('50,000'), 'an acknowledgement must not contain the premium');
    assert.ok(!customer.text.includes('NGN'), 'an acknowledgement must not contain any price');
    assert.match(customer.text, /reference SB-\d{4}-[A-Z0-9]{8}/i, 'an acknowledgement still carries the reference');
  });

  await t.test('a product with notifyTeam off sends no team email', async () => {
    sent.length = 0;
    const res = await call({ url: '/api/quotes', body: quoteBody('held-for-review') });
    assert.equal(res.status, 202);
    assert.equal(res.json().status, 'awaiting-review');
    assert.equal(res.json().emailStatus, 'awaiting-admin');
    assert.equal(res.json().teamNotificationStatus, 'skipped');
    assert.equal(sent.length, 0, 'nothing should be emailed at all for this product');
  });

  await t.test('an admin manual send uses the custom template and closes the request', async () => {
    sent.length = 0;
    const created = await call({ url: '/api/quotes', body: quoteBody('custom-template') });
    const reference = created.json().reference;
    assert.equal(sent.length, 1, 'only the team email was sent for the held product');

    const res = await call({
      url: `/api/admin/quotes/${reference}/send-email`,
      body: { message: 'Your cover is ready.' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json().status, 'closed');

    const customer = sent.find((message) => message.to[0] === 'ada@example.test');
    assert.equal(customer.subject, `Your cover — ${reference}`);
    assert.match(customer.text, /here is your Custom Template Cover quote/);
    assert.match(customer.text, /NGN 50,000/);
    assert.match(customer.text, /From the broker: Your cover is ready/);

    const team = sent.find((message) => message.to[0] === 'team@example.test');
    assert.equal(team.subject, 'LEAD Custom Template Cover');
    assert.match(flatten(team.text), /Ada Lovelace \/ 08012345678 \/ ada@example\.test/);
    assert.match(flatten(team.text), /Estimated value of vehicle 1,000,000/);
  });

  await t.test('an admin can preview the customer email without sending it', async () => {
    sent.length = 0;
    const created = await call({ url: '/api/quotes', body: quoteBody('custom-template') });
    const reference = created.json().reference;
    sent.length = 0;

    const res = await call({
      url: `/api/admin/quotes/${reference}/email-preview`,
      body: { message: 'Your cover is ready.' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 200);

    const preview = res.json();
    assert.equal(preview.to, 'ada@example.test');
    assert.equal(preview.kind, 'quote');
    assert.equal(preview.sendable, true);
    assert.match(preview.subject, new RegExp(reference));
    assert.match(preview.html, /<!doctype html>/i, 'the preview is the real html document');
    assert.match(preview.html, /NGN 50,000/, 'the preview carries the real premium');
    assert.match(preview.text, /Ada Lovelace/);
    assert.equal(sent.length, 0, 'previewing must not send anything');
  });

  await t.test('a preview reflects the message the admin has typed', async () => {
    const open = await withDb(async (db) => db.collection('quotes').findOne({ status: 'awaiting-review' }));
    const withMessage = await call({
      url: `/api/admin/quotes/${open.reference}/email-preview`,
      body: { message: 'I have secured a great rate for you.' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.match(withMessage.json().text, /I have secured a great rate for you\./);

    const withoutMessage = await call({
      url: `/api/admin/quotes/${open.reference}/email-preview`,
      body: { message: '' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.ok(!withoutMessage.json().text.includes('I have secured a great rate'), 'the stale message is not reused');
  });

  await t.test('previewing never changes the quote status or sends an email', async () => {
    const before = await withDb(async (db) => db.collection('quotes').findOne({ status: 'awaiting-review' }));
    sent.length = 0;
    await call({
      url: `/api/admin/quotes/${before.reference}/email-preview`,
      body: { message: 'checking' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    const after = await withDb(async (db) => db.collection('quotes').findOne({ reference: before.reference }));
    assert.equal(after.status, 'awaiting-review', 'a preview must not close the lead');
    assert.deepEqual(after.customerEmail, before.customerEmail, 'a preview must not record a send attempt');
    assert.equal(sent.length, 0);
  });

  await t.test('a closed lead can still be previewed but is marked unsendable', async () => {
    const closed = await withDb(async (db) => db.collection('quotes').findOne({ status: 'closed' }));
    const res = await call({
      url: `/api/admin/quotes/${closed.reference}/email-preview`,
      body: {},
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json().sendable, false);
    assert.match(res.json().note, /already|already been sent|no longer/i);
  });

  await t.test('a closed lead shows the message it was actually sent with', async () => {
    // Build and send a lead with a known message, then review it. Doing it here
    // keeps the test independent of any other lead left in the test database.
    const created = await call({ url: '/api/quotes', body: quoteBody('custom-template') });
    const reference = created.json().reference;
    const message = 'I have matched this to a better rate than our standard table.';
    await call({
      url: `/api/admin/quotes/${reference}/send-email`,
      body: { message },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });

    // The preview request deliberately sends no message of its own.
    const res = await call({
      url: `/api/admin/quotes/${reference}/email-preview`,
      body: {},
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    const preview = res.json();
    assert.equal(preview.sendable, false);
    assert.equal(preview.sentMessage, message, 'the message comes from the stored record');
    assert.ok(preview.text.includes(message), 'the reviewed email contains the message it was sent with');
    assert.ok(preview.sentAt, 'the send time is reported');
  });

  await t.test('an open lead reports no sent message yet', async () => {
    const open = await withDb(async (db) => db.collection('quotes').findOne({ status: 'awaiting-review' }));
    const res = await call({
      url: `/api/admin/quotes/${open.reference}/email-preview`,
      body: {},
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(res.json().sentMessage, '');
    assert.equal(res.json().sendable, true);
  });

  await t.test('the message the admin edits is the message that gets sent', async () => {
    const created = await call({ url: '/api/quotes', body: quoteBody('custom-template') });
    const reference = created.json().reference;
    const message = 'I have secured an excellent rate for you.';
    sent.length = 0;

    // What the preview shows...
    const preview = await call({
      url: `/api/admin/quotes/${reference}/email-preview`,
      body: { message },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.ok(preview.json().text.includes(message), 'the preview contains the edited message');
    assert.equal(sent.length, 0, 'the preview itself must not send anything');

    // ...must be what actually goes out.
    const send = await call({
      url: `/api/admin/quotes/${reference}/send-email`,
      body: { message },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(send.status, 200);
    const customer = sent.find((m) => m.to[0] === 'ada@example.test');
    assert.ok(customer, 'the customer email was sent');
    assert.ok(customer.text.includes(message), 'the sent email contains exactly the reviewed message');
    const stored = await withDb(async (db) => db.collection('quotes').findOne({ reference }));
    assert.equal(stored.adminMessage, message, 'the message is saved against the lead');
  });

  await t.test('a preview requires admin authentication and a valid origin', async () => {
    const open = await withDb(async (db) => db.collection('quotes').findOne({ status: 'awaiting-review' }));
    sent.length = 0;

    const anonymous = await call({ url: `/api/admin/quotes/${open.reference}/email-preview`, body: {} });
    assert.equal(anonymous.status, 401);

    const crossOrigin = await call({
      url: `/api/admin/quotes/${open.reference}/email-preview`,
      body: {},
      headers: { authorization: 'Bearer integration-test-key', origin: 'https://evil.example' },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(sent.length, 0);
  });

  await t.test('previewing an unknown reference is a 404', async () => {
    const res = await call({
      url: '/api/admin/quotes/SB-2026-NOPE00/email-preview',
      body: {},
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 404);
  });

  await t.test('a closed request cannot be emailed twice', async () => {
    const closed = await withDb(async (db) => db.collection('quotes').findOne({ status: 'closed' }));
    const res = await call({
      url: `/api/admin/quotes/${closed.reference}/send-email`,
      body: { message: 'again' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 409);
  });

  await t.test('a cross-origin manual send is refused', async () => {
    const open = await withDb(async (db) => db.collection('quotes').findOne({ status: 'awaiting-review' }));
    const res = await call({
      url: `/api/admin/quotes/${open.reference}/send-email`,
      body: { message: 'nope' },
      headers: { authorization: 'Bearer integration-test-key', origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('a lead survives even when email delivery fails', async () => {
    const failing = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('api.resend.com')) return { ok: false, status: 502, text: async () => 'provider down' };
      return failing(url);
    };
    try {
      sent.length = 0;
      const res = await call({ url: '/api/quotes', body: quoteBody('immediate-quote') });
      assert.equal(res.status, 202, 'the request still succeeds');
      assert.equal(res.json().status, 'email-failed');
      const stored = await withDb(async (db) => db.collection('quotes').findOne({ reference: res.json().reference }));
      assert.ok(stored, 'the lead is saved even though both emails failed');
      assert.equal(stored.customerEmail.status, 'failed');
      assert.equal(stored.teamEmail.status, 'failed');
      assert.deepEqual(stored.details, { vehicleValue: 1000000 });
    } finally {
      globalThis.fetch = failing;
    }
  });

  await t.test('a product keeps its validation limits and email settings through an admin save', async () => {
    const auth = { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' };
    const created = await call({
      url: '/api/admin/products',
      method: 'POST',
      headers: auth,
      body: {
        id: 'round-trip',
        name: 'Round Trip Cover',
        fields: [
          {
            key: 'vehicleValue',
            label: 'Estimated value of vehicle',
            type: 'currency',
            required: true,
            min: 100000,
            max: 5000000,
            placeholder: '5,000,000',
          },
        ],
        rates: [{ insurerId: 'default-insurer', model: 'percentage', percentage: 5 }],
        emailConfig: { sendEmailImmediately: true, immediateEmailMode: 'quote', notifyTeam: true, customerSubject: 'Keep me' },
      },
    });
    assert.equal(created.status, 201);
    const field = created.json().product.fields[0];
    assert.equal(field.min, 100000);
    assert.equal(field.max, 5000000);
    assert.equal(field.placeholder, '5,000,000');

    const reread = (await call({ url: '/api/admin/products', method: 'GET', headers: auth }))
      .json()
      .products.find((item) => item.id === 'round-trip');
    const saved = await call({ url: '/api/admin/products/round-trip', method: 'PUT', headers: auth, body: reread });
    assert.equal(saved.status, 200);

    const roundTripped = saved.json().product;
    assert.equal(roundTripped.fields[0].min, 100000, 'a minimum set in the admin must survive a save');
    assert.equal(roundTripped.fields[0].max, 5000000, 'a maximum set in the admin must survive a save');
    assert.equal(roundTripped.fields[0].placeholder, '5,000,000');
    assert.equal(roundTripped.emailConfig.immediateEmailMode, 'quote', 'the immediate mode must not silently reset to acknowledgement');
    assert.equal(roundTripped.emailConfig.customerSubject, 'Keep me');
  });

  await t.test('an empty minimum is not stored as zero', async () => {
    const auth = { authorization: 'Bearer integration-test-key', origin: 'http://localhost:3000' };
    const created = await call({
      url: '/api/admin/products',
      method: 'POST',
      headers: auth,
      body: { id: 'no-limits', name: 'No Limits Cover', fields: [{ key: 'notes', label: 'Notes', type: 'text' }], rates: [] },
    });
    assert.equal(created.status, 201);
    assert.equal('min' in created.json().product.fields[0], false, 'an empty limit must be omitted, not coerced to 0');
    assert.equal('max' in created.json().product.fields[0], false);
  });

  await t.test('the public product feed exposes no email configuration', async () => {
    const res = await call({ method: 'GET', url: '/api/products' });
    assert.equal(res.status, 200);
    for (const product of res.json().products) {
      assert.equal(product.emailConfig, undefined, `${product.id} leaked emailConfig`);
      assert.equal(product.rates, undefined, `${product.id} leaked rates`);
    }
  });
});

test('quote flow cleanup', { skip: !hasMongo }, async () => {
  await closeDB();
  const client = await Client.connect(testUri);
  const db = client.db();
  for (const collection of ['products', 'quotes', 'countries', 'insurers']) await db.collection(collection).deleteMany({});
  await client.close();
});
