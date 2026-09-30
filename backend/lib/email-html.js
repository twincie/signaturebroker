/**
 * Branded HTML email template used by every message the platform sends.
 *
 * Design notes
 *   - Table based layout with inline styles, because that is the only markup
 *     Outlook and Gmail agree on.
 *   - The logo is embedded as a base64 data URI so the message renders even
 *     when a client blocks remote images. A vector fallback is used when the
 *     PNG cannot be read, so email can never fail because of an asset.
 *   - A plain text alternative is always generated alongside the HTML.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { offerInsurerName } from './insurers.js';

const LOGO_FILE = fileURLToPath(new URL('../../frontend/public/assets/signature-triangle-logo.png', import.meta.url));

const BRAND = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#1d4ed8',
  accentSoft: '#eff6ff',
  success: '#047857',
  successSoft: '#ecfdf5',
  warning: '#b45309',
  warningSoft: '#fffbeb',
  white: '#ffffff',
};

const COMPANY = {
  name: 'Signature Insurance Brokers Limited',
  shortName: 'Signature Brokers',
  tagline: 'Insurance brokerage & risk advisory',
  phone: '+234 817 777 0231',
  whatsapp: '+234 901 207 9823',
  email: 'signatureinsurancebrokersltd@gmail.com',
  rc: 'RC 125137',
};

let cachedLogoDataUri = null;

/**
 * The brand mark, embedded once per process.
 * Returns null when the file is missing so the caller can fall back to the
 * inline vector mark.
 */
export function brandLogoDataUri() {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri || null;
  try {
    const buffer = readFileSync(LOGO_FILE);
    cachedLogoDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    cachedLogoDataUri = '';
  }
  return cachedLogoDataUri || null;
}

/**
 * A self contained vector mark. Used when the PNG is unavailable, and in the
 * plain text alternative. Three stacked chevrons suggest a signature.
 */
