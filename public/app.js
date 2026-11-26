const alertBox = document.getElementById('alert');

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function showAlert(message, kind = 'error') {
  alertBox.textContent = message;
  alertBox.className = kind === 'ok' ? 'alert ok' : 'alert';
  alertBox.hidden = false;
  clearTimeout(showAlert.timer);
  showAlert.timer = setTimeout(() => {
    alertBox.hidden = true;
  }, 5000);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function cell(row, value, className) {
  const td = document.createElement('td');
  td.textContent = value;
  if (className) td.className = className;
  row.appendChild(td);
  return td;
}

function renderStats(stats) {
  const container = document.getElementById('stats');
  container.textContent = '';
  const cards = [
    ['Products', stats.productCount],
    ['Customers', stats.customerCount],
    ['Orders', stats.orderCount],
    ['Revenue', money.format(stats.revenue)],
    ['Low stock', stats.lowStockCount],
  ];
  for (const [label, value] of cards) {
    const card = document.createElement('div');
    card.className = 'card';
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = value;
    card.append(name, amount);
    container.appendChild(card);
  }
}

function renderProducts(products, lowStock) {
  const body = document.getElementById('products-body');
  body.textContent = '';
  if (products.length === 0) {
    const row = document.createElement('tr');
    const td = cell(row, 'No products yet.');
    td.colSpan = 4;
    td.className = 'empty';
    body.appendChild(row);
    return;
  }
  const lowIds = new Set(lowStock.map((product) => product.id));
  for (const product of products) {
    const row = document.createElement('tr');
    if (lowIds.has(product.id)) row.className = 'low';
    cell(row, product.sku);
    cell(row, product.name);
    cell(row, money.format(product.unitPrice), 'num');
    cell(row, product.stock, 'num');
    body.appendChild(row);
  }
}

function renderCustomers(customers) {
  const body = document.getElementById('customers-body');
  body.textContent = '';
  if (customers.length === 0) {
    const row = document.createElement('tr');
    const td = cell(row, 'No customers yet.');
    td.colSpan = 2;
    td.className = 'empty';
    body.appendChild(row);
    return;
  }
  for (const customer of customers) {
    const row = document.createElement('tr');
    cell(row, customer.name);
    cell(row, customer.email || '—');
    body.appendChild(row);
  }
}

function renderOrders(orders) {
  const body = document.getElementById('orders-body');
  body.textContent = '';
  if (orders.length === 0) {
    const row = document.createElement('tr');
    const td = cell(row, 'No orders yet.');
    td.colSpan = 4;
    td.className = 'empty';
    body.appendChild(row);
    return;
  }
  for (const order of [...orders].reverse()) {
    const row = document.createElement('tr');
    cell(row, `#${order.id}`);
    cell(row, order.customerName);
    cell(row, order.items.map((line) => `${line.qty} × ${line.sku}`).join(', '));
    cell(row, money.format(order.total), 'num');
    body.appendChild(row);
  }
}

function renderSelects(products, customers) {
  const customerSelect = document.getElementById('order-customer');
  const productSelect = document.getElementById('order-product');

  const previousCustomer = customerSelect.value;
  const previousProduct = productSelect.value;

  customerSelect.textContent = '';
  for (const customer of customers) {
    const option = document.createElement('option');
    option.value = String(customer.id);
    option.textContent = customer.name;
    customerSelect.appendChild(option);
  }

  productSelect.textContent = '';
  for (const product of products) {
    const option = document.createElement('option');
    option.value = String(product.id);
    option.textContent = `${product.sku} · ${product.name} (${product.stock} in stock)`;
    option.disabled = product.stock === 0;
    productSelect.appendChild(option);
  }

  if (previousCustomer) customerSelect.value = previousCustomer;
  if (previousProduct) productSelect.value = previousProduct;
}

async function load() {
  const summary = await request('/api/summary');
  renderStats(summary.stats);
  renderProducts(summary.products, summary.lowStock);
  renderCustomers(summary.customers);
  renderOrders(summary.orders);
  renderSelects(summary.products, summary.customers);
}

document.getElementById('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const { product } = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    form.reset();
    await load();
    showAlert(`Product ${product.sku} added.`, 'ok');
  } catch (error) {
    showAlert(error.message);
  }
});

document.getElementById('customer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const { customer } = await request('/api/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    form.reset();
    await load();
    showAlert(`Customer ${customer.name} added.`, 'ok');
  } catch (error) {
    showAlert(error.message);
  }
});

document.getElementById('order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const { order } = await request('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerId: Number(data.customerId),
        items: [{ productId: Number(data.productId), qty: Number(data.qty) }],
      }),
    });
    await load();
    showAlert(`Order #${order.id} confirmed for ${money.format(order.total)}.`, 'ok');
  } catch (error) {
    showAlert(error.message);
  }
});

document.getElementById('refresh').addEventListener('click', async () => {
  try {
    await load();
    showAlert('Data refreshed.', 'ok');
  } catch (error) {
    showAlert(error.message);
  }
});

load().catch((error) => showAlert(`Could not load data: ${error.message}`));
