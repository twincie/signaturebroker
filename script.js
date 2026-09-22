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

let products = [], countries = [];

function inputFor(field) {
  const common = `name="detail_${field.key}" ${field.required ? 'required' : ''}`;
  if (field.type === 'select') return `<select ${common}>${field.options.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}</select>`;
  if (field.type === 'country') return `<select ${common}><option value="">Select country</option>${countries.map((country) => `<option value="${country.code}">${country.name}</option>`).join('')}</select>`;
  if (field.type === 'number') return `<input ${common} type="number" min="${field.min}" max="${field.max}" value="${field.value || field.min || ''}">`;
  if (field.type === 'date') return `<input ${common} type="date">`;
  if (field.type === 'currency') return `<input ${common} inputmode="numeric" data-currency min="${field.min}" max="${field.max}" placeholder="${field.placeholder || ''}">`;
  return `<input ${common} type="text" placeholder="${field.placeholder || ''}">`;
}

function renderFields() {
  const product = products.find((item) => item.id === productSelect.value);
  form.querySelector('button[type="submit"]').disabled = false;
  dynamicFields.hidden = !product;
  offersPanel.hidden = true;
  if (!product) { dynamicFields.innerHTML = ''; return; }
  dynamicFields.innerHTML = `<legend>${product.name}</legend><p class="product-description">${product.description}</p><div class="dynamic-field-grid">${product.fields.map((field) => `<label>${field.label}${inputFor(field)}</label>`).join('')}</div>`;
  dynamicFields.querySelectorAll('[data-currency]').forEach((input) => input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 12);
    input.value = digits ? Number(digits).toLocaleString('en-NG') : '';
  }));
}

async function loadProducts() {
  productSelect.innerHTML = '<option value="">Loading products…</option>';
  try {
    const [response, countryResponse] = await Promise.all([fetch('/api/products'), fetch('/api/countries')]);
    const [result, countryResult] = await Promise.all([response.json(), countryResponse.json()]);
    products = result.products || [];
    countries = countryResult.countries || [];
    productSelect.innerHTML = `<option value="">Select Product</option>${products.map((product) => `<option value="${product.id}">${product.name}</option>`).join('')}`;
  } catch {
    productSelect.innerHTML = '<option value="">Products unavailable</option>';
  }
}

productSelect.addEventListener('change', renderFields);

document.querySelectorAll('.quote-trigger').forEach((button) => button.addEventListener('click', () => {
  const requested = (button.dataset.product || '').toLowerCase();
  const match = products.find((product) => requested.includes('motor') ? product.id === 'motor-comprehensive' : product.name.toLowerCase().includes(requested.split(' ')[0]));
  productSelect.value = match?.id || '';
  renderFields();
  modal.showModal();
  document.body.classList.add('no-scroll');
}));

document.querySelector('.modal-close').addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
modal.addEventListener('close', () => document.body.classList.remove('no-scroll'));

function renderOffers(result) {
  offersPanel.hidden = false;
  if (!result.offers?.length) {
    offersPanel.innerHTML = `<div class="offer-pending"><strong>Quote request received</strong><p>Reference ${result.reference}</p><span>${result.message || 'Our team will review your request and send the quote to your email.'}</span></div>`;
    quoteDisplay.hidden = false;
    quoteDisplay.innerHTML = '<h3>Your Quote</h3>';
    quoteDisplay.appendChild(offersPanel);
    return;
  }
  offersPanel.innerHTML = `<h3>Your quote</h3><p class="quote-reference">Reference ${result.reference}</p><p class="quote-reference">${result.message || 'Your quote request has been saved.'}</p><div class="offer-list">${result.offers.map((offer) => `<article class="offer-card"><div><strong>${offer.plan}</strong></div><b>${new Intl.NumberFormat('en-NG', { style: 'currency', currency: offer.currency || 'NGN', maximumFractionDigits: 0 }).format(offer.premium)}</b>${offer.benefits.length ? `<ul>${offer.benefits.map((benefit) => `<li>${benefit}</li>`).join('')}</ul>` : ''}</article>`).join('')}</div>`;
  quoteDisplay.hidden = false;
  quoteDisplay.innerHTML = '<h3>Your Quote</h3>';
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
    const response = await fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: data.get('product'), name: data.get('name'), phone: data.get('phone'), email: data.get('email'), website: data.get('website'), consent: data.get('consent') === 'on', details }) });
    const result = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(result.error || 'We could not retrieve a quote.');
    renderOffers(result);
    statusEl.textContent = result.message || 'Your quote request has been saved.';
  } catch (error) {
    statusEl.classList.add('error');
    statusEl.textContent = `${error.message} Please check the details and try again.`;
  } finally { submitBtn.disabled = false; }
});

const header = document.querySelector('.site-header');
const menu = document.querySelector('.menu-button');
menu.addEventListener('click', () => { const open = header.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
document.querySelectorAll('.desktop-nav a').forEach((link) => link.addEventListener('click', () => header.classList.remove('open')));
document.querySelectorAll('details').forEach((item) => item.addEventListener('toggle', () => { if (item.open) document.querySelectorAll('details').forEach((other) => { if (other !== item) other.open = false; }); }));

loadProducts();
