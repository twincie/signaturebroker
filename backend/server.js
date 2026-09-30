import 'dotenv/config';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { detailsText } from '../shared/format.js';
import { configuredOffers } from './lib/pricing.js';
import { isPlaceholderInsurer } from './lib/insurers.js';
import { buildMessage, offersText } from './lib/email-template.js';
import { COMPANY, brandLogoDataUri } from './lib/email-html.js';
import { createLogger, fingerprint, formatDuration, logError, maskEmail } from './lib/logger.js';

const log = createLogger('server');
const apiLog = createLogger('api');
const dbLog = createLogger('db');
const emailLog = createLogger('email');
const quoteLog = createLogger('quote');
const authLog = createLogger('auth');
const adminLog = createLogger('admin');

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(projectRoot, 'dist');
const port = Number(process.env.PORT || process.env.SIGNATURE_PORT || 3000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/signaturebroker';
const adminKey = process.env.ADMIN_API_KEY || '';
const adminUsername = process.env.ADMIN_USERNAME || 'insurance';
const adminPassword = process.env.ADMIN_PASSWORD || 'insurance';
const isProduction = process.env.NODE_ENV === 'production';
const adminLoginAllowed = !isProduction || adminPassword !== 'insurance';
const providerUrl = (process.env.QUOTE_PROVIDER_URL || '').replace(/\/$/, '');
const providerKey = process.env.QUOTE_PROVIDER_API_KEY || '';
const resendApiKey = process.env.RESEND_API_KEY || '';
const quoteEmailTo = process.env.QUOTE_EMAIL_TO || '';
const quoteEmailFrom = process.env.QUOTE_EMAIL_FROM || 'Signature Broker <quotes@signaturebroker.ng>';
const rateLimits = new Map();
const sessions = new Map();
const MAX_RATE_LIMIT_KEYS = 20000;
let db;
let dbConnectionPromise;

setInterval(() => {
  const now = Date.now();
  for (const [key, item] of rateLimits) if (now > item.reset) rateLimits.delete(key);
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
}, 600000).unref();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const securityHeaders = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https://images.pexels.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const clientErrors = {
  BODY_TOO_LARGE: [413, 'That request is too large.'],
  INVALID_JSON: [400, 'That request could not be read.'],
  INVALID_PRODUCT: [422, 'That product configuration is not valid.'],
  INVALID_INSURER: [422, 'That insurer is not recognised.'],
  INVALID_COUNTRY: [422, 'That country is not valid.'],
};
const PROVIDER_TIMEOUT_MS = 8000;
const EMAIL_TIMEOUT_MS = 8000;
const REFERENCE_TTL_MS = 60000;
let referenceCache = { countries: null, insurers: null, at: 0 };

async function referenceData() {
  if (referenceCache.countries && Date.now() - referenceCache.at < REFERENCE_TTL_MS) {
    apiLog.debug('reference data served from cache', {
      ageMs: Date.now() - referenceCache.at,
      countries: referenceCache.countries.length,
      insurers: referenceCache.insurers.length,
    });
    return referenceCache;
  }
  const [countries, insurers] = await Promise.all([
    db
      .collection('countries')
      .find({ active: { $ne: false } })
      .toArray(),
    db
      .collection('insurers')
      .find({ active: { $ne: false } })
      .toArray(),
  ]);
  referenceCache = { countries, insurers, at: Date.now() };
  apiLog.debug('reference data loaded from mongodb', { countries: countries.length, insurers: insurers.length });
  return referenceCache;
}

function invalidateReferenceData() {
  if (referenceCache.countries) apiLog.info('reference data cache invalidated');
  referenceCache = { countries: null, insurers: null, at: 0 };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function clean(value, max = 200) {
  if (value === null || value === undefined) return '';
  const type = typeof value;
  const text = type === 'string' ? value : (type === 'number' && Number.isFinite(value)) || type === 'boolean' ? String(value) : '';
  return text.trim().replace(/[<>]/g, '').slice(0, max);
}
function secret(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function constantTimeEquals(a, b) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const candidate = /^[0-9a-f:.]{3,45}$/i.test(forwarded) ? forwarded : '';
  return candidate || clean(req.socket.remoteAddress || 'unknown', 80);
}
function allowRequest(key, limit = 8) {
  const now = Date.now();
  const item = rateLimits.get(key) || { count: 0, reset: now + 3600000 };
  if (now > item.reset) Object.assign(item, { count: 0, reset: now + 3600000 });
  item.count++;
  if (!rateLimits.has(key) && rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
    let oldest;
    for (const [existingKey, existing] of rateLimits) if (!oldest || existing.reset < oldest[1].reset) oldest = [existingKey, existing];
    if (oldest) rateLimits.delete(oldest[0]);
  }
  rateLimits.set(key, item);
  return item.count <= limit;
}
async function parseJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 30000) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
}
function isAdmin(req) {
  if (!adminKey) return false;
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return constantTimeEquals(supplied, adminKey);
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim().split('=').map(decodeURIComponent))
      .filter((item) => item.length === 2)
  );
}
function adminSession(req) {
  const token = cookies(req).signature_admin;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}
function adminAuthorized(req) {
  return Boolean(adminSession(req) || isAdmin(req));
}
function loginCookie(token) {
  return `signature_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${isProduction ? '; Secure' : ''}`;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    if (originHost === req.headers.host) return true;
    const frontendPort = process.env.FRONTEND_PORT || '5173';
    return !isProduction && req.headers.host === `localhost:${frontendPort}` && originHost === `localhost:${frontendPort}`;
  } catch {
    return false;
  }
}

export async function closeDB() {
  const client = db ? db.client : null;
  db = null;
  dbConnectionPromise = null;
  if (client) {
    await client.close();
    dbLog.info('mongodb connection closed');
  }
}

