import './admin-extra.css';
import { formatDetails } from '../shared/format.js';
const esc = (value) =>
  String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const loginView = document.querySelector('#login-view'),
  dashboard = document.querySelector('#dashboard-view'),
  dialog = document.querySelector('#product-dialog'),
  form = document.querySelector('#product-form'),
  list = document.querySelector('#product-list');
let products = [],
  insurers = [],
  countries = [],
  editingId = null;
loginView.style.display = 'grid';
dashboard.style.display = 'none';
const emailModeField = form.querySelector('.mode-field');
function syncEmailMode() {
  emailModeField.hidden = !form.elements.sendEmailImmediately.checked;
}
form.elements.sendEmailImmediately.addEventListener('change', syncEmailMode);
const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};
function showDashboard() {
  loginView.hidden = true;
  loginView.style.display = 'none';
  dashboard.hidden = false;
  dashboard.style.display = 'grid';
  loadAdminData();
}
async function checkSession() {
  try {
    await api('/api/admin/me');
    showDashboard();
  } catch {
    loginView.hidden = false;
  }
}
document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = event.currentTarget.querySelector('.status'),
    data = new FormData(event.currentTarget);
  try {
    status.textContent = 'Signing in…';
    status.classList.remove('error');
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
    showDashboard();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  }
});
document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});
async function loadProducts() {
  const data = await api('/api/admin/products');
  products = data.products;
  renderProducts();
}
async function loadAdminData() {
  const [productData, insurerData, countryData] = await Promise.all([
    api('/api/admin/products'),
    api('/api/admin/insurers'),
    api('/api/admin/countries'),
  ]);
  products = productData.products;
  insurers = insurerData.insurers;
  countries = countryData.countries;
  renderProducts();
  renderInsurers();
  renderCountries();
}
function renderProducts() {
  const query = document.querySelector('#search').value.toLowerCase();
  const visible = products.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(query));
  document.querySelector('#product-count').textContent = `${visible.length} product${visible.length === 1 ? '' : 's'}`;
  list.innerHTML =
    visible
      .map(
        (p) =>
          `<article class="product-item"><div><h3>${esc(p.name)}</h3><p>${esc(p.description || 'No description')}</p></div><div class="metric"><b>${p.fields?.length || 0}</b>fields</div><div class="metric"><b>${p.rates?.length || 0}</b>rates</div><span class="badge ${p.active ? '' : 'off'}">${p.active ? 'Active' : 'Inactive'}</span><button class="edit" data-id="${esc(p.id)}">Edit</button></article>`
      )
      .join('') || '<p>No products found.</p>';
  list
    .querySelectorAll('.edit')
    .forEach((button) => button.addEventListener('click', () => openProduct(products.find((p) => p.id === button.dataset.id))));
}
document.querySelector('#search').addEventListener('input', renderProducts);
document.querySelectorAll('.tab').forEach((button) =>
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab,.tab-panel').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelector(`[data-panel="${button.dataset.tab}"]`).classList.add('active');
  })
);
// Each close button belongs to the dialog it sits in, so resolve the parent
// rather than always closing the product dialog.
document.querySelectorAll('dialog .close').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
function lines(value) {
  return (value || []).join('\n');
}
function addField(field = {}) {
  const row = document.querySelector('#field-template').content.cloneNode(true).firstElementChild;
  for (const input of row.querySelectorAll('[data-key]')) {
    const key = input.dataset.key;
    if (key === 'required') input.checked = Boolean(field[key]);
    else if (key === 'options') input.value = (field.options || []).map((option) => `${option.value} | ${option.label}`).join('\n');
    else input.value = field[key] || '';
  }
  row.querySelector('.remove').addEventListener('click', () => row.remove());
  row.querySelector('[data-key="type"]').addEventListener('change', () => syncField(row));
  document.querySelector('#fields-list').appendChild(row);
  syncField(row);
}
function syncField(row) {
  const type = row.querySelector('[data-key="type"]').value;
  row.querySelector('.options-field').hidden = type !== 'select';
  row.querySelector('.limits-field').hidden = !['number', 'currency'].includes(type);
}
function bandsText(bands = []) {
  return bands.map((band) => `${band.minAge}-${band.maxAge}: ${band.amount}`).join('\n');
}
function loadingsText(loadings = []) {
  return loadings.map((item) => `${item.field} = ${item.equals} : ${item.percentage}`).join('\n');
}
function addRate(rate = {}) {
  const row = document.querySelector('#rate-template').content.cloneNode(true).firstElementChild;
  const old = row.querySelector('[data-key="insurer"]');
  const select = document.createElement('select');
  select.dataset.key = 'insurerId';
  select.required = true;
  select.innerHTML = `<option value="">Select insurer</option>${insurers
    .filter((item) => item.active !== false || item.id === rate.insurerId)
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
    .join('')}`;
  old.replaceWith(select);
  for (const input of row.querySelectorAll('[data-key]')) {
    const key = input.dataset.key;
    if (key === 'active') input.checked = rate.active !== false;
    else if (key === 'ageBands') input.value = bandsText(rate.ageBands);
    else if (key === 'loadings') input.value = loadingsText(rate.loadings);
    else if (key === 'insurerId') input.value = rate.insurerId || insurers.find((item) => item.name === rate.insurer)?.id || '';
    else input.value = rate[key] ?? (key === 'currency' ? 'NGN' : '');
  }
  row.dataset.id = rate.id || '';
  row.querySelector('.remove').addEventListener('click', () => row.remove());
  row.querySelector('[data-key="model"]').addEventListener('change', () => syncRate(row));
  document.querySelector('#rates-list').appendChild(row);
  syncRate(row);
}
function syncRate(row) {
  const model = row.querySelector('[data-key="model"]').value;
  row.querySelectorAll('[data-for]').forEach((item) => item.classList.toggle('show', item.dataset.for === model));
}
document.querySelector('#add-field').addEventListener('click', () => addField());
document.querySelector('#add-rate').addEventListener('click', () => addRate());
function openProduct(product = null) {
  editingId = product?.id || null;
  form.reset();
  document.querySelector('#fields-list').innerHTML = '';
  document.querySelector('#rates-list').innerHTML = '';
  document.querySelector('#dialog-title').textContent = product ? 'Edit insurance product' : 'New insurance product';
  form.elements.id.disabled = Boolean(product);
  form.elements.id.value = product?.id || '';
  form.elements.name.value = product?.name || '';
  form.elements.description.value = product?.description || '';
  form.elements.active.checked = product?.active !== false;
  const ec = product?.emailConfig || {
    sendEmailImmediately: product?.sendEmailImmediately === true,
    immediateEmailMode: 'acknowledgement',
    notifyTeam: product?.notifyTeam !== false,
    requireAdminMessage: product?.requireAdminMessage === true,
    customerSubject: product?.emailSubject || '',
    customerBody: product?.emailIntroduction || '',
    teamSubject: '',
    teamBody: '',
  };
  form.elements.notifyTeam.checked = ec.notifyTeam !== false;
  form.elements.sendEmailImmediately.checked = ec.sendEmailImmediately === true;
  form.elements.immediateEmailMode.value = ec.immediateEmailMode === 'quote' ? 'quote' : 'acknowledgement';
  form.elements.requireAdminMessage.checked = ec.requireAdminMessage === true;
  form.elements.customerSubject.value = ec.customerSubject || '';
  form.elements.customerBody.value = ec.customerBody || '';
  form.elements.teamSubject.value = ec.teamSubject || '';
  form.elements.teamBody.value = ec.teamBody || '';
  syncEmailMode();
  form.elements.benefits.value = lines(product?.benefits);
  form.elements.exclusions.value = lines(product?.exclusions);
  (product?.fields || []).forEach(addField);
  (product?.rates || []).forEach(addRate);
  document.querySelector('#delete-product').hidden = !product;
  document.querySelectorAll('.tab,.tab-panel').forEach((item) => item.classList.remove('active'));
  document.querySelector('[data-tab="basics"]').classList.add('active');
  document.querySelector('[data-panel="basics"]').classList.add('active');
  dialog.showModal();
}
document.querySelector('#new-product').addEventListener('click', () => openProduct());
function parseOptions(value) {
  return value
    .split('\n')
    .map((line) => {
      const [rawValue, rawLabel] = line.split('|');
      return { value: (rawValue || '').trim(), label: (rawLabel || rawValue || '').trim() };
    })
    .filter((item) => item.value && item.label);
}
function parseBands(value) {
  return value
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s*-\s*(\d+)\s*:\s*([\d,.]+)\s*$/);
      return match ? { minAge: Number(match[1]), maxAge: Number(match[2]), amount: Number(match[3].replace(/,/g, '')) } : null;
    })
    .filter(Boolean);
}
function parseLoadings(value) {
  return value
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*([^=]+)=([^:]+):\s*([\d.]+)\s*$/);
      return match ? { field: match[1].trim(), equals: match[2].trim(), percentage: Number(match[3]) } : null;
    })
    .filter(Boolean);
}
function rowData(row, type) {
  const value = (key) => row.querySelector(`[data-key="${key}"]`);
  if (type === 'field') {
    const min = value('min').value,
      max = value('max').value,
      placeholder = value('placeholder').value;
    return {
      label: value('label').value,
      key: value('key').value,
      type: value('type').value,
      required: value('required').checked,
      ...(min !== '' ? { min: Number(min) } : {}),
      ...(max !== '' ? { max: Number(max) } : {}),
      ...(placeholder ? { placeholder } : {}),
      options: parseOptions(value('options').value),
    };
  }
  return {
    id: row.dataset.id,
    insurerId: value('insurerId').value,
    model: value('model').value,
    currency: value('currency').value,
    active: value('active').checked,
    amount: Number(value('amount').value) || 0,
    percentage: Number(value('percentage').value) || 0,
    ageBands: parseBands(value('ageBands').value),
    loadings: parseLoadings(value('loadings').value),
    excess: value('excess').value,
    waitingPeriod: value('waitingPeriod').value,
    validFrom: value('validFrom').value,
    validTo: value('validTo').value,
  };
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = form.querySelector('footer .status');
  const product = {
    id: form.elements.id.value,
    name: form.elements.name.value,
    description: form.elements.description.value,
    active: form.elements.active.checked,
    emailConfig: {
      notifyTeam: form.elements.notifyTeam.checked,
      sendEmailImmediately: form.elements.sendEmailImmediately.checked,
      immediateEmailMode: form.elements.immediateEmailMode.value,
      requireAdminMessage: form.elements.requireAdminMessage.checked,
      customerSubject: form.elements.customerSubject.value,
      customerBody: form.elements.customerBody.value,
      teamSubject: form.elements.teamSubject.value,
      teamBody: form.elements.teamBody.value,
    },
    benefits: form.elements.benefits.value
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean),
    exclusions: form.elements.exclusions.value
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean),
    fields: [...document.querySelectorAll('.field-row')].map((row) => rowData(row, 'field')),
    rates: [...document.querySelectorAll('.rate-row')].map((row) => rowData(row, 'rate')),
  };
  try {
    status.textContent = 'Saving…';
    status.classList.remove('error');
    await api(editingId ? `/api/admin/products/${editingId}` : '/api/admin/products', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(product),
    });
    status.textContent = 'Saved';
    await loadProducts();
    setTimeout(() => dialog.close(), 350);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  }
});
document.querySelector('#delete-product').addEventListener('click', async () => {
  if (!editingId || !confirm('Delete this product? Existing quote records will remain.')) return;
  await api(`/api/admin/products/${editingId}`, { method: 'DELETE' });
  dialog.close();
  loadProducts();
});
const nav = document.querySelector('aside nav'),
  workspace = document.querySelector('.workspace');
