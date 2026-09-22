import 'dotenv/config';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'dist');
const port = Number(process.env.SIGNATURE_PORT || 3000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/signaturebroker';
const adminKey = process.env.ADMIN_API_KEY || '';
const adminUsername = process.env.ADMIN_USERNAME || 'insurance';
const adminPassword = process.env.ADMIN_PASSWORD || 'insurance';
const providerUrl = (process.env.QUOTE_PROVIDER_URL || '').replace(/\/$/, '');
const providerKey = process.env.QUOTE_PROVIDER_API_KEY || '';
const resendApiKey = process.env.RESEND_API_KEY || '';
const quoteEmailTo = process.env.QUOTE_EMAIL_TO || '';
const quoteEmailFrom = process.env.QUOTE_EMAIL_FROM || 'Signature Broker <quotes@signaturebroker.ng>';
const rateLimits = new Map();
const sessions = new Map();
let db;

// const seedProducts = [
//   { id: 'motor-comprehensive', name: 'Motor Comprehensive', description: 'Cover for accidental damage, fire, theft and third-party liability.', active: true, fields: [
//     { key: 'vehicleValue', label: 'Estimated value of vehicle', type: 'currency', required: true, min: 500000, max: 1000000000, placeholder: '1,000,000' },
//     { key: 'duration', label: 'Length of cover', type: 'select', required: true, options: [{ value: '6', label: '6 months' }, { value: '12', label: '12 months' }] },
//     { key: 'usage', label: 'Usage', type: 'select', required: true, options: [{ value: 'private', label: 'Private' }, { value: 'commercial', label: 'Commercial' }] }
//   ], benefits: ['Accidental damage', 'Fire and theft', 'Third-party liability'], exclusions: ['Mechanical breakdown', 'Driving without a valid licence'], rates: [{ id: 'default-motor-comprehensive', insurer: 'Default insurer', model: 'percentage', percentage: 5, currency: 'NGN', validFrom: '2026-01-01', validTo: '2026-12-31', active: true }]},
//   { id: 'motor-third-party', name: 'Motor Third Party', description: 'Mandatory liability protection for injury or damage caused to others.', active: true, fields: [
//     { key: 'vehicleType', label: 'Vehicle type', type: 'select', required: true, options: [{ value: 'private', label: 'Private car / SUV' }, { value: 'own-goods', label: 'Own-goods commercial vehicle' }, { value: 'staff-bus', label: 'Staff bus' }, { value: 'truck', label: 'Truck / general cartage' }, { value: 'tricycle', label: 'Tricycle' }, { value: 'motorcycle', label: 'Motorcycle' }] },
//     { key: 'duration', label: 'Length of cover', type: 'select', required: true, options: [{ value: '12', label: '12 months' }] }
//   ], benefits: ['Third-party property damage', 'Third-party injury and death'], exclusions: ['Damage to your own vehicle'], rates: [{ id: 'default-third-party', insurer: 'Default insurer', model: 'fixed', amount: 15000, currency: 'NGN', validFrom: '2026-01-01', validTo: '2026-12-31', active: true }]},
//   { id: 'travel', name: 'Travel Insurance', description: 'Medical, delay and baggage protection for an international trip.', active: true, fields: [
//     { key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
//     { key: 'destination', label: 'Destination country', type: 'country', required: true, placeholder: 'e.g. France' },
//     { key: 'startDate', label: 'Start date', type: 'date', required: true },
//     { key: 'endDate', label: 'End date', type: 'date', required: true },
//     { key: 'travellers', label: 'Number of travellers', type: 'number', required: true, min: 1, max: 10, value: 1 }
//   ], benefits: ['Emergency medical expenses', 'Trip delay', 'Lost baggage'], exclusions: [], rates: []},
//   { id: 'health', name: 'Health Insurance', description: 'Healthcare cover for an individual or family.', active: true, fields: [
//     { key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
//     { key: 'startDate', label: 'Preferred start date', type: 'date', required: true },
//     { key: 'members', label: 'People to cover', type: 'number', required: true, min: 1, max: 20, value: 1 },
//     { key: 'coverArea', label: 'Cover area', type: 'select', required: true, options: [{ value: 'nigeria', label: 'Nigeria' }, { value: 'africa', label: 'Africa' }, { value: 'worldwide', label: 'Worldwide' }] }
//   ], benefits: ['Out-patient care', 'In-patient care', 'Emergency treatment'], exclusions: [], rates: [{ id: 'default-health', insurer: 'Default insurer', model: 'age-bands', currency: 'NGN', ageBands: [{ minAge: 0, maxAge: 17, amount: 50000 }, { minAge: 18, maxAge: 35, amount: 89500 }, { minAge: 36, maxAge: 50, amount: 115000 }, { minAge: 51, maxAge: 60, amount: 165000 }, { minAge: 61, maxAge: 80, amount: 250000 }], validFrom: '2026-01-01', validTo: '2026-12-31', active: true }]}
// ];
//
// const seedCountries = [
//   ['NG', 'Nigeria'], ['GH', 'Ghana'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['EG', 'Egypt'], ['RW', 'Rwanda'], ['UG', 'Uganda'], ['TZ', 'Tanzania'],
//   ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['AE', 'United Arab Emirates'], ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'],
//   ['NL', 'Netherlands'], ['TR', 'Türkiye'], ['CN', 'China'], ['IN', 'India'], ['JP', 'Japan'], ['AU', 'Australia'], ['BR', 'Brazil']
// ].map(([code, name]) => ({ code, name, active: true }));
// const seedInsurers = [
//   ['default-insurer', 'Default insurer', 'DEFAULT'],
//   ['aiico', 'AIICO Insurance', 'AIICO'], ['axa-mansard', 'AXA Mansard Insurance', 'AXA'], ['leadway', 'Leadway Assurance', 'LEADWAY'],
//   ['custodian', 'Custodian and Allied Insurance', 'CUSTODIAN'], ['nem', 'NEM Insurance', 'NEM'], ['cornerstone', 'Cornerstone Insurance', 'CORNERSTONE']
// ].map(([id, name, code]) => ({ id, name, code, active: true, website: '', contactEmail: '' }));

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const securityHeaders = { 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https://images.pexels.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };

function send(res, status, body, headers = {}) { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function clean(value, max = 200) { return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, max) : ''; }
function clientIp(req) { return clean(req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown', 80); }
function allowRequest(key, limit = 8) { const now = Date.now(); const item = rateLimits.get(key) || { count: 0, reset: now + 3600000 }; if (now > item.reset) Object.assign(item, { count: 0, reset: now + 3600000 }); item.count++; rateLimits.set(key, item); return item.count <= limit; }
async function parseJson(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 30000) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('INVALID_JSON'); } }
function isAdmin(req) { if (!adminKey) return false; const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); return supplied.length === adminKey.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(adminKey)); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter((item) => item.length === 2)); }
function adminSession(req) { const token = cookies(req).signature_admin; const session = token && sessions.get(token); if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); return null; } return session; }
function adminAuthorized(req) { return Boolean(adminSession(req) || isAdmin(req)); }
function loginCookie(token) { return `signature_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { const originHost = new URL(origin).host; const frontendPort = process.env.FRONTEND_PORT || '5173'; return originHost === req.headers.host || originHost === `localhost:${frontendPort}` || req.headers.host === `localhost:${frontendPort}`; } catch { return false; } }

async function getDb() { if (!db) throw new Error('Database not connected'); return db; }
async function connectDB() {
  const client = await MongoClient.connect(mongoUri);
  db = client.db();
  await Promise.all([
    db.collection('quotes').createIndex({ reference: 1 }, { unique: true }),
    db.collection('quotes').createIndex({ createdAt: -1 }),
    db.collection('products').createIndex({ id: 1 }, { unique: true })
  ]);
  // const productsCount = await db.collection('products').countDocuments();
  // if (productsCount === 0) {
  //   await db.collection('products').insertMany(seedProducts);
  //   await db.collection('countries').insertMany(seedCountries);
  //   await db.collection('insurers').insertMany(seedInsurers);
  //   console.log('Seed data inserted into MongoDB.');
  // }
  console.log('Connected to MongoDB.');
}

function normalizeProduct(input, existingId = '') {
  const id = clean(input.id || existingId, 60).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const name = clean(input.name, 100), description = clean(input.description, 500);
  if (!id || !name) throw new Error('INVALID_PRODUCT');
  const allowedTypes = new Set(['text', 'number', 'currency', 'date', 'country', 'select']);
  const fields = Array.isArray(input.fields) ? input.fields.slice(0, 30).map((field) => {
    const key = clean(field.key, 60).replace(/[^a-zA-Z0-9_]/g, '');
    const type = allowedTypes.has(field.type) ? field.type : 'text';
    if (!key || !clean(field.label, 100)) throw new Error('INVALID_PRODUCT');
    const normalized = { key, label: clean(field.label, 100), type, required: Boolean(field.required) };
    if (Number.isFinite(Number(field.min))) normalized.min = Number(field.min);
    if (Number.isFinite(Number(field.max))) normalized.max = Number(field.max);
    if (field.placeholder) normalized.placeholder = clean(field.placeholder, 120);
    if (type === 'select') normalized.options = Array.isArray(field.options) ? field.options.slice(0, 50).map((option) => ({ value: clean(option.value, 80), label: clean(option.label, 100) })).filter((option) => option.value && option.label) : [];
    return normalized;
  }) : [];
  const allowedModels = new Set(['fixed', 'percentage', 'age-bands', 'underwriting']);
  const rates = Array.isArray(input.rates) ? input.rates.slice(0, 50).map((rate) => ({ id: clean(rate.id, 80) || randomUUID(), insurerId: clean(rate.insurerId, 80), insurer: clean(rate.insurer, 100), model: allowedModels.has(rate.model) ? rate.model : 'underwriting', currency: clean(rate.currency || 'NGN', 10), amount: Number(rate.amount) || 0, percentage: Number(rate.percentage) || 0, ageBands: Array.isArray(rate.ageBands) ? rate.ageBands.slice(0, 30).map((band) => ({ minAge: Number(band.minAge), maxAge: Number(band.maxAge), amount: Number(band.amount) })).filter((band) => Number.isFinite(band.minAge) && Number.isFinite(band.maxAge) && Number.isFinite(band.amount)) : [], loadings: Array.isArray(rate.loadings) ? rate.loadings.slice(0, 30).map((loading) => ({ field: clean(loading.field, 60), equals: clean(loading.equals, 80), percentage: Number(loading.percentage) || 0 })) : [], excess: clean(rate.excess, 160), waitingPeriod: clean(rate.waitingPeriod, 160), validFrom: clean(rate.validFrom, 10), validTo: clean(rate.validTo, 10), active: rate.active !== false })).filter((rate) => rate.insurerId || rate.insurer) : [];
  return { id, name, description, active: input.active !== false, sendEmailImmediately: input.sendEmailImmediately === true, requireAdminMessage: input.requireAdminMessage === true, emailSubject: clean(input.emailSubject, 160), emailIntroduction: clean(input.emailIntroduction, 1000), fields, benefits: Array.isArray(input.benefits) ? input.benefits.slice(0, 30).map((item) => clean(item, 160)).filter(Boolean) : [], exclusions: Array.isArray(input.exclusions) ? input.exclusions.slice(0, 30).map((item) => clean(item, 160)).filter(Boolean) : [], rates, updatedAt: new Date().toISOString() };
}
async function ensureKnownInsurers(product) { const ids = new Set((await db.collection('insurers').find({ active: { $ne: false } }).toArray()).map((item) => item.id)); if (product.rates.some((rate) => rate.insurerId && !ids.has(rate.insurerId))) throw new Error('INVALID_INSURER'); return product; }
function normalizeCountry(input, existingCode = '') { const code = clean(input.code || existingCode, 2).toUpperCase(); const name = clean(input.name, 100); if (!/^[A-Z]{2}$/.test(code) || !name) throw new Error('INVALID_COUNTRY'); return { code, name, active: input.active !== false }; }
function normalizeInsurer(input, existingId = '') { const name = clean(input.name, 120); const id = clean(input.id || existingId || name, 80).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); const code = clean(input.code, 30).toUpperCase(); const website = clean(input.website, 240); const contactEmail = clean(input.contactEmail, 120).toLowerCase(); if (!id || !name) throw new Error('INVALID_INSURER'); if (website && !/^https?:\/\//i.test(website)) throw new Error('INVALID_INSURER'); if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('INVALID_INSURER'); return { id, name, code, active: input.active !== false, website, contactEmail }; }

function validateDetails(product, values) {
  const details = {};
  const errors = {};
  for (const field of product.fields) {
    let value = clean(values[field.key], 120);
    if (field.type === 'currency') value = value.replace(/[^0-9.]/g, '');
    if (field.required && !value) errors[field.key] = `${field.label} is required.`;
    if (field.type === 'select' && value && !field.options.some((option) => option.value === value)) errors[field.key] = `Choose a valid ${field.label.toLowerCase()}.`;
    if (['number', 'currency'].includes(field.type) && value) { const number = Number(value); if (!Number.isFinite(number) || number < field.min || number > field.max) errors[field.key] = `${field.label} is outside the accepted range.`; else value = number; }
    if (field.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[field.key] = `Enter a valid ${field.label.toLowerCase()}.`;
    details[field.key] = value;
  }
  if (product.id === 'travel' && details.startDate && details.endDate && details.endDate < details.startDate) errors.endDate = 'End date must be after the start date.';
  return { details, errors };
}

function ageFromDate(value) { const birth = new Date(value); if (Number.isNaN(birth.getTime())) return null; const now = new Date(); let age = now.getUTCFullYear() - birth.getUTCFullYear(); if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--; return age; }
function configuredOffers(product, details, insurers = [], selectedInsurerId = '') {
  const today = new Date().toISOString().slice(0, 10);
  return (product.rates || []).filter((rate) => { const insurer = insurers.find((item) => item.id === rate.insurerId || item.name === rate.insurer); return rate.active !== false && (!selectedInsurerId || insurer?.id === selectedInsurerId) && (!rate.validFrom || rate.validFrom <= today) && (!rate.validTo || rate.validTo >= today); }).map((rate) => {
    let premium = null;
    if (rate.model === 'fixed') premium = Number(rate.amount);
    if (rate.model === 'percentage') premium = Number(String(details.vehicleValue || details.sumInsured || '').replace(/[^0-9.]/g, '')) * Number(rate.percentage) / 100;
    if (rate.model === 'age-bands') { const age = ageFromDate(details.dateOfBirth); const band = rate.ageBands?.find((item) => age >= item.minAge && age <= item.maxAge); premium = band ? Number(band.amount) : null; const members = Number(details.members || 1); if (premium != null && Number.isFinite(members)) premium *= members; }
    if (premium != null) for (const loading of rate.loadings || []) if (String(details[loading.field]) === loading.equals) premium *= 1 + Number(loading.percentage) / 100;
    if (!Number.isFinite(premium) || premium <= 0) return null;
    const insurer = insurers.find((item) => item.id === rate.insurerId || item.name === rate.insurer);
    return { id: rate.id, insurer: insurer?.name || rate.insurer || 'Insurer', insurerId: insurer?.id || rate.insurerId || '', plan: product.name, premium: Math.round(premium), currency: rate.currency || 'NGN', benefits: product.benefits || [], exclusions: product.exclusions || [], excess: rate.excess || '', waitingPeriod: rate.waitingPeriod || '', purchaseUrl: insurer?.website || null };
  }).filter(Boolean);
}

async function requestLiveOffers(quote, product) {
  const localOffers = configuredOffers(product, quote.details, await db.collection('insurers').find({ active: { $ne: false } }).toArray(), quote.insurerId);
  if (!providerUrl || !providerKey) return { configured: localOffers.length > 0, offers: localOffers };
  const response = await fetch(`${providerUrl}/quotes`, { method: 'POST', headers: { Authorization: `Bearer ${providerKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': quote.id, 'User-Agent': 'SignatureBroker/1.0' }, body: JSON.stringify({ reference: quote.reference, productId: quote.productId, insurerId: quote.insurerId, customer: { name: quote.name, email: quote.email, phone: quote.phone }, details: quote.details }) });
  if (!response.ok) throw new Error(`Quote provider returned ${response.status}`);
  const result = await response.json();
  const offers = Array.isArray(result.offers) ? result.offers.slice(0, 20).map((offer) => ({ id: clean(offer.id, 100), insurer: clean(offer.insurer, 100), plan: clean(offer.plan, 120), premium: Number(offer.premium), currency: clean(offer.currency || 'NGN', 10), benefits: Array.isArray(offer.benefits) ? offer.benefits.slice(0, 8).map((item) => clean(item, 160)) : [], purchaseUrl: /^https:\/\//.test(offer.purchaseUrl || '') ? offer.purchaseUrl : null })).filter((offer) => offer.insurer && Number.isFinite(offer.premium)) : [];
  return { configured: true, offers: [...localOffers, ...offers] };
}

async function sendEmail(message, idempotencyKey) {
  console.log('[EMAIL] Attempting to send email...');
  console.log('[EMAIL] From:', message.from);
  console.log('[EMAIL] To:', message.to);
  console.log('[EMAIL] Subject:', message.subject);
  console.log('[EMAIL] Idempotency-Key:', idempotencyKey);
  if (!resendApiKey) { console.log('[EMAIL] FAILED: resendApiKey is not set'); throw new Error('Email service is not configured.'); }
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'SignatureBroker/1.0', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(message) });
    const responseText = await response.text();
    console.log('[EMAIL] Response status:', response.status);
    console.log('[EMAIL] Response body:', responseText);
    if (!response.ok) { throw new Error(`Email provider returned ${response.status}: ${responseText}`); }
    console.log('[EMAIL] SUCCESS');
    return true;
  } catch (error) {
    console.log('[EMAIL] ERROR:', error.message);
    throw error;
  }
}
function offerText(quote) { return quote.offers?.length ? quote.offers.map((offer) => `${offer.plan}: ${offer.currency} ${Number(offer.premium).toLocaleString()}`).join('\n') : 'We received your request and will contact you with the quotation details.'; }
async function sendTeamNotification(quote) { if (!quoteEmailTo) { console.log('[TEAM] FAILED: QUOTE_EMAIL_TO is not configured'); throw new Error('QUOTE_EMAIL_TO is not configured.'); } console.log('[TEAM] Sending team notification for', quote.reference, 'to', quoteEmailTo); return sendEmail({ from: quoteEmailFrom, to: [quoteEmailTo], reply_to: quote.email, subject: `New quote request — ${quote.reference}`, text: `New quote request\n\nReference: ${quote.reference}\nProduct: ${quote.productName}\nName: ${quote.name}\nEmail: ${quote.email}\nPhone: ${quote.phone}\n\n${offerText(quote)}` }, `${quote.id}-team`); }
async function sendCustomerQuote(quote, product, adminMessage = '') { const introduction = clean(adminMessage, 1500) || product.emailIntroduction || 'Thank you for requesting a quote from Signature Insurance Brokers Limited.'; console.log('[CUSTOMER] Sending customer quote to', quote.email, 'for', quote.reference, 'from', product.name); return sendEmail({ from: quoteEmailFrom, to: [quote.email], subject: product.emailSubject || `Your insurance quote — ${quote.reference}`, text: `Hello ${quote.name},\n\n${introduction}\n\n${offerText(quote)}\n\nReference: ${quote.reference}\n\nSignature Insurance Brokers Limited\nRC 125137\n09012079823 · 08177770231` }, `${quote.id}-customer-${Number(quote.customerEmail?.attempts || 0) + 1}`); }

async function createQuote(req, res) {
  if (!allowRequest(`${clientIp(req)}:quote`, 10)) return send(res, 429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': '3600' });
  const body = await parseJson(req);
  if (body.website) return send(res, 202, { ok: true });
  const catalog = await db.collection('products').find({ active: { $ne: false } }).toArray();
  const product = catalog.find((item) => item.active !== false && item.id === clean(body.productId, 60));
  const insurers = await db.collection('insurers').find({ active: { $ne: false } }).toArray();
  const name = clean(body.name, 80), email = clean(body.email, 120).toLowerCase(), phone = clean(body.phone, 20);
  const errors = {};
  if (!product) errors.productId = 'Choose a valid insurance product.';
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!/^[+0-9 ()-]{7,20}$/.test(phone)) errors.phone = 'Enter a valid phone number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (body.consent !== true) errors.consent = 'Consent is required.';
  const validation = product ? validateDetails(product, body.details || {}) : { details: {}, errors: {} };
  Object.assign(errors, validation.errors);
  if (Object.keys(errors).length) return send(res, 422, { error: 'Please check the form.', fields: errors });
  const quote = { id: randomUUID(), reference: `SB-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, productId: product.id, productName: product.name, name, email, phone, details: validation.details, status: 'requesting-offers', offers: [], teamEmail: { status: 'pending', error: '' }, customerEmail: { status: product.sendEmailImmediately ? 'pending' : 'awaiting-admin', error: '', attempts: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  let provider;
  try { provider = await requestLiveOffers(quote, product); quote.offers = provider.offers; quote.status = provider.configured ? (quote.offers.length ? 'quoted' : 'no-offers') : 'awaiting-rates'; }
  catch (error) { console.error('Quote provider failed:', error.message); provider = { configured: true, offers: [] }; quote.status = 'provider-error'; }
  quote.status = product.sendEmailImmediately ? 'sending-email' : 'awaiting-email';
  await db.collection('quotes').insertOne(quote);
  console.log('[QUOTE] Created quote', quote.reference, 'status:', quote.status, 'sendEmailImmediately:', product.sendEmailImmediately);
  try { console.log('[QUOTE] Sending team notification...'); await sendTeamNotification(quote); quote.teamEmail = { status: 'sent', sentAt: new Date().toISOString(), error: '' }; console.log('[QUOTE] Team notification sent'); }
  catch (error) { console.log('[QUOTE] Team notification failed:', error.message); quote.teamEmail = { status: 'failed', error: clean(error.message, 500), failedAt: new Date().toISOString() }; }
  if (product.sendEmailImmediately) {
    quote.customerEmail.attempts = 1;
    try { console.log('[QUOTE] Sending customer quote immediately...'); await sendCustomerQuote(quote, product); quote.customerEmail = { status: 'sent', sentAt: new Date().toISOString(), error: '', attempts: 1 }; quote.status = 'closed'; quote.closedAt = new Date().toISOString(); console.log('[QUOTE] Customer quote sent'); }
    catch (error) { console.log('[QUOTE] Customer quote failed:', error.message); quote.customerEmail = { status: 'failed', error: clean(error.message, 500), failedAt: new Date().toISOString(), attempts: 1 }; quote.status = 'email-failed'; }
  }
  quote.updatedAt = new Date().toISOString();
  await db.collection('quotes').updateOne({ id: quote.id }, { $set: { status: quote.status, teamEmail: quote.teamEmail, customerEmail: quote.customerEmail, closedAt: quote.closedAt || null, updatedAt: quote.updatedAt } });
  console.log('[QUOTE] Final status:', quote.status, 'teamEmail:', quote.teamEmail.status, 'customerEmail:', quote.customerEmail.status);
  send(res, quote.offers.length ? 201 : 202, { ok: true, reference: quote.reference, status: quote.status, offers: quote.offers, emailStatus: quote.customerEmail.status, teamNotificationStatus: quote.teamEmail.status, message: product.sendEmailImmediately ? (quote.customerEmail.status === 'sent' ? 'Your quote was emailed successfully.' : 'Your request was saved, but the quote email could not be sent. Our team has been notified.') : 'Your quote request was saved. Our team will review and send it to you.' });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, providerConfigured: Boolean(providerUrl && providerKey), emailConfigured: Boolean(resendApiKey) });
  if (req.method === 'GET' && url.pathname === '/api/products') { const products = (await db.collection('products').find({ active: { $ne: false } }).toArray()).map(({ _id, rates, sendEmailImmediately, requireAdminMessage, emailSubject, emailIntroduction, ...product }) => product); return send(res, 200, { products }); }
  if (req.method === 'GET' && url.pathname === '/api/countries') return send(res, 200, { countries: (await db.collection('countries').find({ active: { $ne: false } }).toArray()).sort((a, b) => a.name.localeCompare(b.name)) });
  if (req.method === 'GET' && url.pathname === '/api/insurers') return send(res, 200, { insurers: (await db.collection('insurers').find({ active: { $ne: false } }).toArray()).map(({ contactEmail, ...item }) => item).sort((a, b) => a.name.localeCompare(b.name)) });
  if (req.method === 'POST' && url.pathname === '/api/quotes') return createQuote(req, res);
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (!allowRequest(`${clientIp(req)}:login`, 10)) return send(res, 429, { error: 'Too many login attempts.' });
    const body = await parseJson(req); const username = clean(body.username, 80), password = clean(body.password, 200);
    const userOk = username.length === adminUsername.length && timingSafeEqual(Buffer.from(username), Buffer.from(adminUsername));
    const passwordOk = password.length === adminPassword.length && timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword));
    if (!userOk || !passwordOk) return send(res, 401, { error: 'Invalid username or password.' });
    const token = `${randomUUID()}${randomUUID()}`; sessions.set(token, { username, expiresAt: Date.now() + 28800000 });
    return send(res, 200, { ok: true, username }, { 'Set-Cookie': loginCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') { const token = cookies(req).signature_admin; if (token) sessions.delete(token); return send(res, 200, { ok: true }, { 'Set-Cookie': 'signature_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/me') return adminAuthorized(req) ? send(res, 200, { authenticated: true, username: adminSession(req)?.username || 'api-admin' }) : send(res, 401, { authenticated: false });
  if (url.pathname.startsWith('/api/admin/') && !adminAuthorized(req)) return send(res, 401, { error: 'Unauthorized.' });
  if (req.method === 'GET' && url.pathname === '/api/admin/quotes') return send(res, 200, { quotes: await db.collection('quotes').find({}).sort({ createdAt: -1 }).limit(250).toArray() });
  const quoteEmailMatch = url.pathname.match(/^\/api\/admin\/quotes\/([A-Z0-9-]+)\/send-email$/);
  if (quoteEmailMatch && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const body = await parseJson(req), adminMessage = clean(body.message, 1500);
    console.log('[ADMIN-SEND-EMAIL] Request for quote', quoteEmailMatch[1], 'adminMessage:', !!adminMessage);
    const quote = await db.collection('quotes').findOne({ reference: quoteEmailMatch[1] });
    if (!quote) return send(res, 404, { error: 'Quote request not found.' });
    if (quote.status === 'closed') return send(res, 409, { error: 'This quote is already closed.' });
    const product = await db.collection('products').findOne({ id: quote.productId });
    if (!product) return send(res, 409, { error: 'The product configuration no longer exists.' });
    if (product.requireAdminMessage && !adminMessage) return send(res, 422, { error: 'Enter the required message before sending.' });
    const attempts = Number(quote.customerEmail?.attempts || 0) + 1;
    try {
      console.log('[ADMIN-SEND-EMAIL] Sending customer quote to', quote.email, 'for', quote.reference);
      await sendCustomerQuote(quote, product, adminMessage);
      const sentAt = new Date().toISOString();
      await db.collection('quotes').updateOne({ id: quote.id }, { $set: { status: 'closed', customerEmail: { status: 'sent', sentAt, error: '', attempts }, adminMessage, closedAt: sentAt, updatedAt: sentAt } });
      console.log('[ADMIN-SEND-EMAIL] SUCCESS for', quote.reference);
      return send(res, 200, { ok: true, status: 'closed', emailStatus: 'sent', message: 'Quote email sent. The request is now closed.' });
    } catch (error) {
      const failedAt = new Date().toISOString(), reason = clean(error.message, 500);
      console.log('[ADMIN-SEND-EMAIL] FAILED for', quote.reference, ':', error.message);
      await db.collection('quotes').updateOne({ id: quote.id }, { $set: { status: 'email-failed', customerEmail: { status: 'failed', failedAt, error: reason, attempts }, adminMessage, updatedAt: failedAt } });
      return send(res, 502, { error: 'The email could not be sent.', reason, status: 'email-failed' });
    }
  }
  const quoteCloseMatch = url.pathname.match(/^\/api\/admin\/quotes\/([A-Z0-9-]+)\/close$/);
  if (quoteCloseMatch && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' });
    const body = await parseJson(req), reason = clean(body.reason, 500) || 'Customer contacted manually.';
    const closedAt = new Date().toISOString();
    const result = await db.collection('quotes').updateOne({ reference: quoteCloseMatch[1], status: { $nin: ['closed', 'closed-manually'] } }, { $set: { status: 'closed-manually', closeReason: reason, closedAt, updatedAt: closedAt } });
    if (!result.matchedCount) return send(res, 404, { error: 'Open quote request not found.' });
    return send(res, 200, { ok: true, status: 'closed-manually', message: 'Quote marked as closed after manual contact.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/countries') return send(res, 200, { countries: (await db.collection('countries').find({ active: { $ne: false } }).toArray()).sort((a, b) => a.name.localeCompare(b.name)) });
  if (req.method === 'POST' && url.pathname === '/api/admin/countries') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const item = normalizeCountry(await parseJson(req)); const items = await db.collection('countries').find({ active: { $ne: false } }).toArray(); if (items.some((entry) => entry.code === item.code)) return send(res, 409, { error: 'That country code already exists.' }); await db.collection('countries').insertOne(item); return send(res, 201, { country: item }); }
  const countryMatch = url.pathname.match(/^\/api\/admin\/countries\/([A-Za-z]{2})$/);
  if (countryMatch && req.method === 'PUT') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const items = await db.collection('countries').find({ active: { $ne: false } }).toArray(); const index = items.findIndex((entry) => entry.code === countryMatch[1].toUpperCase()); if (index < 0) return send(res, 404, { error: 'Country not found.' }); const item = normalizeCountry(await parseJson(req), countryMatch[1]); item.code = countryMatch[1].toUpperCase(); await db.collection('countries').replaceOne({ code: countryMatch[1].toUpperCase() }, item, { upsert: true }); return send(res, 200, { country: item }); }
  if (countryMatch && req.method === 'DELETE') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const result = await db.collection('countries').deleteOne({ code: countryMatch[1].toUpperCase() }); if (result.deletedCount === 0) return send(res, 404, { error: 'Country not found.' }); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/insurers') return send(res, 200, { insurers: (await db.collection('insurers').find({ active: { $ne: false } }).toArray()).sort((a, b) => a.name.localeCompare(b.name)) });
  if (req.method === 'POST' && url.pathname === '/api/admin/insurers') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const item = normalizeInsurer(await parseJson(req)); const existing = await db.collection('insurers').findOne({ id: item.id }); if (existing) return send(res, 409, { error: 'That insurer ID already exists.' }); await db.collection('insurers').insertOne(item); return send(res, 201, { insurer: item }); }
  const insurerMatch = url.pathname.match(/^\/api\/admin\/insurers\/([a-z0-9-]+)$/);
  if (insurerMatch && req.method === 'PUT') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const existing = await db.collection('insurers').findOne({ id: insurerMatch[1] }); if (!existing) return send(res, 404, { error: 'Insurer not found.' }); const item = normalizeInsurer(await parseJson(req), insurerMatch[1]); item.id = insurerMatch[1]; await db.collection('insurers').replaceOne({ id: insurerMatch[1] }, item); return send(res, 200, { insurer: item }); }
  if (insurerMatch && req.method === 'DELETE') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const products = await db.collection('products').find({ active: { $ne: false } }).toArray(); if (products.some((product) => product.rates?.some((rate) => rate.insurerId === insurerMatch[1]))) return send(res, 409, { error: 'This insurer is used by a product rate. Deactivate it instead.' }); const result = await db.collection('insurers').deleteOne({ id: insurerMatch[1] }); if (result.deletedCount === 0) return send(res, 404, { error: 'Insurer not found.' }); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/products') return send(res, 200, { products: await db.collection('products').find({ active: { $ne: false } }).toArray() });
  if (req.method === 'POST' && url.pathname === '/api/admin/products') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const product = await ensureKnownInsurers(normalizeProduct(await parseJson(req))); const existing = await db.collection('products').findOne({ id: product.id }); if (existing) return send(res, 409, { error: 'A product with this ID already exists.' }); await db.collection('products').insertOne(product); return send(res, 201, { product }); }
  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)$/);
  if (productMatch && req.method === 'PUT') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const existing = await db.collection('products').findOne({ id: productMatch[1] }); if (!existing) return send(res, 404, { error: 'Product not found.' }); const product = await ensureKnownInsurers(normalizeProduct(await parseJson(req), productMatch[1])); product.id = productMatch[1]; await db.collection('products').replaceOne({ id: productMatch[1] }, product); return send(res, 200, { product }); }
  if (productMatch && req.method === 'DELETE') { if (!sameOrigin(req)) return send(res, 403, { error: 'Invalid origin.' }); const result = await db.collection('products').deleteOne({ id: productMatch[1] }); if (result.deletedCount === 0) return send(res, 404, { error: 'Product not found.' }); return send(res, 200, { ok: true }); }
  send(res, 404, { error: 'API route not found.' });
}

async function staticFile(req, res, url) { let pathname = decodeURIComponent(url.pathname); if (pathname === '/') pathname = '/index.html'; const resolved = normalize(join(publicDir, pathname)); if (!resolved.startsWith(publicDir)) return send(res, 403, { error: 'Forbidden.' }); try { const info = await stat(resolved); if (!info.isFile()) throw Object.assign(new Error(), { code: 'ENOENT' }); const content = await readFile(resolved); res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes[extname(resolved)] || 'application/octet-stream', 'Cache-Control': extname(pathname) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' }); res.end(content); } catch (error) { if (error.code !== 'ENOENT') throw error; const content = await readFile(join(publicDir, 'index.html')); res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-cache' }); res.end(content); } }
const server = createServer(async (req, res) => { try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) await api(req, res, url); else if (req.method === 'GET' || req.method === 'HEAD') await staticFile(req, res, url); else send(res, 405, { error: 'Method not allowed.' }); } catch (error) { console.error(error); const status = error.message === 'BODY_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500; send(res, status, { error: status === 500 ? 'Something went wrong.' : 'Invalid request.' }); } });

connectDB().then(() => {
  server.listen(port, () => console.log(`Signature Broker is running on http://localhost:${port}`));
}).catch((error) => {
  console.error('Failed to connect to MongoDB:', error);
  process.exit(1);
});
