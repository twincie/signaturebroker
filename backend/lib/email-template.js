/**
 * Email copy and message composition.
 *
 * The admin can still customise the subject and body as plain text with
 * `{{placeholder}}` tokens. `buildMessage` renders that text and then wraps it
 * in the branded HTML shell from `email-html.js`, so every outgoing message
 * looks the same and carries the logo, reference card, pricing cards and
 * footer.
 */

import { COMPANY, renderEmail } from './email-html.js';
import { offerInsurerName } from './insurers.js';
import { createLogger } from './logger.js';

const log = createLogger('email');

export const DEFAULT_CUSTOMER_SUBJECT = 'We have received your {{product}} request — {{reference}}';
export const DEFAULT_QUOTE_SUBJECT = 'Your {{product}} quotation — {{reference}}';
export const DEFAULT_CUSTOMER_ACKNOWLEDGEMENT = `Hello {{name}},

Thank you for contacting {{companyName}} about {{product}}.

We have received your request and saved it under reference {{reference}}. A member of our team is reviewing the details you provided and will come back to you with your quotation.

You do not need to do anything else right now. If we need any further information we will contact you on {{phone}}.`;

export const DEFAULT_CUSTOMER_QUOTE = `Hello {{name}},

Thank you for requesting a quote from {{companyName}}. Your quotation is shown below.

If you would like to proceed, reply to this email or call us on {{companyPhone}}. If it is quicker, message us on WhatsApp on {{companyWhatsapp}} and we will guide you through the next steps.`;

export const DEFAULT_TEAM_SUBJECT = 'New {{product}} request — {{reference}}';
export const DEFAULT_TEAM = `New quote request

Reference: {{reference}}
Product: {{product}}
Received: {{requestedDate}}

Customer
Name: {{name}}
Email: {{email}}
Phone: {{phone}}

Answers
{{details}}

Indicative pricing
{{offers}}`;

const MESSAGES = {
  acknowledgement: {
    subject: DEFAULT_CUSTOMER_SUBJECT,
    body: DEFAULT_CUSTOMER_ACKNOWLEDGEMENT,
    heading: 'We have your request',
    eyebrow: 'Request received',
    tone: 'accent',
  },
  quote: {
    subject: DEFAULT_QUOTE_SUBJECT,
    body: DEFAULT_CUSTOMER_QUOTE,
    heading: 'Your quotation is ready',
    eyebrow: 'Quotation',
    tone: 'success',
  },
  team: {
    subject: DEFAULT_TEAM_SUBJECT,
    body: DEFAULT_TEAM,
    heading: 'New quote request',
    eyebrow: 'New lead',
    tone: 'warning',
  },
};

/** Placeholders offered to administrators in the dashboard. */
export function knownPlaceholders() {
  return [
    'name',
    'email',
    'phone',
    'reference',
    'product',
    'requestedDate',
    'adminMessage',
    'details',
    'offers',
    'companyName',
    'companyPhone',
    'companyWhatsapp',
  ];
}

/**
 * Replace `{{placeholder}}` tokens. Unknown tokens are dropped and logged so a
 * typo in the dashboard is visible in the logs instead of silently blanking.
 */