nav.insertAdjacentHTML(
  'beforeend',
  '<button class="nav-item" id="insurers-nav">▣ <span>Insurers</span></button><button class="nav-item" id="countries-nav">◉ <span>Countries</span></button>'
);
workspace.insertAdjacentHTML(
  'beforeend',
  `<div id="insurers-view" hidden><div class="catalog-heading"><div><h2>Insurers</h2><p>Manage the insurers available when configuring product rates.</p></div><button class="primary" id="add-insurer">+ Add insurer</button></div><div id="insurer-list" class="catalog-list"></div></div><div id="countries-view" hidden><div class="catalog-heading"><div><h2>Countries</h2><p>Manage the destination list used by country questions.</p></div><button class="primary" id="add-country">+ Add country</button></div><div id="country-list" class="catalog-list"></div></div>`
);
function renderInsurers() {
  document.querySelector('#insurer-list').innerHTML =
    insurers
      .map(
        (item) =>
          `<form class="catalog-row insurer-row" data-id="${esc(item.id)}"><input name="name" value="${esc(item.name)}" required placeholder="Insurer name"><input name="code" value="${esc(item.code)}" placeholder="Code"><input name="website" value="${esc(item.website)}" placeholder="Website"><input name="contactEmail" type="email" value="${esc(item.contactEmail)}" placeholder="Contact email"><label class="check"><input name="active" type="checkbox" ${item.active !== false ? 'checked' : ''}> Active</label><button class="secondary" type="submit">Save</button><button class="remove delete-catalog" type="button">Delete</button><span class="status"></span></form>`
      )
      .join('') || '<p>No insurers yet.</p>';
  document.querySelectorAll('.insurer-row').forEach(bindInsurer);
}
function bindInsurer(form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(`/api/admin/insurers/${form.dataset.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...data, active: form.elements.active.checked }),
      });
      await refreshInsurers();
    } catch (error) {
      form.querySelector('.status').textContent = error.message;
    }
  });
  form.querySelector('.delete-catalog').addEventListener('click', async () => {
    if (!confirm('Delete this insurer?')) return;
    try {
      await api(`/api/admin/insurers/${form.dataset.id}`, { method: 'DELETE' });
      await refreshInsurers();
    } catch (error) {
      form.querySelector('.status').textContent = error.message;
    }
  });
}
async function refreshInsurers() {
  insurers = (await api('/api/admin/insurers')).insurers;
  renderInsurers();
}
document.querySelector('#add-insurer').addEventListener('click', async () => {
  const name = prompt('Insurer name');
  if (!name) return;
  try {
    await api('/api/admin/insurers', { method: 'POST', body: JSON.stringify({ name, active: true }) });
    await refreshInsurers();
  } catch (error) {
    alert(error.message);
  }
});
function renderCountries() {
  document.querySelector('#country-list').innerHTML =
    countries
      .map(
        (item) =>
          `<form class="catalog-row country-row" data-code="${esc(item.code)}"><input name="code" value="${esc(item.code)}" disabled><input name="name" value="${esc(item.name)}" required><label class="check"><input name="active" type="checkbox" ${item.active !== false ? 'checked' : ''}> Active</label><button class="secondary" type="submit">Save</button><button class="remove delete-catalog" type="button">Delete</button><span class="status"></span></form>`
      )
      .join('') || '<p>No countries yet.</p>';
  document.querySelectorAll('.country-row').forEach(bindCountry);
}
function bindCountry(form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/countries/${form.dataset.code}`, {
        method: 'PUT',
        body: JSON.stringify({ name: form.elements.name.value, active: form.elements.active.checked }),
      });
      await refreshCountries();
    } catch (error) {
      form.querySelector('.status').textContent = error.message;
    }
  });
  form.querySelector('.delete-catalog').addEventListener('click', async () => {
    if (!confirm('Delete this country?')) return;
    try {
      await api(`/api/admin/countries/${form.dataset.code}`, { method: 'DELETE' });
      await refreshCountries();
    } catch (error) {
      form.querySelector('.status').textContent = error.message;
    }
  });
}
async function refreshCountries() {
  countries = (await api('/api/admin/countries')).countries;
  renderCountries();
}
document.querySelector('#add-country').addEventListener('click', async () => {
  const code = prompt('Two-letter country code (for example NG)');
  if (!code) return;
  const name = prompt('Country name');
  if (!name) return;
  try {
    await api('/api/admin/countries', { method: 'POST', body: JSON.stringify({ code, name, active: true }) });
    await refreshCountries();
  } catch (error) {
    alert(error.message);
  }
});
function showView(id, button) {
  document.querySelectorAll('#product-view,#quotes-view,#insurers-view,#countries-view').forEach((view) => (view.hidden = view.id !== id));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
}

