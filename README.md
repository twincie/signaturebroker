# Signature Broker

A lightweight insurance marketplace with a responsive Vite frontend and a dependency-free Node.js API.

## Project structure

```
backend/
  server.js            Express-less API, static hosting, quote workflow, admin routes
  lib/
    pricing.js         Fixed, percentage and age-band rate calculation
    email-template.js  Editable subject/body templates and the acknowledgement rule
    email-html.js      Branded HTML shell, offer cards and the plain text alternative
    logger.js          Structured logging, redaction, masking and timings
frontend/
  index.html           Marketing site and product cards
  admin.html           Product, rate and email configuration dashboard
  script.js            Public quote form and API-driven product rendering
  admin.js             Admin dashboard logic
  public/assets/       Images copied verbatim into the build (email logo source)
shared/
  format.js            Answer formatting used by both the dashboard and emails
api/index.js           Vercel serverless entry point
scripts/               Backup, restore and migration tooling
test/                  Unit and integration tests
```

`shared/format.js` lives outside both apps because the admin dashboard and the
email templates render quote answers with identical formatting.

## Run locally

```bash
npm install
npm run build
ADMIN_API_KEY="use-a-long-random-secret" npm start
```

Open `http://localhost:3000`.

## Commands

| Command                        | Purpose                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `npm start`                    | Run the API and serve `dist/`                                                        |
| `npm run dev`                  | Run the API and the Vite dev server together                                         |
| `npm run dev:api`              | Run only the API, restarting it on change                                            |
| `npm run dev:web`              | Run only the Vite dev server, expecting an API on port 3000                          |
| `npm run build`                | Build the frontend into `dist/`                                                      |
| `npm test`                     | Run the unit and integration tests                                                   |
| `npm run lint`                 | Check formatting with Prettier                                                       |
| `npm run format`               | Reformat the codebase with Prettier                                                  |
| `npm run preview:email`        | Render every outgoing email to `preview/email-preview.html` without sending anything |
| `npm run backup`               | Write a timestamped snapshot to `backups/`                                           |
| `npm run restore`              | Restore from a backup directory                                                      |
| `npm run migrate:email-config` | Copy legacy email settings into `product.emailConfig`                                |

`npm run dev` starts both halves and prefixes their output as `[api]` and
`[web]`. Vite waits for the API to report that it is listening before it starts,
because the API connects to MongoDB before it binds and the browser cannot reach
anything until then. Stop both with `Ctrl+C`.

## Deploy

This project can be deployed in two ways:

- Static frontend plus serverless API, for Vercel.
- Long-running Node web service, for Render, Railway, Fly.io, DigitalOcean App Platform, Heroku-style hosts, VPS, or Docker.

Required production environment variables:

```bash
NODE_ENV=production
ADMIN_USERNAME=insurance
ADMIN_PASSWORD=replace-this-before-production
ADMIN_API_KEY=replace-with-a-long-random-secret
MONGODB_URI=mongodb+srv://...
RESEND_API_KEY=re_...
QUOTE_EMAIL_FROM="Signature Insurance Brokers Limited <quotes@your-domain.com>"
QUOTE_EMAIL_TO=signatureinsurancebrokersltd@gmail.com
QUOTE_PROVIDER_URL=
QUOTE_PROVIDER_API_KEY=
```

`QUOTE_PROVIDER_URL` and `QUOTE_PROVIDER_API_KEY` are optional unless you are connecting a live quote provider. Products with configured rates can still calculate quotes without them.

### Vercel

1. Push this repository to GitHub.
2. In Vercel, import the GitHub repository.
3. Use the default framework settings. The included `vercel.json` sets:
   - Build command: `npm run build`
   - Output directory: `dist`
   - API rewrite: `/api/*` to the serverless adapter in `api/index.js`
4. Add the production environment variables in Vercel Project Settings.
5. Deploy.

