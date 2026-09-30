const esc = (value) =>
  String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const bounds = (field) =>
  `${Number.isFinite(field.min) ? ` min="${field.min}"` : ''}${Number.isFinite(field.max) ? ` max="${field.max}"` : ''}`;
const modal = document.querySelector('.quote-modal');
const form = document.querySelector('#quote-form');
const productSelect = form.querySelector('select[name="product"]');
const oldMotorFields = form.querySelector('.motor-fields');
const statusEl = form.querySelector('.form-status');
const submitBtn = form.querySelector('button[type="submit"]');
const quoteDisplay = document.createElement('section');
quoteDisplay.className = 'quote-display';
quoteDisplay.hidden = true;
form.appendChild(quoteDisplay);

form.querySelector('button[type="submit"]').innerHTML = 'Get a quote <span>→</span>';
oldMotorFields.hidden = true;

const dynamicFields = document.createElement('fieldset');
dynamicFields.className = 'dynamic-quote-fields';
dynamicFields.hidden = true;
form.insertBefore(dynamicFields, oldMotorFields);

const offersPanel = document.createElement('section');
offersPanel.className = 'quote-offers';
offersPanel.hidden = true;
form.appendChild(offersPanel);

let products = [],
  countries = [];

function inputFor(field) {
  const common = `name="detail_${esc(field.key)}" ${field.required ? 'required' : ''}`;
  if (field.type === 'select')
    return `<select ${common}>${field.options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}</select>`;
  if (field.type === 'country')
    return `<select ${common}><option value="">Select country</option>${countries.map((country) => `<option value="${esc(country.code)}">${esc(country.name)}</option>`).join('')}</select>`;
  if (field.type === 'number')
    return `<input ${common} type="number"${bounds(field)} value="${esc(field.value ?? (Number.isFinite(field.min) ? field.min : ''))}">`;
  if (field.type === 'date') return `<input ${common} type="date">`;
  if (field.type === 'currency')
    return `<input ${common} inputmode="numeric" data-currency${bounds(field)} placeholder="${esc(field.placeholder || '')}">`;
  return `<input ${common} type="text" placeholder="${esc(field.placeholder || '')}">`;
}

function renderFields() {
  const product = products.find((item) => item.id === productSelect.value);
  form.querySelector('button[type="submit"]').disabled = false;
  dynamicFields.hidden = !product;
  offersPanel.hidden = true;
  if (!product) {
    dynamicFields.innerHTML = '';
    return;
  }
  dynamicFields.innerHTML = `<legend>${esc(product.name)}</legend><p class="product-description">${esc(product.description)}</p><div class="dynamic-field-grid">${product.fields.map((field) => `<label>${esc(field.label)}${inputFor(field)}</label>`).join('')}</div>`;
  dynamicFields.querySelectorAll('[data-currency]').forEach((input) =>
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 12);
      input.value = digits ? Number(digits).toLocaleString('en-NG') : '';
    })
  );
}

const productIcons = [
  ['motor', '🚙'],
  ['vehicle', '🚙'],
  ['health', '♡'],
  ['medical', '♡'],
  ['travel', '✈'],
  ['life', '♡'],
  ['property', '🏠'],
];
const productCta = {
  motor: 'Get a motor quote',
  vehicle: 'Get a vehicle quote',
  health: 'Explore health cover',
  medical: 'Explore health cover',
  travel: 'Get travel cover',
  life: 'Explore life cover',
  property: 'Get property cover',
};

function iconFor(product) {
  const haystack = `${product.id} ${product.name}`.toLowerCase();
  return (productIcons.find(([keyword]) => haystack.includes(keyword)) || [null, '🛡'])[1];
}

function ctaFor(product) {
  const haystack = `${product.id} ${product.name}`.toLowerCase();
  const match = Object.keys(productCta).find((keyword) => haystack.includes(keyword));
  return productCta[match] || 'Start your quote';
}

function renderProductCards() {
  const grid = document.querySelector('.product-grid');
  if (!grid || !products.length) return;
  grid.innerHTML = products
    .map((product, index) => {
      const points = (product.benefits || [])
        .slice(0, 2)
        .map((benefit) => `<li>${esc(benefit)}</li>`)
        .join('');
      return `<article class="product-card${index === 0 ? ' featured' : ''}">${index === 0 ? '<span class="tag">Most popular</span>' : ''}<div class="product-icon">${iconFor(product)}</div><h3>${esc(product.name)}</h3><p>${esc(product.description || 'Tell us a few details and we will prepare a quote from the rates currently configured for this product.')}</p>${points ? `<ul>${points}</ul>` : ''}<button class="card-link quote-trigger" data-product-id="${esc(product.id)}" data-product="${esc(product.name)}">${esc(ctaFor(product))} <span>→</span></button></article>`;
    })
    .join('');
}