/**
 * Email preview dialog.
 *
 * The message box lives inside the dialog so an administrator can review, edit
 * and send in one place. Every keystroke refreshes the rendered email, and the
 * same text is what gets sent, so what is reviewed is what is delivered.
 */
const previewState = { reference: '', sendable: false, messageRequired: false, timer: 0, request: 0 };

/** Show a short confirmation above the lead list, for example after a send. */
function showQuoteBanner(text, tone = 'sent') {
  const banner = document.querySelector('#quote-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.className = `quote-banner ${tone}`;
  banner.hidden = !text;
}

async function renderEmailPreview(message) {
  const ticket = ++previewState.request;
  const messageBox = document.querySelector('#preview-message');
  try {
    const result = await api(`/api/admin/quotes/${previewState.reference}/email-preview`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    // Ignore a response that a newer keystroke has already superseded.
    if (ticket !== previewState.request) return;

    document.querySelector('#preview-to').textContent = result.to || '';
    document.querySelector('#preview-subject').textContent = result.subject || '';
    document.querySelector('#preview-plain').textContent = result.text || '';
    document.querySelector('#preview-frame').srcdoc = result.html || '';
    previewState.sendable = result.sendable;
    previewState.messageRequired = result.messageRequired;
    // A lead that has already been sent shows the message it actually went out
    // with, read only, so the review reflects reality.
    if (result.sentMessage) messageBox.value = result.sentMessage;
    updatePreviewActions();
  } catch (error) {
    if (ticket !== previewState.request) return;
    const status = document.querySelector('#preview-status');
    status.textContent = error.message;
    status.classList.add('error');
  }
}

function updatePreviewActions() {
  const send = document.querySelector('#preview-send');
  const messageBox = document.querySelector('#preview-message');
  messageBox.disabled = !previewState.sendable;
  const message = messageBox.value.trim();
  const blocked = !previewState.sendable || (previewState.messageRequired && !message);
  send.disabled = blocked;
  send.textContent = previewState.sendable ? 'Send email' : 'Already sent';
  const label = document.querySelector('#preview-message-label');
  label.textContent = previewState.messageRequired ? 'Message for the customer (required)' : 'Optional message for the customer';
  const status = document.querySelector('#preview-status');
  if (!status.classList.contains('error')) {
    status.textContent = previewState.sendable
      ? message
        ? 'Your message will be included in the email above.'
        : 'No message added. You can send as it is, or write one below.'
      : 'This request is closed, so the email cannot be sent again.';
  }
}

function openEmailPreview(reference, storedMessage) {
  // Discard any re-render left over from a previous lead, otherwise its message
  // could land in this lead's window and be sent by mistake.
  clearTimeout(previewState.timer);
  previewState.timer = 0;
  previewState.reference = reference;
  const dialog = document.querySelector('#preview-dialog');
  const messageBox = document.querySelector('#preview-message');
  const status = document.querySelector('#preview-status');
  messageBox.disabled = false;
  document.querySelector('#preview-title').textContent = 'Review the email before it is sent';
  document.querySelector('#preview-note').textContent = 'This is the exact message the customer will receive.';
  status.textContent = '';
  status.classList.remove('error');
  messageBox.value = storedMessage || '';
  if (!dialog.open) dialog.showModal();
  renderEmailPreview(messageBox.value);
}

document.querySelector('#preview-message').addEventListener('input', (event) => {
  const status = document.querySelector('#preview-status');
  clearTimeout(previewState.timer);
  const message = event.target.value;
  // Block sending until the frame catches up, so what was reviewed is exactly
  // what goes out even if the administrator types and clicks straight away.
  document.querySelector('#preview-send').disabled = true;
  status.classList.remove('error');
  status.textContent = 'Updating the email above…';
  // Re-render shortly after typing stops so each keystroke does not hit the API.
  previewState.timer = setTimeout(() => renderEmailPreview(message), 400);
});

// Closing the window abandons any pending or in-flight re-render.
document.querySelector('#preview-dialog').addEventListener('close', () => {
  clearTimeout(previewState.timer);
  previewState.timer = 0;
  previewState.request += 1;
});

document.querySelector('#preview-send').addEventListener('click', async () => {
  const send = document.querySelector('#preview-send'),
    status = document.querySelector('#preview-status');
  const message = document.querySelector('#preview-message').value.trim();
  if (!previewState.sendable) return;
  send.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Sending…';
  try {
    const result = await api(`/api/admin/quotes/${previewState.reference}/send-email`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    document.querySelector('#preview-dialog').close();
    showQuoteBanner(result.message, 'sent');
    // The lead just became closed, so refresh the list rather than leaving a
    // stale "Preview and send" button behind.
    await loadQuotes();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    updatePreviewActions();
  }
});
document.querySelector('#quotes-nav').addEventListener('click', (event) => {
  showView('quotes-view', event.currentTarget);
  loadQuotes();
});
document.querySelector('#insurers-nav').addEventListener('click', (event) => showView('insurers-view', event.currentTarget));
document.querySelector('#countries-nav').addEventListener('click', (event) => showView('countries-view', event.currentTarget));
document.querySelector('.nav-item').addEventListener('click', (event) => showView('product-view', event.currentTarget));
async function loadQuotes() {
  const data = await api('/api/admin/quotes'),
    quoteList = document.querySelector('#quote-list');
  const lookup = { countries: Object.fromEntries(countries.map((c) => [c.code, c.name])) };
  quoteList.innerHTML =
    data.quotes
      .map((q) => {
        const product = products.find((p) => p.id === q.productId),
          closed = ['closed', 'closed-manually'].includes(q.status),
          previewLabel = closed ? 'View sent email' : 'Preview and send';
        const answers = formatDetails(product, q.details, lookup);
        const detailsBlock = answers.length
          ? `<div class="quote-answers"><b>Customer answers</b><dl>${answers.map((a) => `<div><dt>${esc(a.label)}</dt><dd>${esc(a.value)}</dd></div>`).join('')}</dl></div>`
          : '';
        return `<article class="quote-item quote-workflow" data-reference="${esc(q.reference)}" data-admin-message="${esc(q.adminMessage || '')}"><div><h3>${esc(q.name)}</h3><p>${esc(q.email)} · ${esc(q.phone)}</p><small>${esc(q.reference)}</small></div><span>${esc(q.productName || q.product)}</span><span class="badge ${closed ? '' : 'off'}">${esc(q.status)}</span><span>${new Date(q.createdAt).toLocaleString()}</span>${detailsBlock}<div class="quote-actions"><button class="secondary preview-quote" type="button">${previewLabel}</button>${!closed ? `<button class="remove close-quote" type="button">Close manually</button>` : ''}${closed && q.adminMessage ? `<p class="quote-note">${esc(q.adminMessage)}</p>` : ''}<p class="quote-action-status">${q.customerEmail?.error ? `Email failed: ${esc(q.customerEmail.error)}` : q.customerEmail?.status === 'sent' ? 'Email sent successfully' : ''}${q.teamEmail?.status === 'failed' ? ` · Team notification failed: ${esc(q.teamEmail.error)}` : ''}</p></div></article>`;
      })
      .join('') || '<p>No quote requests yet.</p>';
  quoteList.querySelectorAll('.preview-quote').forEach((button) =>
    button.addEventListener('click', () => {
      const row = button.closest('.quote-workflow');
      openEmailPreview(row.dataset.reference, row.dataset.adminMessage || '');
    })
  );
  quoteList.querySelectorAll('.close-quote').forEach((button) =>
    button.addEventListener('click', async () => {
      const row = button.closest('.quote-workflow'),
        reason = prompt('Reason for closing this quote', 'Customer contacted manually.');
      if (reason === null) return;
      try {
        const result = await api(`/api/admin/quotes/${row.dataset.reference}/close`, { method: 'POST', body: JSON.stringify({ reason }) });
        showQuoteBanner(result.message || 'Request closed.');
      } catch (error) {
        row.querySelector('.quote-action-status').textContent = error.message;
      }
    })
  );
}
document.querySelector('#refresh-quotes').addEventListener('click', loadQuotes);
checkSession();