Important: use MongoDB Atlas or another publicly reachable MongoDB connection string. A local `mongodb://localhost...` database will not work on Vercel.

### Render, Railway, Heroku-Style Hosts

Use:

```bash
npm install
npm run build
npm start
```

The server reads the platform-provided `PORT` automatically. `render.yaml` and `Procfile` are included for platforms that support them.

### Docker

```bash
docker build -t signaturebroker .
docker run --env-file .env -p 3000:3000 signaturebroker
```

For production, set the same environment variables in your host dashboard instead of copying `.env` to the server.

## Logging

Every request, provider call, pricing run, database change and email is logged
through `backend/lib/logger.js` with a timestamp, a level, a scope and a
structured context.

```bash
LOG_LEVEL=debug npm start   # trace everything
LOG_LEVEL=info npm start    # default: requests, emails, errors
LOG_LEVEL=warn npm start    # only problems
```

`NO_COLOR=1` strips ANSI codes for log aggregators.

Credentials are redacted before a line is written: any context key matching
`password`, `secret`, `token`, `authorization`, `apiKey`, `mongoUri` and similar
is replaced with `[redacted]`. Customer emails and phone numbers are masked
(`a***example.com`, `***5678`) and repeat requests are correlated with a short
non-reversible fingerprint so you can count distinct customers without storing
their addresses.

Note that `debug` logging includes rendered email subjects, which may contain a
customer's name, and full pricing detail. Leave `LOG_LEVEL` at `info` on any
host whose logs are not access-controlled.

## Admin dashboard

Open `http://localhost:3000/admin.html`.

### Reviewing and sending a customer's email

Every lead has a **Preview and send** button that opens one review window. It
renders the exact message the customer receives — their real name, answers and
premium, plus your message — in a sandboxed frame, and sends nothing on its own.

The message box lives inside that window. Type in it and the email re-renders
shortly after you stop, so you can read the finished wording before you commit.
**Send email** then delivers exactly what you were just reading; if the product
requires a message, the button stays disabled until you write one.

Once a lead is sent it becomes closed, the box turns read only, and reopening it
shows the message it actually went out with and when, rather than a fresh draft.

Previewing never changes a lead's status and never records a send attempt. Local defaults are username `insurance` and password `insurance`. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before production.

The dashboard manages products, customer quote fields, benefits, exclusions, insurer rate cards, fixed prices, percentage pricing, age-band tables, risk loadings, excesses, waiting periods and rate validity dates. All changes are stored in MongoDB and immediately drive the public quote form and local quote engine.

The **Emails** tab holds the per-product delivery workflow, and the quote list shows every customer answer alongside delivery status.

## API

- `GET /api/health` — service health
- `GET /api/products` — supported insurance products (never exposes `rates` or `emailConfig`)
- `GET /api/countries` — active country reference data
- `GET /api/insurers` — active partner insurers (never exposes `contactEmail`)
- `POST /api/quotes` — validate product-specific details, retrieve live partner offers, and save the request
- `GET /api/admin/quotes` — list requests; requires `Authorization: Bearer <ADMIN_API_KEY>`
- `POST /api/admin/quotes/:reference/send-email` — send the priced quote to the customer and close the request
- `POST /api/admin/quotes/:reference/close` — close a request after manual contact

Products, countries, insurers and quote requests are stored in MongoDB. Set `MONGODB_URI` before starting the server. Quote requests record team-notification delivery, customer-email delivery attempts, failures and closure status.

`POST /api/quotes` always returns `202` with a reference, status and message. It never returns calculated premiums, so pricing stays server-side.

## Quote statuses

`received` → `quoted` / `no-offers` / `awaiting-rates` / `provider-error` → `acknowledged` or `closed`.

If immediate delivery is switched off, the request is held at `awaiting-review` until an administrator sends the quote or closes it. If either email fails, the status becomes `email-failed` and the lead is still saved.

## Email delivery