export function renderTemplate(template, context, label = 'template') {
  if (typeof template !== 'string' || !template) return '';
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, key) => {
    if (!(key in context)) {
      log.warn('template referenced an unknown placeholder', { label, placeholder: key });
      return '';
    }
    const value = context[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/** Plain text summary of the calculated offers. */
export function offersText(quote) {
  const offers = quote?.offers || [];
  if (!offers.length) return 'No premium could be calculated from the configured rates for this request.';
  return offers
    .map((offer) => {
      const insurer = offerInsurerName(offer);
      // Credit the insurer only when it is really named; a default rate leads
      // with the plan instead of a placeholder insurer name.
      const heading = [insurer, offer.plan].filter(Boolean).join(' — ') || 'Cover';
      const lines = [`${heading}: ${offer.currency || 'NGN'} ${Number(offer.premium).toLocaleString()}`];
      if (offer.excess) lines.push(`  Excess: ${offer.excess}`);
      if (offer.waitingPeriod) lines.push(`  Waiting period: ${offer.waitingPeriod}`);
      if (offer.purchaseUrl) lines.push(`  Purchase: ${offer.purchaseUrl}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/** Small print shown under the body of every message. */
function disclaimer(kind) {
  if (kind === 'team') return 'Internal notification. Contact the customer using the details above.';
  return 'A quotation is an estimate until the insurer confirms your details, accepts payment and issues the policy.';
}

/**
 * Compose a complete message for one of the three delivery kinds.
 *
 * @param {'acknowledgement'|'quote'|'team'} kind
 * @param {object} context     Placeholder values from `buildEmailContext`.
 * @param {object} quote       The stored quote, used for structured offers.
 * @param {object} settings    Normalised `emailConfig` for the product.
 * @param {string} [adminMessage]
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildMessage(kind, context, quote, settings = {}, adminMessage = '') {
  const preset = MESSAGES[kind] || MESSAGES.acknowledgement;

  const subjectTemplate = kind === 'team' ? settings.teamSubject || preset.subject : settings.customerSubject || preset.subject;
  const bodyTemplate = kind === 'team' ? settings.teamBody || preset.body : settings.customerBody || preset.body;

  // The administrator message has a single source of truth: the argument.
  // Injecting it into the context means `{{adminMessage}}` in a custom
  // template and the auto-appended block can never disagree.
  const message = String(adminMessage || '').trim();
  // The company details come from COMPANY so the copy can never quote a stale
  // or contradictory phone number, and so a caller that omits them still gets
  // a complete email rather than a blank gap.
  let safeContext = {
    companyName: COMPANY.name,
    companyPhone: COMPANY.phone,
    companyWhatsapp: COMPANY.whatsapp,
    ...context,
  };
  if (message) safeContext = { ...safeContext, adminMessage: message };

  // An acknowledgement must never expose a premium. This is enforced here, in
  // the one place that knows the rule, so it cannot be bypassed by a caller
  // that forgets to clear the placeholder or by an administrator who leaves
  // `{{offers}}` in the acknowledgement template.
  const isAcknowledgement = kind === 'acknowledgement';
  if (isAcknowledgement) {
    safeContext = { ...safeContext, offers: '' };
    if (context.offers)
      log.warn('offers were withheld from an acknowledgement to avoid exposing a premium', { reference: context.reference });
  }

  const subject = renderTemplate(subjectTemplate, safeContext, `${kind}.subject`);
  let bodyText = renderTemplate(bodyTemplate, safeContext, `${kind}.body`);

  // The administrator writes a message "for the customer" in the dashboard, so
  // it must reach them. If their template already uses the placeholder we
  // leave it alone; otherwise we append it as its own block.
  if (message && !bodyTemplate.includes('{{adminMessage}}')) {
    bodyText = `${bodyText}\n\nA message from your broker\n${message}`;
    log.debug('appended the administrator message because the template omitted the placeholder', { kind });
  }

  const offers = isAcknowledgement ? [] : quote?.offers || [];

  const { html, text } = renderEmail({
    heading: preset.heading,
    eyebrow: preset.eyebrow,
    tone: preset.tone,
    bodyHtml: renderBodyHtml(bodyText, kind),
    reference: safeContext.reference,
    offers,
    note: disclaimer(kind),
    internal: kind === 'team',
  });

  log.debug('composed message', {
    kind,
    subject,
    hasOffers: offers.length > 0,
    offers: offers.length,
    customBody: bodyTemplate !== preset.body,
    hasAdminMessage: Boolean(message),
    htmlBytes: html.length,
  });

  return { subject, html, text };
}

/** Convert the rendered plain text body into safe HTML paragraphs. */
function renderBodyHtml(value, kind) {
  if (kind === 'team') {
    // The internal template is label/value oriented, so give it a definition
    // list instead of paragraphs to make it much easier to scan.
    const sections = [];
    let current = null;
    for (const rawLine of String(value || '').split('\n')) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      const isHeading = /^[A-Z][A-Za-z ]*$/.test(line.trim());
      if (isHeading) {
        current = [];
        sections.push({ heading: line.trim(), lines: current });
        continue;
      }
      // Content before the first heading still belongs in the email, so it is
      // collected under an untitled section. Dropping it would silently lose
      // whatever an administrator wrote.
      if (!current) {
        current = [];
        sections.push({ heading: '', lines: current });
      }
      current.push(line);
    }

    return sections
      .map((section) => {
        const rows = section.lines
          .map((line) => {
            const match = line.match(/^([^:]{2,40}):\s*(.*)$/);
            const label = match ? match[1].trim() : '';
            const value = match ? match[2].trim() : line.trim();
            // A line with no "label:" prefix is prose rather than a field, so it
            // spans the full width instead of sitting in a narrow value column.
            if (!label) {
              return `<tr>
                        <td colspan="2" style="padding:5px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;word-break:break-word">${escapeHtml(value)}</td>
                      </tr>`;
            }
            return `<tr>
                      <td style="padding:5px 16px 5px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
                      <td style="padding:5px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;font-weight:600;word-break:break-word">${escapeHtml(value)}</td>
                    </tr>`;
          })
          .join('');
        const heading = section.heading
          ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#334155;padding-bottom:6px">${escapeHtml(section.heading)}</div>`
          : '';
        return `<div style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;background:#f8fafc">
                  ${heading}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
                </div>`;
      })
      .join('');
  }

  return textToParagraphs(value);
}

function textToParagraphs(value) {
  return String(value || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const trimmed = block.trim();
      const heading = /^[A-Z][A-Za-z ]{2,40}$/.test(trimmed);
      if (heading) {
        return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#64748b;padding:6px 0 4px 0">${escapeHtml(trimmed)}</div>`;
      }
      return `<p style="margin:0 0 14px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export { MESSAGES };