async function connectDB() {
  if (db) return db;
  if (dbConnectionPromise) {
    dbLog.debug('mongodb already connecting, awaiting the in-flight attempt');
    return dbConnectionPromise;
  }
  const startedAt = Date.now();
  dbLog.info('connecting to mongodb', { host: safeHost(mongoUri), timeoutMs: 10000 });
  dbConnectionPromise = (async () => {
    const client = await MongoClient.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    db = client.db();
    dbLog.info('mongodb connected', {
      host: safeHost(mongoUri),
      database: db.databaseName,
      tookMs: formatDuration(Date.now() - startedAt),
    });
    const indexes = [
      ['quotes', { reference: 1 }, { unique: true }],
      ['quotes', { createdAt: -1 }, {}],
      ['products', { id: 1 }, { unique: true }],
      ['insurers', { id: 1 }, { unique: true }],
      ['countries', { code: 1 }, { unique: true }],
    ];
    for (const [collection, keys, options] of indexes) {
      try {
        await db.collection(collection).createIndex(keys, options);
        dbLog.debug('index ready', { collection, index: JSON.stringify(keys), unique: Boolean(options.unique) });
      } catch (error) {
        dbLog.error('index could not be created; duplicates must be resolved first', { collection, index: JSON.stringify(keys), error });
      }
    }
    return db;
  })().catch((error) => {
    dbConnectionPromise = null;
    logError(dbLog, 'mongodb connection failed; check MONGODB_URI, the IP allowlist and the credentials', error, {
      host: safeHost(mongoUri),
    });
    throw error;
  });
  return dbConnectionPromise;
}

/** Host and database only. Never log the full connection string. */
function safeHost(uri) {
  try {
    const parsed = new URL(uri);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'unparseable';
  }
}