Set `RESEND_API_KEY`, `QUOTE_EMAIL_FROM`, and `QUOTE_EMAIL_TO`. `QUOTE_EMAIL_FROM` must use a domain verified with Resend.

Each product carries its own `emailConfig`:

| Setting                            | Behaviour                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `sendEmailImmediately`             | Email the customer without waiting for review                                             |
| `immediateEmailMode`               | `acknowledgement` (never includes a premium) or `quote` (includes the calculated premium) |
| `notifyTeam`                       | Send the internal notification email                                                      |
| `requireAdminMessage`              | Block the admin send until a message is written                                           |
| `customerSubject` / `customerBody` | Customer email template                                                                   |
| `teamSubject` / `teamBody`         | Team notification template                                                                |

Leave a subject or body empty to use the built-in default. These placeholders are available in all four templates:

`{{name}}`, `{{email}}`, `{{phone}}`, `{{reference}}`, `{{product}}`, `{{requestedDate}}`, `{{adminMessage}}`, `{{details}}`, `{{offers}}`

`{{details}}` lists every answer the customer gave, using the product's own field labels. `{{offers}}` renders the calculated premiums, and resolves to nothing at all when no premium could be calculated — an acknowledgement never exposes a price.

The acknowledgement guarantee is enforced inside `buildMessage()`, the single place that composes every outgoing message, so it holds no matter which template an administrator saves. Leaving `{{offers}}` in an acknowledgement template will not leak a price.

`{{adminMessage}}` is what the administrator types in the preview window before sending. If a template does not use the placeholder, the message is appended as its own "A message from your broker" block, so a message written for the customer always reaches them.

### Email design

`backend/lib/email-html.js` wraps every message in the same table-based,
inline-styled shell so it renders in Outlook and Gmail:

- The logo from `frontend/public/assets/` is embedded as a base64 data URI, with
  an inline vector fallback, so no image can be blocked or go missing.
- `offers` renders as pricing cards showing the insurer, plan, formatted
  premium, excess, waiting period and a purchase link.
- Team notifications are visually marked as internal and render label/value
  answers as a table for fast scanning.
- Every message also carries a plain text alternative for clients that block
  HTML.

Run `npm run preview:email` and open `preview/email-preview.html` to review the
customer acknowledgement, the customer quotation and the team notification side
by side without sending anything.

If email is not configured or temporarily fails, the lead is still saved and the API reports `emailStatus` and `teamNotificationStatus` so it is not lost.

## Backups and tests

`npm run backup` writes a timestamped EJSON snapshot of every collection to `backups/`. Restore one with:

```
node scripts/backup.js restore backups/<timestamp>
```

Restoring is destructive — it deletes the current contents of each collection first, so always take a fresh backup beforehand.

`npm test` runs the suite with Node's built-in runner. It needs no network access except for the quote-flow tests, which run against a separate `signature_test` database with a mocked email provider, so production data and real email delivery are never touched.

Pricing is verified against the stored premiums in the most recent backup, so a refactor that changes a calculated price fails the suite.

## Live quote provider

The UI is driven entirely by `GET /api/products`. Each product describes its required fields, accepted options and validation limits, so adding or changing an insurer product does not require rebuilding the form.

Set `QUOTE_PROVIDER_URL` and `QUOTE_PROVIDER_API_KEY` to connect a licensed insurer or aggregator. The backend sends `POST <QUOTE_PROVIDER_URL>/quotes` with the selected `productId`, customer details and product-specific fields. It expects:

```json
{
  "offers": [
    {
      "id": "offer-123",
      "insurer": "Licensed Insurer",
      "plan": "Plan name",
      "premium": 500000,
      "currency": "NGN",
      "benefits": ["Benefit one"],
      "purchaseUrl": "https://insurer.example/checkout/offer-123"
    }
  ]
}
```

Without partner credentials, quotes are calculated from each product's own configured rates. A product with no usable rate is stored as `awaiting-rates` and the interface does not invent a premium.