export const FALLBACK_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="44" height="44" role="img" aria-label="Signature Brokers"><rect width="48" height="48" rx="12" fill="${BRAND.accent}"/><path d="M13 30l7-8 5 6 10-12" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The logo markup, preferring the real PNG and degrading to the vector. */
export function logoMarkup() {
  const dataUri = brandLogoDataUri();
  if (!dataUri) return FALLBACK_MARK;
  return `<img src="${dataUri}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;border-radius:12px" />`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function header() {
  return `<tr>
              <td style="padding:28px 32px 20px 32px;background:${BRAND.surface};border-bottom:1px solid ${BRAND.line}">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;width:44px">${logoMarkup()}</td>
                    <td style="vertical-align:middle;padding-left:14px">
                      <div style="font-family:Helvetica,Arial,sans-serif;font-size:19px;font-weight:700;letter-spacing:1.5px;color:${BRAND.ink};line-height:1.2">SIGNATURE</div>
                      <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.8px;color:${BRAND.muted};text-transform:uppercase;padding-top:3px">Insurance Brokers</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function titleBlock({ eyebrow, heading, tone = 'accent' }) {
  const color = tone === 'success' ? BRAND.success : tone === 'warning' ? BRAND.warning : BRAND.accent;
  const background = tone === 'success' ? BRAND.successSoft : tone === 'warning' ? BRAND.warningSoft : BRAND.accentSoft;
  return `<tr>
              <td style="padding:28px 32px 8px 32px">
                ${eyebrow ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};background:${background};display:inline-block;padding:6px 12px;border-radius:999px">${escapeHtml(eyebrow)}</div>` : ''}
                <h1 style="margin:16px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;color:${BRAND.ink}">${escapeHtml(heading)}</h1>
              </td>
            </tr>`;
}

function referenceBlock(reference) {
  if (!reference) return '';
  return `<tr>
              <td style="padding:0 32px 8px 32px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:12px;background:${BRAND.surface}">
                  <tr>
                    <td style="padding:14px 18px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.muted};letter-spacing:0.4px;text-transform:uppercase">Reference</td>
                    <td align="right" style="padding:14px 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${BRAND.ink};word-break:break-all">${escapeHtml(reference)}</td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function offersBlock(offersHtml) {
  if (!offersHtml) return '';
  return `<tr>
              <td style="padding:8px 32px 0 32px">
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.muted};padding-bottom:10px">Indicative pricing</div>
                ${offersHtml}
              </td>
            </tr>`;
}

function footer(note) {
  return `<tr>
              <td style="padding:26px 32px 30px 32px">
                ${note ? `<p style="margin:0 0 18px 0;padding:12px 16px;border-left:3px solid ${BRAND.line};font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.muted};background:${BRAND.surface}">${escapeHtml(note)}</p>` : ''}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BRAND.line}">
                  <tr>
                    <td style="padding-top:16px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:${BRAND.muted}">
                      <strong style="color:${BRAND.ink}">${COMPANY.name}</strong><br />
                      ${COMPANY.tagline} &middot; ${COMPANY.rc}<br />
                      <a href="tel:${COMPANY.phone.replace(/\s/g, '')}" style="color:${BRAND.accent};text-decoration:none">${COMPANY.phone}</a>
                      &nbsp;&middot;&nbsp;
                      <a href="mailto:${COMPANY.email}" style="color:${BRAND.accent};text-decoration:none">${COMPANY.email}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:${BRAND.muted}">
                  This message was sent because you requested an insurance quote through our website. We will only use your details to prepare and communicate that quote.
                </p>
              </td>
            </tr>`;
}

/** Render a single insurer offer as a styled card. */
function offerCard(offer, index) {
  const accent = index % 2 === 0 ? BRAND.accent : BRAND.success;
  const insurer = offerInsurerName(offer);
  const plan = offer.plan || '';
  // A named insurer heads the card. Without one the plan heads it, so the
  // customer never sees a placeholder insurer name.
  const heading = insurer || plan || 'Your quotation';
  const subheading = insurer ? plan : '';
  const rows = [
    ['Excess', offer.excess],
    ['Waiting period', offer.waitingPeriod],
  ].filter(([, value]) => Boolean(value));

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:12px;margin-bottom:12px;border-left:4px solid ${accent}">
            <tr>
              <td style="padding:16px 18px">
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${BRAND.ink}">${escapeHtml(heading)}</div>
                ${subheading ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.muted};padding-top:3px">${escapeHtml(subheading)}</div>` : ''}
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:${accent};padding-top:10px">${escapeHtml(offer.currency || 'NGN')} ${escapeHtml(Number(offer.premium).toLocaleString('en-NG'))}</div>
                ${
                  rows.length
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="padding-top:10px">${rows
                        .map(
                          ([label, value]) =>
                            `<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};padding-right:16px;padding-top:2px">${label}</td><td style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.body};padding-top:2px">${escapeHtml(value)}</td></tr>`
                        )
                        .join('')}</table>`
                    : ''
                }
                ${
                  offer.purchaseUrl && insurer
                    ? `<div style="padding-top:12px"><a href="${escapeHtml(offer.purchaseUrl)}" style="display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:${BRAND.white};background:${accent};padding:9px 16px;border-radius:8px;text-decoration:none">Continue with ${escapeHtml(insurer)}</a></div>`
                    : ''
                }
              </td>
            </tr>
          </table>`;
}

/**
 * Build a complete branded email.
 *
 * @param {object} options
 * @param {string} options.heading     Main headline.
 * @param {string} [options.eyebrow]   Small label above the headline.
 * @param {'accent'|'success'|'warning'} [options.tone]
 * @param {string} [options.bodyHtml]  Pre-built HTML for the main body.
 * @param {string} [options.reference] Reference shown in the reference card.
 * @param {object[]} [options.offers]  Offers to render as pricing cards.
 * @param {string} [options.note]      Small print under the body.
 * @param {boolean} [options.internal] Marks team notifications as internal.
 * @returns {{ html: string, text: string }}
 */
export function renderEmail({
  heading,
  eyebrow,
  tone = 'accent',
  bodyHtml = '',
  reference = '',
  offers = [],
  note = '',
  internal = false,
}) {
  const offersHtml = Array.isArray(offers) && offers.length ? offers.map(offerCard).join('') : '';

  const html = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.surface};-webkit-text-size-adjust:100%">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(note || heading)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${BRAND.white};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.line}">
            ${header()}
            ${titleBlock({ eyebrow, heading, tone })}
            ${referenceBlock(reference)}
            <tr>
              <td style="padding:16px 32px 0 32px">
                ${internal ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.warning};background:${BRAND.warningSoft};padding:10px 14px;border-radius:8px;margin-bottom:16px">Internal team notification</div>` : ''}
                ${bodyHtml}
              </td>
            </tr>
            ${offersBlock(offersHtml)}
            ${footer(note)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textParts = [
    `${COMPANY.name}`,
    '',
    heading,
    reference ? `Reference: ${reference}` : '',
    '',
    stripHtml(bodyHtml),
    offers.length ? '' : undefined,
    ...offers.map((offer) => {
      const insurer = offerInsurerName(offer);
      const heading = [insurer, offer.plan].filter(Boolean).join(' — ') || 'Cover';
      return `${heading}: ${offer.currency || 'NGN'} ${Number(offer.premium).toLocaleString('en-NG')}`;
    }),
    note ? `\n${note}` : '',
    '',
    `${COMPANY.tagline} · ${COMPANY.rc}`,
    `${COMPANY.phone} · ${COMPANY.email}`,
  ].filter((line) => line !== undefined);

  return {
    html,
    text: textParts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

/** Best effort HTML to plain text conversion for the alt-body. */
function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export { BRAND, COMPANY };