function normalizeProduct(input, existingId = '', existingEmailConfig = {}) {
  const id = clean(input.id || existingId, 60)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const name = clean(input.name, 100),
    description = clean(input.description, 500);
  if (!id || !name) throw new Error('INVALID_PRODUCT');
  const allowedTypes = new Set(['text', 'number', 'currency', 'date', 'country', 'select']);
  const fields = Array.isArray(input.fields)
    ? input.fields.slice(0, 30).map((field) => {
        const key = clean(field.key, 60).replace(/[^a-zA-Z0-9_]/g, '');
        const type = allowedTypes.has(field.type) ? field.type : 'text';
        if (!key || !clean(field.label, 100)) throw new Error('INVALID_PRODUCT');
        const normalized = { key, label: clean(field.label, 100), type, required: Boolean(field.required) };
        if (Number.isFinite(Number(field.min))) normalized.min = Number(field.min);
        if (Number.isFinite(Number(field.max))) normalized.max = Number(field.max);
        if (field.placeholder) normalized.placeholder = clean(field.placeholder, 120);
        if (type === 'select')
          normalized.options = Array.isArray(field.options)
            ? field.options
                .slice(0, 50)
                .map((option) => ({ value: clean(option.value, 80), label: clean(option.label, 100) }))
                .filter((option) => option.value && option.label)
            : [];
        return normalized;
      })
    : [];
  const allowedModels = new Set(['fixed', 'percentage', 'age-bands', 'underwriting']);
  const rates = Array.isArray(input.rates)
    ? input.rates
        .slice(0, 50)
        .map((rate) => ({
          id: clean(rate.id, 80) || randomUUID(),
          insurerId: clean(rate.insurerId, 80),
          insurer: clean(rate.insurer, 100),
          model: allowedModels.has(rate.model) ? rate.model : 'underwriting',
          currency: clean(rate.currency || 'NGN', 10),
          amount: Number(rate.amount) || 0,
          percentage: Number(rate.percentage) || 0,
          ageBands: Array.isArray(rate.ageBands)
            ? rate.ageBands
                .slice(0, 30)
                .map((band) => ({ minAge: Number(band.minAge), maxAge: Number(band.maxAge), amount: Number(band.amount) }))
                .filter((band) => Number.isFinite(band.minAge) && Number.isFinite(band.maxAge) && Number.isFinite(band.amount))
            : [],
          loadings: Array.isArray(rate.loadings)
            ? rate.loadings.slice(0, 30).map((loading) => ({
                field: clean(loading.field, 60),
                equals: clean(loading.equals, 80),
                percentage: Number(loading.percentage) || 0,
              }))
            : [],
          excess: clean(rate.excess, 160),
          waitingPeriod: clean(rate.waitingPeriod, 160),
          validFrom: clean(rate.validFrom, 10),
          validTo: clean(rate.validTo, 10),
          active: rate.active !== false,
        }))
        .filter((rate) => rate.insurerId || rate.insurer)
    : [];
  return {
    id,
    name,
    description,
    active: input.active !== false,
    emailConfig: normalizeEmailConfig(input.emailConfig, existingEmailConfig),
    fields,
    benefits: Array.isArray(input.benefits)
      ? input.benefits
          .slice(0, 30)
          .map((item) => clean(item, 160))
          .filter(Boolean)
      : [],
    exclusions: Array.isArray(input.exclusions)
      ? input.exclusions
          .slice(0, 30)
          .map((item) => clean(item, 160))
          .filter(Boolean)
      : [],
    rates,
    updatedAt: new Date().toISOString(),
  };
}
async function ensureKnownInsurers(product) {
  const ids = new Set(
    (
      await db
        .collection('insurers')
        .find({ active: { $ne: false } })
        .toArray()
    ).map((item) => item.id)
  );
  if (product.rates.some((rate) => rate.insurerId && !ids.has(rate.insurerId))) throw new Error('INVALID_INSURER');
  return product;
}
function normalizeCountry(input, existingCode = '') {
  const code = clean(input.code || existingCode, 2).toUpperCase();
  const name = clean(input.name, 100);
  if (!/^[A-Z]{2}$/.test(code) || !name) throw new Error('INVALID_COUNTRY');
  return { code, name, active: input.active !== false };
}
function normalizeInsurer(input, existingId = '') {
  const name = clean(input.name, 120);
  const id = clean(input.id || existingId || name, 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const code = clean(input.code, 30).toUpperCase();
  const website = clean(input.website, 240);
  const contactEmail = clean(input.contactEmail, 120).toLowerCase();
  if (!id || !name) throw new Error('INVALID_INSURER');
  if (website && !/^https?:\/\//i.test(website)) throw new Error('INVALID_INSURER');
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('INVALID_INSURER');
  return { id, name, code, active: input.active !== false, website, contactEmail };
}

function validateDetails(product, values) {
  const details = {};
  const errors = {};
  for (const field of product.fields) {
    let value = clean(values[field.key], 120);
    if (field.type === 'currency') value = value.replace(/[^0-9.]/g, '');
    if (field.required && !value) errors[field.key] = `${field.label} is required.`;
    if (field.type === 'select' && value && !field.options.some((option) => option.value === value))
      errors[field.key] = `Choose a valid ${field.label.toLowerCase()}.`;
    if (['number', 'currency'].includes(field.type) && value) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < field.min || number > field.max)
        errors[field.key] = `${field.label} is outside the accepted range.`;
      else value = number;
    }
    if (field.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      errors[field.key] = `Enter a valid ${field.label.toLowerCase()}.`;
    details[field.key] = value;
  }
  if (product.id === 'travel' && details.startDate && details.endDate && details.endDate < details.startDate)
    errors.endDate = 'End date must be after the start date.';
  return { details, errors };
}

async function requestLiveOffers(quote, product) {
  const { insurers } = await referenceData();
  const localOffers = configuredOffers(product, quote.details, insurers, quote.insurerId);

  if (!providerUrl || !providerKey) {
    apiLog.debug('no external quote provider configured, using the product rates', {
      reference: quote.reference,
      offers: localOffers.length,
    });
    return { configured: localOffers.length > 0, offers: localOffers, source: 'configured-rates' };
  }

  const startedAt = Date.now();
  apiLog.info('requesting live offers from the quote provider', {
    reference: quote.reference,
    productId: product.id,
    insurerId: quote.insurerId || 'any',
    timeoutMs: PROVIDER_TIMEOUT_MS,
  });

  let response;
  try {
    response = await fetch(`${providerUrl}/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': quote.id,
        'User-Agent': 'SignatureBroker/1.0',
      },
      body: JSON.stringify({
        reference: quote.reference,
        productId: product.productId || product.id,
        insurerId: quote.insurerId,
        customer: { name: quote.name, email: quote.email, phone: quote.phone },
        details: quote.details,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    apiLog.error(timedOut ? 'quote provider timed out' : 'quote provider request failed', {
      reference: quote.reference,
      providerUrl,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      error,
    });
    throw error;
  }

  if (!response.ok) {
    apiLog.error('quote provider returned an error status', { reference: quote.reference, status: response.status });
    throw new Error(`Quote provider returned ${response.status}`);
  }

  const result = await response.json();
  const offers = Array.isArray(result.offers)
    ? result.offers
        .slice(0, 20)
        .map((offer) => ({
          id: clean(offer.id, 100),
          insurer: clean(offer.insurer, 100),
          // A live provider names the insurer that quoted, so it is credited
          // in the customer's email unless it is the default placeholder.
          insurerName: isPlaceholderInsurer({ name: offer.insurer }) ? '' : clean(offer.insurer, 100),
          plan: clean(offer.plan, 120),
          premium: Number(offer.premium),
          currency: clean(offer.currency || 'NGN', 10),
          benefits: Array.isArray(offer.benefits) ? offer.benefits.slice(0, 8).map((item) => clean(item, 160)) : [],
          purchaseUrl: /^https:\/\//.test(offer.purchaseUrl || '') ? offer.purchaseUrl : null,
        }))
        .filter((offer) => offer.insurer && Number.isFinite(offer.premium))
    : [];

  apiLog.info('live offers received', {
    reference: quote.reference,
    providerOffers: offers.length,
    configuredOffers: localOffers.length,
    tookMs: formatDuration(Date.now() - startedAt),
  });

  return { configured: true, offers: [...localOffers, ...offers], source: 'quote-provider' };
}

function emailSettings(product = {}) {
  const config = product.emailConfig || {};
  return {
    sendEmailImmediately: config.sendEmailImmediately ?? product.sendEmailImmediately === true,
    immediateEmailMode: config.immediateEmailMode === 'quote' ? 'quote' : 'acknowledgement',
    notifyTeam: config.notifyTeam !== false,
    requireAdminMessage: config.requireAdminMessage ?? product.requireAdminMessage === true,
    customerSubject: config.customerSubject ?? (product.emailSubject || ''),
    customerBody: config.customerBody ?? (product.emailIntroduction || ''),
    teamSubject: config.teamSubject || '',
    teamBody: config.teamBody || '',
  };
}

function normalizeEmailConfig(input = {}, existing = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const mode = source.immediateEmailMode ?? existing.immediateEmailMode;
  return {
    sendEmailImmediately:
      source.sendEmailImmediately !== undefined ? Boolean(source.sendEmailImmediately) : existing.sendEmailImmediately === true,
    immediateEmailMode: mode === 'quote' || mode === 'acknowledgement' ? mode : 'acknowledgement',
    notifyTeam: source.notifyTeam !== undefined ? Boolean(source.notifyTeam) : existing.notifyTeam !== false,
    requireAdminMessage:
      source.requireAdminMessage !== undefined ? Boolean(source.requireAdminMessage) : existing.requireAdminMessage === true,
    customerSubject: source.customerSubject !== undefined ? clean(source.customerSubject, 160) : clean(existing.customerSubject, 160),
    customerBody: source.customerBody !== undefined ? clean(source.customerBody, 4000) : clean(existing.customerBody, 4000),
    teamSubject: source.teamSubject !== undefined ? clean(source.teamSubject, 160) : clean(existing.teamSubject, 160),
    teamBody: source.teamBody !== undefined ? clean(source.teamBody, 4000) : clean(existing.teamBody, 4000),
  };
}

async function buildEmailContext(quote, product, adminMessage = '') {
  const { countries } = await referenceData();
  const lookup = { countries: Object.fromEntries(countries.map((item) => [item.code, item.name])) };
  return {
    name: quote.name,
    email: quote.email,
    phone: quote.phone,
    reference: quote.reference,
    product: quote.productName,
    requestedDate: new Date(quote.createdAt).toDateString(),
    adminMessage: clean(adminMessage, 1500),
    details: detailsText(product, quote.details, lookup),
    offers: offersText(quote),
  };
}

/**
 * Hand the message to Resend. Both an HTML and a plain text body are sent so
 * the branded layout is used by modern clients and the message stays readable
 * everywhere else.
 */
async function sendEmail(message, idempotencyKey) {
  const recipients = (message.to || []).map(maskEmail).join(', ');

  if (!resendApiKey) {
    emailLog.error('RESEND_API_KEY is not set, so no email can be delivered', { idempotencyKey, to: recipients });
    throw new Error('Email service is not configured.');
  }

  const payload = {
    from: message.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.reply_to ? { reply_to: message.reply_to } : {}),
  };
  const startedAt = Date.now();
  emailLog.info('sending email', {
    idempotencyKey,
    to: recipients,
    subjectLength: message.subject?.length || 0,
    htmlBytes: message.html?.length || 0,
    textBytes: message.text?.length || 0,
  });
  // Subjects can contain the customer's name or vehicle details, so the raw
  // value is only exposed when an operator opts into debug logging.
  emailLog.debug('sending email', { idempotencyKey, subject: message.subject });

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SignatureBroker/1.0',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    emailLog.error(timedOut ? 'email request timed out' : 'email request failed before a response was received', {
      idempotencyKey,
      to: recipients,
      timeoutMs: EMAIL_TIMEOUT_MS,
      error,
    });
    throw error;
  }

  const responseText = await response.text();

  if (!response.ok) {
    emailLog.error('email provider rejected the message', {
      idempotencyKey,
      to: recipients,
      status: response.status,
      body: responseText.slice(0, 300),
    });
    throw new Error(`Email provider returned ${response.status}: ${responseText.slice(0, 300)}`);
  }

  let providerId = '';
  try {
    providerId = JSON.parse(responseText).id || '';
  } catch {
    /* a non JSON body is not fatal */
  }

  emailLog.info('email delivered', {
    idempotencyKey,
    to: recipients,
    status: response.status,
    providerId,
    tookMs: formatDuration(Date.now() - startedAt),
  });
  return true;
}

/** Notify the brokerage team about a new lead. */
async function sendTeamNotification(quote, product) {
  const settings = emailSettings(product);

  if (!settings.notifyTeam) {
    emailLog.info('team notification skipped because notifyTeam is off', { reference: quote.reference, productId: product.id });
    return 'skipped';
  }
  if (!quoteEmailTo) {
    emailLog.error('QUOTE_EMAIL_TO is not configured, so leads cannot be delivered to the team', { reference: quote.reference });
    throw new Error('QUOTE_EMAIL_TO is not configured.');
  }

  const context = await buildEmailContext(quote, product);
  const message = buildMessage('team', context, quote, settings);

  emailLog.info('sending team notification', {
    reference: quote.reference,
    productId: product.id,
    to: maskEmail(quoteEmailTo),
    offers: quote.offers?.length || 0,
  });
  await sendEmail({ from: quoteEmailFrom, to: [quoteEmailTo], reply_to: quote.email, ...message }, `${quote.id}-team`);
  return 'sent';
}

/** Send the customer either an acknowledgement or their priced quotation. */
async function sendCustomerEmail(quote, product, { adminMessage = '', kind = 'quote', attempt = 1 } = {}) {
  const settings = emailSettings(product);
  const context = await buildEmailContext(quote, product, adminMessage);

  if (kind === 'acknowledgement') {
    // buildMessage guarantees an acknowledgement can never carry a premium.
    context.offers = '';
  }

  const message = buildMessage(kind, context, quote, settings, adminMessage);

  emailLog.info('sending customer email', {
    reference: quote.reference,
    productId: product.id,
    kind,
    attempt,
    to: maskEmail(quote.email),
    hasAdminMessage: Boolean(adminMessage),
    offers: kind === 'acknowledgement' ? 0 : quote.offers?.length || 0,
  });
  await sendEmail({ from: quoteEmailFrom, to: [quote.email], ...message }, `${quote.id}-customer-${attempt}`);
  return 'sent';
}

async function persistQuote(quote, extra = {}) {
  quote.updatedAt = new Date().toISOString();
  const { matchedCount, modifiedCount } = await db.collection('quotes').updateOne(
    { id: quote.id },
    {
      $set: {
        status: quote.status,
        offers: quote.offers,
        teamEmail: quote.teamEmail,
        customerEmail: quote.customerEmail,
        closedAt: quote.closedAt || null,
        updatedAt: quote.updatedAt,
        ...extra,
      },
    }
  );
  quoteLog.debug('quote persisted', { reference: quote.reference, status: quote.status, matched: matchedCount, modified: modifiedCount });
  if (!matchedCount)
    quoteLog.error('quote document was not found while persisting; the lead may not be saved', {
      reference: quote.reference,
      id: quote.id,
    });
}

async function createQuote(req, res) {
  const startedAt = Date.now();

  if (!allowRequest(`${clientIp(req)}:quote`, 10)) {
    quoteLog.warn('quote request rejected by the rate limiter', { ip: clientIp(req) });
    return send(res, 429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': '3600' });
  }

  const body = await parseJson(req);
  if (body.website) {
    quoteLog.warn('honeypot field was filled, so the submission was discarded', { ip: clientIp(req) });
    return send(res, 202, { ok: true });
  }

  const catalog = await db
    .collection('products')
    .find({ active: { $ne: false } })
    .toArray();
  const productId = clean(body.productId, 60);
  const product = catalog.find((item) => item.active !== false && item.id === productId);
  const name = clean(body.name, 80);
  const email = clean(body.email, 120).toLowerCase();
  const phone = clean(body.phone, 20);

  const errors = {};
  if (!product) errors.productId = 'Choose a valid insurance product.';
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!/^[+0-9 ()-]{7,20}$/.test(phone)) errors.phone = 'Enter a valid phone number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (body.consent !== true) errors.consent = 'Consent is required.';

  const validation = product ? validateDetails(product, body.details || {}) : { details: {}, errors: {} };
  Object.assign(errors, validation.errors);

  if (Object.keys(errors).length) {
    quoteLog.warn('quote request rejected by validation', { productId, fields: Object.keys(errors).join(','), email: maskEmail(email) });
    return send(res, 422, { error: 'Please check the form.', fields: errors });
  }

  const settings = emailSettings(product);
  const quote = {
    id: randomUUID(),
    reference: `SB-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
    productId: product.id,
    productName: product.name,
    name,
    email,
    phone,
    details: validation.details,
    status: 'received',
    offers: [],
    teamEmail: { status: settings.notifyTeam ? 'pending' : 'skipped', error: '' },
    customerEmail: { status: settings.sendEmailImmediately ? 'pending' : 'awaiting-admin', error: '', attempts: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await db.collection('quotes').insertOne(quote);
  } catch (error) {
    logError(quoteLog, 'the lead could not be saved; it has been lost', error, { reference: quote.reference, productId: product.id });
    return send(res, 500, { error: 'We could not save your request. Please call us so we can help directly.' });
  }

  quoteLog.info('lead created', {
    reference: quote.reference,
    productId: product.id,
    email: maskEmail(email),
    // A short, non-reversible identifier lets an operator count distinct
    // customers from the logs without storing their email addresses.
    customer: fingerprint(email),
    immediate: settings.sendEmailImmediately,
    mode: settings.immediateEmailMode,
    notifyTeam: settings.notifyTeam,
    requireAdminMessage: settings.requireAdminMessage,
  });

  // 1. Price the request.
  try {
    const provider = await requestLiveOffers(quote, product);
    quote.offers = provider.offers;
    quote.status = provider.configured ? (quote.offers.length ? 'quoted' : 'no-offers') : 'awaiting-rates';
    quoteLog.info('pricing resolved', {
      reference: quote.reference,
      source: provider.configured ? provider.source || 'configured-rates' : 'no-rates-configured',
      offers: quote.offers.length,
    });
  } catch (error) {
    quoteLog.error('pricing failed; the lead is kept without a premium', { reference: quote.reference, productId: product.id, error });
    quote.status = 'provider-error';
  }
  await persistQuote(quote);

  // 2. Notify the team.
  if (settings.notifyTeam) {
    try {
      await sendTeamNotification(quote, product);
      quote.teamEmail = { status: 'sent', sentAt: new Date().toISOString(), error: '' };
      quoteLog.info('team notification delivered', { reference: quote.reference });
    } catch (error) {
      quoteLog.error('team notification failed; the lead is still saved', { reference: quote.reference, error });
      quote.teamEmail = { status: 'failed', error: clean(error.message, 500), failedAt: new Date().toISOString() };
    }
  }

  // 3. Email the customer if the product is configured for immediate delivery.
  if (settings.sendEmailImmediately) {
    const kind = settings.immediateEmailMode;
    try {
      await sendCustomerEmail(quote, product, { kind, attempt: 1 });
      quote.customerEmail = { status: 'sent', sentAt: new Date().toISOString(), error: '', attempts: 1 };
      if (kind === 'quote') {
        quote.status = 'closed';
        quote.closedAt = new Date().toISOString();
      } else {
        quote.status = 'acknowledged';
      }
      quoteLog.info('customer email delivered', { reference: quote.reference, kind });
    } catch (error) {
      quoteLog.error('customer email failed; the lead is still saved for a manual send', { reference: quote.reference, kind, error });
      quote.customerEmail = { status: 'failed', error: clean(error.message, 500), failedAt: new Date().toISOString(), attempts: 1 };
      quote.status = 'email-failed';
    }
  } else {
    quote.status = 'awaiting-review';
    quoteLog.info('held for administrator review', { reference: quote.reference, offers: quote.offers.length });
  }

  await persistQuote(quote);
  quoteLog.info('quote request complete', {
    reference: quote.reference,
    status: quote.status,
    teamEmail: quote.teamEmail.status,
    customerEmail: quote.customerEmail.status,
    tookMs: formatDuration(Date.now() - startedAt),
  });

  const customerMessage = settings.sendEmailImmediately
    ? quote.customerEmail.status === 'sent'
      ? settings.immediateEmailMode === 'quote'
        ? 'Your quote has been calculated and sent to your email.'
        : 'We have emailed you to confirm we received your request. Our team will review it and follow up with your quotation.'
      : 'Your quote was calculated, but the email could not be sent automatically. Our team has been notified and will follow up.'
    : 'Your quote request was saved. Our team will review it and send you a response.';

  send(res, 202, {
    ok: true,
    reference: quote.reference,
    status: quote.status,
    offers: [],
    emailStatus: quote.customerEmail.status,
    teamNotificationStatus: quote.teamEmail.status,
    message: customerMessage,
  });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health')
    return send(res, 200, { ok: true, providerConfigured: Boolean(providerUrl && providerKey), emailConfigured: Boolean(resendApiKey) });
  if (req.method === 'GET' && url.pathname === '/api/products') {
    const products = (
      await db
        .collection('products')
        .find({ active: { $ne: false } })
        .toArray()
    ).map(({ _id, rates, emailConfig, sendEmailImmediately, requireAdminMessage, emailSubject, emailIntroduction, ...product }) => product);
    return send(res, 200, { products });
  }
  if (req.method === 'GET' && url.pathname === '/api/countries')
    return send(res, 200, {
      countries: (
        await db
          .collection('countries')
          .find({ active: { $ne: false } })
          .toArray()
      ).sort((a, b) => a.name.localeCompare(b.name)),
    });
  if (req.method === 'GET' && url.pathname === '/api/insurers')
    return send(res, 200, {
      insurers: (
        await db
          .collection('insurers')
          .find({ active: { $ne: false } })
          .toArray()
      )
        .map(({ contactEmail, ...item }) => item)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  if (req.method === 'POST' && url.pathname === '/api/quotes') return createQuote(req, res);
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (!allowRequest(`${clientIp(req)}:login`, 10)) return send(res, 429, { error: 'Too many login attempts.' });
    if (!adminLoginAllowed)
      return send(res, 503, { error: 'Admin sign-in is disabled until ADMIN_PASSWORD is set to a value other than the default.' });
    const body = await parseJson(req);
    const username = secret(body.username, 80),
      password = secret(body.password, 200);
    const userOk = constantTimeEquals(username, adminUsername),
      passwordOk = constantTimeEquals(password, adminPassword);
    if (!userOk || !passwordOk) {
      authLog.warn('failed admin sign-in', { ip: clientIp(req), usernameOk: userOk, passwordOk: passwordOk });
      return send(res, 401, { error: 'Invalid username or password.' });
    }
    const token = `${randomUUID()}${randomUUID()}`;
    sessions.set(token, { username, expiresAt: Date.now() + 28800000 });
    authLog.info('admin signed in', { ip: clientIp(req), username, activeSessions: sessions.size });
    return send(res, 200, { ok: true, username }, { 'Set-Cookie': loginCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const token = cookies(req).signature_admin;
    if (token) sessions.delete(token);
    authLog.info('admin signed out', { ip: clientIp(req) });
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'signature_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/me')
    return adminAuthorized(req)
      ? send(res, 200, { authenticated: true, username: adminSession(req)?.username || 'api-admin' })
      : send(res, 401, { authenticated: false });
  if (url.pathname.startsWith('/api/admin/') && !adminAuthorized(req)) {
    authLog.warn('rejected an unauthenticated admin request', { ip: clientIp(req), path: url.pathname, method: req.method });
    return send(res, 401, { error: 'Unauthorized.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/quotes')
    return send(res, 200, { quotes: await db.collection('quotes').find({}).sort({ createdAt: -1 }).limit(250).toArray() });
  const quotePreviewMatch = url.pathname.match(/^\/api\/admin\/quotes\/([A-Z0-9-]+)\/email-preview$/);
  if (quotePreviewMatch && req.method === 'POST') {
    // Renders the exact email the customer would receive, without sending it.
    if (!sameOrigin(req)) {
      authLog.warn('blocked a cross-origin admin preview', {
        ip: clientIp(req),
        reference: quotePreviewMatch[1],
        origin: req.headers.origin || 'none',
      });
      return send(res, 403, { error: 'Invalid origin.' });
    }
    const body = await parseJson(req),
      adminMessage = clean(body.message, 1500);
    const quote = await db.collection('quotes').findOne({ reference: quotePreviewMatch[1] });
    if (!quote) {
      adminLog.warn('preview requested for an unknown reference', { reference: quotePreviewMatch[1] });
      return send(res, 404, { error: 'Quote request not found.' });
    }
    const product = await db.collection('products').findOne({ id: quote.productId });
    if (!product) {
      adminLog.error('cannot preview because the product no longer exists', { reference: quote.reference, productId: quote.productId });
      return send(res, 409, { error: 'The product configuration no longer exists.' });
    }
    const settings = emailSettings(product);
    const closed = ['closed', 'closed-manually'].includes(quote.status);
    // A lead that has already been sent must be reviewed as it actually went
    // out, which means rendering with the message stored against the record
    // rather than whatever the (empty) request body happens to contain.
    const effectiveMessage = closed ? quote.adminMessage || '' : adminMessage;
    const context = await buildEmailContext(quote, product, effectiveMessage);
    const message = buildMessage('quote', context, quote, settings, effectiveMessage);
    adminLog.info('rendered a customer email preview without sending it', {
      reference: quote.reference,
      productId: product.id,
      to: maskEmail(quote.email),
      hasMessage: Boolean(effectiveMessage),
      fromStoredMessage: closed,
      offers: quote.offers?.length || 0,
      sendable: !closed,
    });
    return send(res, 200, {
      reference: quote.reference,
      to: quote.email,
      kind: 'quote',
      subject: message.subject,
      html: message.html,
      text: message.text,
      sendable: !closed,
      messageRequired: settings.requireAdminMessage && !effectiveMessage,
      sentMessage: effectiveMessage,
      sentAt: closed ? quote.customerEmail?.sentAt || quote.closedAt || '' : '',
      note: closed
        ? 'This is the email that was sent to the customer. It can no longer be sent again.'
        : 'This is exactly what the customer will receive when you press "Send email".',
    });
  }
  const quoteEmailMatch = url.pathname.match(/^\/api\/admin\/quotes\/([A-Z0-9-]+)\/send-email$/);
  if (quoteEmailMatch && req.method === 'POST') {
    if (!sameOrigin(req)) {
      authLog.warn('blocked a cross-origin admin send', {
        ip: clientIp(req),
        reference: quoteEmailMatch[1],
        origin: req.headers.origin || 'none',
      });
      return send(res, 403, { error: 'Invalid origin.' });
    }
    const body = await parseJson(req),
      adminMessage = clean(body.message, 1500);
    adminLog.info('manual send requested', { reference: quoteEmailMatch[1], hasMessage: Boolean(adminMessage) });
    const quote = await db.collection('quotes').findOne({ reference: quoteEmailMatch[1] });
    if (!quote) {
      adminLog.warn('manual send for an unknown reference', { reference: quoteEmailMatch[1] });
      return send(res, 404, { error: 'Quote request not found.' });
    }
    if (quote.status === 'closed') {
      adminLog.warn('manual send refused because the quote is already closed', { reference: quote.reference, status: quote.status });
      return send(res, 409, { error: 'This quote is already closed.' });
    }
    const product = await db.collection('products').findOne({ id: quote.productId });
    if (!product) {
      adminLog.error('the product for this quote no longer exists', { reference: quote.reference, productId: quote.productId });
      return send(res, 409, { error: 'The product configuration no longer exists.' });
    }
    const settings = emailSettings(product);
    if (settings.requireAdminMessage && !adminMessage) {
      adminLog.warn('manual send blocked because this product requires a message', { reference: quote.reference, productId: product.id });
      return send(res, 422, { error: 'Enter the required message before sending.' });
    }
    const attempts = Number(quote.customerEmail?.attempts || 0) + 1;
    try {
      adminLog.info('sending the priced quote to the customer', {
        reference: quote.reference,
        productId: product.id,
        to: maskEmail(quote.email),
        attempt: attempts,
        offers: quote.offers?.length || 0,
      });
      await sendCustomerEmail(quote, product, { adminMessage, kind: 'quote', attempt: attempts });
      const sentAt = new Date().toISOString();
      await db.collection('quotes').updateOne(
        { id: quote.id },
        {
          $set: {
            status: 'closed',
            customerEmail: { status: 'sent', sentAt, error: '', attempts },
            adminMessage,
            closedAt: sentAt,
            updatedAt: sentAt,
          },
        }
      );
      adminLog.info('manual send succeeded and the quote is closed', { reference: quote.reference, attempt: attempts });
      return send(res, 200, { ok: true, status: 'closed', emailStatus: 'sent', message: 'Quote email sent. The request is now closed.' });
    } catch (error) {
      const failedAt = new Date().toISOString(),
        reason = clean(error.message, 500);
      logError(adminLog, 'manual send failed; the quote stays open for another attempt', error, {
        reference: quote.reference,
        attempt: attempts,
      });
      await db.collection('quotes').updateOne(
        { id: quote.id },
        {
          $set: {
            status: 'email-failed',
            customerEmail: { status: 'failed', failedAt, error: reason, attempts },
            adminMessage,
            updatedAt: failedAt,
          },
        }
      );
      return send(res, 502, { error: 'The email could not be sent.', reason, status: 'email-failed' });
    }
  }
  const quoteCloseMatch = url.pathname.match(/^\/api\/admin\/quotes\/([A-Z0-9-]+)\/close$/);
  if (quoteCloseMatch && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const body = await parseJson(req),
      reason = clean(body.reason, 500) || 'Customer contacted manually.';
    const closedAt = new Date().toISOString();
    const result = await db
      .collection('quotes')
      .updateOne(
        { reference: quoteCloseMatch[1], status: { $nin: ['closed', 'closed-manually'] } },
        { $set: { status: 'closed-manually', closeReason: reason, closedAt, updatedAt: closedAt } }
      );
    if (!result.matchedCount) return send(res, 404, { error: 'Open quote request not found.' });
    return send(res, 200, { ok: true, status: 'closed-manually', message: 'Quote marked as closed after manual contact.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/countries')
    return send(res, 200, {
      countries: (
        await db
          .collection('countries')
          .find({ active: { $ne: false } })
          .toArray()
      ).sort((a, b) => a.name.localeCompare(b.name)),
    });
  if (req.method === 'POST' && url.pathname === '/api/admin/countries') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const item = normalizeCountry(await parseJson(req));
    const items = await db
      .collection('countries')
      .find({ active: { $ne: false } })
      .toArray();
    if (items.some((entry) => entry.code === item.code)) return send(res, 409, { error: 'That country code already exists.' });
    await db.collection('countries').insertOne(item);
    invalidateReferenceData();
    adminLog.info('country created', { code: item.code });
    return send(res, 201, { country: item });
  }
  const countryMatch = url.pathname.match(/^\/api\/admin\/countries\/([A-Za-z]{2})$/);
  if (countryMatch && req.method === 'PUT') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const items = await db
      .collection('countries')
      .find({ active: { $ne: false } })
      .toArray();
    const index = items.findIndex((entry) => entry.code === countryMatch[1].toUpperCase());
    if (index < 0) return send(res, 404, { error: 'Country not found.' });
    const item = normalizeCountry(await parseJson(req), countryMatch[1]);
    item.code = countryMatch[1].toUpperCase();
    await db.collection('countries').replaceOne({ code: countryMatch[1].toUpperCase() }, item, { upsert: true });
    invalidateReferenceData();
    adminLog.info('country updated', { code: item.code, name: item.name, active: item.active });
    return send(res, 200, { country: item });
  }
  if (countryMatch && req.method === 'DELETE') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const result = await db.collection('countries').deleteOne({ code: countryMatch[1].toUpperCase() });
    if (result.deletedCount === 0) return send(res, 404, { error: 'Country not found.' });
    invalidateReferenceData();
    adminLog.info('country deleted', { code: countryMatch[1] });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/insurers')
    return send(res, 200, {
      insurers: (
        await db
          .collection('insurers')
          .find({ active: { $ne: false } })
          .toArray()
      ).sort((a, b) => a.name.localeCompare(b.name)),
    });
  if (req.method === 'POST' && url.pathname === '/api/admin/insurers') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const item = normalizeInsurer(await parseJson(req));
    const existing = await db.collection('insurers').findOne({ id: item.id });
    if (existing) return send(res, 409, { error: 'That insurer ID already exists.' });
    await db.collection('insurers').insertOne(item);
    invalidateReferenceData();
    adminLog.info('insurer created', { id: item.id, name: item.name });
    return send(res, 201, { insurer: item });
  }
  const insurerMatch = url.pathname.match(/^\/api\/admin\/insurers\/([a-z0-9-]+)$/);
  if (insurerMatch && req.method === 'PUT') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const existing = await db.collection('insurers').findOne({ id: insurerMatch[1] });
    if (!existing) return send(res, 404, { error: 'Insurer not found.' });
    const item = normalizeInsurer(await parseJson(req), insurerMatch[1]);
    item.id = insurerMatch[1];
    await db.collection('insurers').replaceOne({ id: insurerMatch[1] }, item);
    invalidateReferenceData();
    adminLog.info('insurer updated', { id: item.id, name: item.name, active: item.active, hasWebsite: Boolean(item.website) });
    return send(res, 200, { insurer: item });
  }
  if (insurerMatch && req.method === 'DELETE') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const products = await db
      .collection('products')
      .find({ active: { $ne: false } })
      .toArray();
    if (products.some((product) => product.rates?.some((rate) => rate.insurerId === insurerMatch[1])))
      return send(res, 409, { error: 'This insurer is used by a product rate. Deactivate it instead.' });
    const result = await db.collection('insurers').deleteOne({ id: insurerMatch[1] });
    if (result.deletedCount === 0) return send(res, 404, { error: 'Insurer not found.' });
    invalidateReferenceData();
    adminLog.info('insurer deleted', { id: insurerMatch[1] });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/products')
    return send(res, 200, {
      products: await db
        .collection('products')
        .find({ active: { $ne: false } })
        .toArray(),
    });
  if (req.method === 'POST' && url.pathname === '/api/admin/products') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const product = await ensureKnownInsurers(normalizeProduct(await parseJson(req), '', {}));
    const existing = await db.collection('products').findOne({ id: product.id });
    if (existing) return send(res, 409, { error: 'A product with this ID already exists.' });
    await db.collection('products').insertOne(product);
    adminLog.info('product created', {
      id: product.id,
      name: product.name,
      fields: product.fields.length,
      rates: product.rates.length,
      emailMode: product.emailConfig.immediateEmailMode,
      immediate: product.emailConfig.sendEmailImmediately,
    });
    return send(res, 201, { product });
  }
  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)$/);
  if (productMatch && req.method === 'PUT') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const existing = await db.collection('products').findOne({ id: productMatch[1] });
    if (!existing) return send(res, 404, { error: 'Product not found.' });
    const product = await ensureKnownInsurers(normalizeProduct(await parseJson(req), productMatch[1], existing.emailConfig || {}));
    product.id = productMatch[1];
    await db.collection('products').replaceOne({ id: productMatch[1] }, product);
    adminLog.info('product updated', {
      id: product.id,
      name: product.name,
      fields: product.fields.length,
      rates: product.rates.length,
      emailMode: product.emailConfig.immediateEmailMode,
      immediate: product.emailConfig.sendEmailImmediately,
      notifyTeam: product.emailConfig.notifyTeam,
    });
    return send(res, 200, { product });
  }
  if (productMatch && req.method === 'DELETE') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const result = await db.collection('products').deleteOne({ id: productMatch[1] });
    if (result.deletedCount === 0) return send(res, 404, { error: 'Product not found.' });
    adminLog.warn('product deleted; existing quote records are kept', { id: productMatch[1] });
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'API route not found.' });
}