async function renderPartnerLogos() {
  const holder = document.querySelector('.partner-logos');
  if (!holder) return;
  try {
    const response = await fetch('/api/insurers');
    if (!response.ok) return;
    const result = await response.json();
    const insurers = (result.insurers || []).filter((insurer) => insurer.name);
    if (!insurers.length) return;
    holder.innerHTML = insurers
      .map((insurer) =>
        insurer.logo ? `<img src="${esc(insurer.logo)}" alt="${esc(insurer.name)}" loading="lazy" />` : `<span>${esc(insurer.name)}</span>`
      )
      .join('');
  } catch {
    /* keep the static partner list */
  }
}

async function loadProducts() {
  productSelect.innerHTML = '<option value="">Loading products…</option>';
  try {
    const [response, countryResponse] = await Promise.all([fetch('/api/products'), fetch('/api/countries')]);
    const [result, countryResult] = await Promise.all([response.json(), countryResponse.json()]);
    products = result.products || [];
    countries = countryResult.countries || [];
    productSelect.innerHTML = `<option value="">Select Product</option>${products.map((product) => `<option value="${esc(product.id)}">${esc(product.name)}</option>`).join('')}`;
    renderProductCards();
    renderPartnerLogos();
  } catch {
    productSelect.innerHTML = '<option value="">Products unavailable</option>';
  }
}

productSelect.addEventListener('change', renderFields);

function matchProduct(button) {
  const id = button.dataset.productId;
  if (id && products.some((product) => product.id === id)) return products.find((product) => product.id === id);
  const words = (button.dataset.product || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2);
  if (!words.length) return null;
  return (
    products.find((product) => {
      const name = product.name.toLowerCase();
      const productId = product.id.toLowerCase();
      return words.every(
        (word) => name.includes(word) || productId.includes(word) || name.split(/\s+/).some((part) => part.startsWith(word))
      );
    }) || null
  );
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.quote-trigger');
  if (!button) return;
  const match = matchProduct(button);
  if (match) productSelect.value = match.id;
  renderFields();
  modal.showModal();
  document.body.classList.add('no-scroll');
});

document.querySelector('.modal-close').addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => {
  if (event.target === modal) modal.close();
});
modal.addEventListener('close', () => document.body.classList.remove('no-scroll'));

function renderQuoteConfirmation(result) {
  const message =
    result.message ||
    (result.emailStatus === 'awaiting-admin'
      ? 'Your request will be reviewed and we will send you a response.'
      : 'Your quote request has been received.');
  offersPanel.hidden = false;
  offersPanel.innerHTML = `<div class="offer-pending"><strong>Quote request received</strong><p>Reference ${esc(result.reference)}</p><span>${esc(message)}</span></div>`;
  quoteDisplay.hidden = false;
  quoteDisplay.innerHTML = '';
  quoteDisplay.appendChild(offersPanel);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const details = {};
  for (const [key, value] of data.entries()) if (key.startsWith('detail_')) details[key.slice(7)] = value;
  statusEl.classList.remove('error');
  statusEl.textContent = 'Checking available insurers…';
  submitBtn.disabled = true;
  offersPanel.hidden = true;
  quoteDisplay.hidden = true;
  try {
    const response = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: data.get('product'),
        name: data.get('name'),
        phone: data.get('phone'),
        email: data.get('email'),
        website: data.get('website'),
        consent: data.get('consent') === 'on',
        details,
      }),
    });
    const result = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(result.error || 'We could not retrieve a quote.');
    renderQuoteConfirmation(result);
    statusEl.textContent = result.message || 'Your quote request has been saved.';
  } catch (error) {
    statusEl.classList.add('error');
    statusEl.textContent = `${error.message} Please check the details and try again.`;
  } finally {
    submitBtn.disabled = false;
  }
});

const header = document.querySelector('.site-header');
const menu = document.querySelector('.menu-button');
menu.addEventListener('click', () => {
  const open = header.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.desktop-nav a').forEach((link) => link.addEventListener('click', () => header.classList.remove('open')));
document.querySelectorAll('details').forEach((item) =>
  item.addEventListener('toggle', () => {
    if (item.open)
      document.querySelectorAll('details').forEach((other) => {
        if (other !== item) other.open = false;
      });
  })
);

loadProducts();
