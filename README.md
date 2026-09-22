# Signature Broker

A lightweight insurance marketplace with a responsive Vite frontend and a dependency-free Node.js API.

## Run locally

```bash
npm install
npm run build
ADMIN_API_KEY="use-a-long-random-secret" npm start
```

Open `http://localhost:3000`.

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

## Admin dashboard

Open `http://localhost:3000/admin.html`. Local defaults are username `insurance` and password `insurance`. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before production.

The dashboard manages products, customer quote fields, benefits, exclusions, insurer rate cards, fixed prices, percentage pricing, age-band tables, risk loadings, excesses, waiting periods and rate validity dates. Changes are stored in `data/products.json` and immediately drive the public quote form and local quote engine.

## API

- `GET /api/health` — service health
- `GET /api/products` — supported insurance products
- `GET /api/insurers` — partner integration status
- `POST /api/quotes` — validate product-specific details, retrieve live partner offers, and save the request
- `GET /api/admin/quotes` — list requests; requires `Authorization: Bearer <ADMIN_API_KEY>`

Products, countries, insurers and quote requests are stored in MongoDB. Set `MONGODB_URI` before starting the server. Quote requests record team-notification delivery, customer-email delivery attempts, failures and closure status.

## Email delivery

Set `RESEND_API_KEY`, `QUOTE_EMAIL_FROM`, and `QUOTE_EMAIL_TO` to email a confirmation to the customer and notify the brokerage team. `QUOTE_EMAIL_FROM` must use a domain verified with Resend. If email is not configured or temporarily fails, the lead is still saved and the API reports `emailSent: false` so it is not lost.

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

Without partner credentials, requests are safely stored with `awaiting-provider` status and the interface does not invent a premium.