async function staticFile(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, { error: 'Malformed request path.' });
  }
  if (pathname === '/') pathname = '/index.html';
  const resolved = normalize(join(publicDir, pathname));
  if (!resolved.startsWith(publicDir + sep)) return send(res, 403, { error: 'Forbidden.' });
  const ext = extname(resolved).toLowerCase();
  const sendHtml = (status, body) => {
    res.writeHead(status, { ...securityHeaders, 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw Object.assign(new Error(), { code: 'ENOENT' });
    const content = await readFile(resolved);
    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(content);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (ext && ext !== '.html')
      return sendHtml(404, '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>404 &mdash; not found</h1>');
    const content = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-cache' });
    res.end(content);
  }
}
export async function handleRequest(req, res) {
  const startedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;

  // Capture the status so every request produces exactly one summary line.
  let status = 200;
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (code, ...rest) => {
    status = code;
    return writeHead(code, ...rest);
  };

  const isApi = route.startsWith('/api/');
  const log = isApi ? apiLog : createLogger('web');

  try {
    if (isApi) {
      await connectDB();
      await api(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      await staticFile(req, res, url);
    } else {
      status = 405;
      send(res, 405, { error: 'Method not allowed.' });
    }
  } catch (error) {
    const known = clientErrors[error.message];
    if (known) {
      status = known[0];
      log.warn('request rejected', { requestId, method: req.method, route, reason: error.message, ip: clientIp(req) });
    } else {
      status = 500;
      logError(log, 'unhandled error while serving a request', error, { requestId, method: req.method, route });
    }
    if (!res.headersSent) send(res, known ? known[0] : 500, { error: known ? known[1] : 'Something went wrong.' });
  } finally {
    const duration = Date.now() - startedAt;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    log[level]('request', { requestId, method: req.method, route, status, tookMs: formatDuration(duration) });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer(handleRequest);

  log.info('starting Signature Broker', {
    port,
    env: process.env.NODE_ENV || 'development',
    mongodb: safeHost(mongoUri),
    emailConfigured: Boolean(resendApiKey && quoteEmailTo),
    providerConfigured: Boolean(providerUrl && providerKey),
    brandLogo: brandLogoDataUri() ? 'png' : 'vector-fallback',
    company: COMPANY.name,
  });

  if (!adminLoginAllowed) {
    log.error('ADMIN LOGIN IS DISABLED because ADMIN_PASSWORD is still the default value "insurance"');
    log.error('Set ADMIN_PASSWORD in the environment before serving production traffic');
  }
  if (!adminKey) log.warn('ADMIN_API_KEY is not set, so machine access to the admin API is disabled');
  if (!resendApiKey) log.warn('RESEND_API_KEY is not set, so no customer or team email can be delivered');
  if (!quoteEmailTo) log.warn('QUOTE_EMAIL_TO is not set, so team notifications cannot be delivered');

  server.on('error', (error) => {
    logError(log, 'the HTTP server reported an error', error, { port });
    process.exit(1);
  });

  server.on('close', () => log.info('http server closed'));

  connectDB()
    .then(() => {
      server.listen(port, () => {
        log.info(`Signature Broker is running on http://localhost:${port}`);
        log.info(`public site   http://localhost:${port}/`);
        log.info(`admin console http://localhost:${port}/admin.html`);
      });
    })
    .catch((error) => {
      log.error('startup aborted because MongoDB is unreachable; set MONGODB_URI and allow this host in the Atlas IP allowlist', { error });
      process.exit(1);
    });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      log.info('shutdown signal received, closing the server', { signal, activeSessions: sessions.size });
      server.close(async () => {
        await closeDB();
        log.info('shutdown complete');
        process.exit(0);
      });
      setTimeout(() => {
        log.warn('forcing shutdown after the grace period', { graceMs: 10000 });
        process.exit(0);
      }, 10000).unref();
    });
  }

  process.on('unhandledRejection', (reason) =>
    logError(log, 'unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)))
  );
  process.on('uncaughtException', (error) => {
    logError(log, 'uncaught exception; the process is exiting', error);
    process.exit(1);
  });
}
