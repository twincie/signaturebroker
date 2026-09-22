# Signature Broker

A lightweight insurance marketplace with a responsive Vite frontend and a dependency-free Node.js API.

## Run locally

```bash
npm install
npm run build
ADMIN_API_KEY="use-a-long-random-secret" npm start
```

Open `http://localhost:3000`.

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
