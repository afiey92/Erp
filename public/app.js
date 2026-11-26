const state = {
  products: [],
  customers: [],
  suppliers: [],
  route: 'dashboard',
  reportRange: null,
};

const money = (value) =>
  `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (value) => Number(value || 0).toLocaleString('en-US');

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));

const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const dayKey = (date) => date.toISOString().slice(0, 10);

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: dayKey(from), to: dayKey(to) };
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

let toastTimer = null;
function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = kind === 'error' ? 'toast error' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

const modal = document.getElementById('modal');
function openModal(title, html) {
  document.getElementById('modal-body').innerHTML = `<h2>${esc(title)}</h2>${html}`;
  modal.showModal();
  modal.querySelector('input, select, textarea')?.focus();
}
function closeModal() {
  if (modal.open) modal.close();
}

function statusBadge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

async function loadLookups() {
  const [products, customers, suppliers] = await Promise.all([
    api('/products'),
    api('/customers'),
    api('/suppliers'),
  ]);
  state.products = products.products;
  state.customers = customers.customers;
  state.suppliers = suppliers.suppliers;
}

function isLow(product) {
  return product.stock <= (Number.isFinite(product.reorderPoint) ? product.reorderPoint : 20);
}

/* ---------------------------------------------------------------- dashboard */

async function viewDashboard() {
  const data = await api('/dashboard');
  const stats = data.stats;
  const maxRevenue = Math.max(1, ...data.trend.map((row) => row.revenue));

  const cards = [
    { label: 'Revenue (confirmed)', value: money(stats.revenue), hint: `${num(stats.salesOrderCount)} sales orders` },
    { label: 'Outstanding invoices', value: money(stats.outstanding), hint: `${num(stats.openInvoiceCount)} unpaid` },
    { label: 'Stock value', value: money(stats.stockValue), hint: `${num(stats.productCount)} products` },
    { label: 'Low stock items', value: num(stats.lowStockCount), hint: 'At or below reorder point' },
  ]
    .map(
      (card) => `<div class="card">
        <div class="label">${esc(card.label)}</div>
        <div class="value">${esc(card.value)}</div>
        <div class="hint">${esc(card.hint)}</div>
      </div>`,
    )
    .join('');

  const trend = data.trend
    .map(
      (row) => `<div class="bar-wrap" title="${esc(row.date)}: ${money(row.revenue)}">
        <div class="bar" style="height:${Math.max(3, Math.round((row.revenue / maxRevenue) * 100))}%"></div>
        <span class="bar-label">${esc(row.date.slice(5))}</span>
      </div>`,
    )
    .join('');

  const topProducts = data.topProducts.length
    ? data.topProducts
        .map(
          (row) => `<tr><td>${esc(row.sku)}</td><td>${esc(row.name)}</td>
            <td class="num">${num(row.qty)}</td><td class="num">${money(row.revenue)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No confirmed sales yet.</td></tr>';

  const lowStock = data.lowStock.length
    ? data.lowStock
        .map(
          (row) => `<tr><td>${esc(row.sku)}</td><td>${esc(row.name)}</td>
            <td class="num">${num(row.stock)}</td><td class="num">${num(row.reorderPoint)}</td>
            <td><span class="badge low">reorder</span></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="empty">All products are above their reorder point.</td></tr>';

  const movements = data.recentMovements.length
    ? data.recentMovements
        .map(
          (row) => `<tr><td>${esc(row.sku)}</td>
            <td><span class="badge ${esc(row.type)}">${esc(row.type)}</span></td>
            <td class="num">${row.qty > 0 ? '+' : ''}${num(row.qty)}</td>
            <td class="num">${num(row.balanceAfter)}</td>
            <td>${esc(row.reference)}</td><td>${esc(shortDate(row.at))}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="empty">No stock movements recorded.</td></tr>';

  const invoices = data.openInvoices.length
    ? data.openInvoices
        .map(
          (row) => `<tr><td>${esc(row.number)}</td><td>${esc(row.customerName)}</td>
            <td class="num">${money(row.balance)}</td><td>${esc(shortDate(row.dueAt))}</td>
            <td>${statusBadge(row.status)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="empty">No open invoices.</td></tr>';

  return {
    actions: '',
    html: `<div class="cards">${cards}</div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>Revenue, last 7 days</h2><span class="muted">${money(stats.revenue)} total</span></div>
          <div class="trend">${trend}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Open invoices</h2><a class="muted" href="#/invoices">View all</a></div>
          <table><thead><tr><th>Invoice</th><th>Customer</th><th class="num">Balance</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>${invoices}</tbody></table>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>Top products</h2></div>
          <table><thead><tr><th>SKU</th><th>Product</th><th class="num">Units</th><th class="num">Revenue</th></tr></thead>
          <tbody>${topProducts}</tbody></table>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Reorder list</h2><a class="muted" href="#/purchases">Create PO</a></div>
          <table><thead><tr><th>SKU</th><th>Product</th><th class="num">Stock</th><th class="num">Reorder at</th><th></th></tr></thead>
          <tbody>${lowStock}</tbody></table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Recent stock movements</h2><a class="muted" href="#/stock">Stock ledger</a></div>
        <table><thead><tr><th>SKU</th><th>Type</th><th class="num">Qty</th><th class="num">Balance</th><th>Reference</th><th>Date</th></tr></thead>
        <tbody>${movements}</tbody></table>
      </div>`,
  };
}

/* ----------------------------------------------------------------- products */

async function viewProducts() {
  const data = await api('/products');
  state.products = data.products;

  const rows = data.products.length
    ? data.products
        .map(
          (product) => `<tr>
            <td>${esc(product.sku)}</td>
            <td>${esc(product.name)}</td>
            <td>${esc(product.category || '—')}</td>
            <td class="num">${money(product.unitPrice)}</td>
            <td class="num">${money(product.cost)}</td>
            <td class="num">${num(product.stock)} ${isLow(product) ? '<span class="badge low">low</span>' : ''}</td>
            <td class="num">${money(product.stock * product.cost)}</td>
            <td><button type="button" class="small" data-action="adjust-stock" data-id="${product.id}">Adjust</button></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="8" class="empty">No products yet.</td></tr>';

  return {
    actions: '<button type="button" class="primary" data-action="new-product">New product</button>',
    html: `<div class="panel">
      <div class="panel-head"><h2>Products</h2><span class="muted">${num(data.products.length)} items</span></div>
      <table><thead><tr><th>SKU</th><th>Name</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th>
      <th class="num">Stock</th><th class="num">Stock value</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`,
  };
}

function productForm() {
  return `<form data-form="product">
    <div class="field"><label for="p-sku">SKU</label><input id="p-sku" name="sku" required autocomplete="off"></div>
    <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" required></div>
    <div class="field"><label for="p-category">Category</label><input id="p-category" name="category"></div>
    <div class="field"><label for="p-price">Unit price</label><input id="p-price" name="unitPrice" type="number" min="0" step="0.01" value="0"></div>
    <div class="field"><label for="p-cost">Unit cost</label><input id="p-cost" name="cost" type="number" min="0" step="0.01" value="0"></div>
    <div class="field"><label for="p-stock">Opening stock</label><input id="p-stock" name="stock" type="number" min="0" step="1" value="0"></div>
    <div class="field"><label for="p-reorder">Reorder point</label><input id="p-reorder" name="reorderPoint" type="number" min="0" step="1" value="20"></div>
    <div class="modal-actions">
      <button type="button" class="ghost" data-action="close-modal">Cancel</button>
      <button type="submit" class="primary">Create product</button>
    </div>
  </form>`;
}

/* -------------------------------------------------------------------- sales */

function lineRowHtml(priceField) {
  const options = state.products
    .map((product) => {
      const price = priceField === 'unitCost' ? product.cost : product.unitPrice;
      return `<option value="${product.id}" data-price="${price}">${esc(product.sku)} · ${esc(product.name)}</option>`;
    })
    .join('');
  const first = state.products[0];
  const initial = first ? (priceField === 'unitCost' ? first.cost : first.unitPrice) : 0;
  return `<div class="line-row">
    <select class="line-product" aria-label="Product">${options}</select>
    <input class="line-qty" type="number" min="1" step="1" value="1" aria-label="Quantity">
    <input class="line-price" type="number" min="0" step="0.01" value="${Number(initial).toFixed(2)}" aria-label="Price">
    <span class="line-total">${money(initial)}</span>
    <button type="button" class="small" data-action="remove-line" aria-label="Remove line">×</button>
  </div>`;
}

function orderForm(kind) {
  const isSales = kind === 'sales';
  const parties = isSales ? state.customers : state.suppliers;
  const partyLabel = isSales ? 'Customer' : 'Supplier';
  const priceField = isSales ? 'unitPrice' : 'unitCost';
  const partyOptions = parties
    .map((party) => `<option value="${party.id}">${esc(party.name)}</option>`)
    .join('');

  return `<form id="${isSales ? 'so' : 'po'}-form" class="panel" data-form="${isSales ? 'sales-order' : 'purchase-order'}" hidden>
    <h2>New ${isSales ? 'sales order' : 'purchase order'}</h2>
    <div class="field"><label for="${isSales ? 'so' : 'po'}-party">${partyLabel}</label>
      <select id="${isSales ? 'so' : 'po'}-party" name="partyId" required>${partyOptions}</select></div>
    <div class="line-rows">${lineRowHtml(priceField)}</div>
    <div><button type="button" class="small" data-action="add-line" data-price-field="${priceField}">+ Add line</button></div>
    ${isSales ? '<div class="field"><label for="so-tax">Tax rate %</label><input id="so-tax" name="taxRate" type="number" min="0" max="100" step="0.1" value="0"></div>' : ''}
    <div class="field"><label for="${isSales ? 'so' : 'po'}-note">Note</label><input id="${isSales ? 'so' : 'po'}-note" name="note"></div>
    <div class="totals"></div>
    <div class="form-actions">
      <button type="submit" class="primary">Save draft</button>
      <button type="button" class="ghost" data-action="hide-form">Cancel</button>
    </div>
  </form>`;
}

async function viewSales() {
  await loadLookups();
  const data = await api('/sales-orders');

  const rows = data.salesOrders.length
    ? data.salesOrders
        .map((order) => {
          const actions = [];
          if (order.status === 'draft') {
            actions.push(`<button type="button" class="small primary" data-action="confirm-order" data-id="${order.id}">Confirm</button>`);
            actions.push(`<button type="button" class="small" data-action="cancel-order" data-id="${order.id}">Cancel</button>`);
          }
          if (order.status === 'confirmed') {
            actions.push(`<button type="button" class="small primary" data-action="invoice-order" data-id="${order.id}">Create invoice</button>`);
          }
          if (order.invoiceId) {
            actions.push(`<a class="small" href="#/invoices">Invoice</a>`);
          }
          return `<tr>
            <td>${esc(order.number)}</td>
            <td>${esc(order.customerName)}</td>
            <td>${esc(shortDate(order.createdAt))}</td>
            <td class="num">${num(order.items.length)}</td>
            <td class="num">${money(order.total)}</td>
            <td>${statusBadge(order.status)}</td>
            <td><div class="actions">${actions.join('')}</div></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty">No sales orders yet.</td></tr>';

  return {
    actions: '<button type="button" class="primary" data-action="show-form" data-target="#so-form">New sales order</button>',
    html: `${orderForm('sales')}
      <div class="panel">
        <div class="panel-head"><h2>Sales orders</h2><span class="muted">Draft → confirmed → invoiced → paid</span></div>
        <table><thead><tr><th>Number</th><th>Customer</th><th>Date</th><th class="num">Lines</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`,
  };
}

/* --------------------------------------------------------------- purchasing */

async function viewPurchases() {
  await loadLookups();
  const data = await api('/purchase-orders');

  const rows = data.purchaseOrders.length
    ? data.purchaseOrders
        .map((order) => {
          const actions = order.status === 'draft'
            ? `<button type="button" class="small primary" data-action="receive-po" data-id="${order.id}">Receive goods</button>`
            : '';
          return `<tr>
            <td>${esc(order.number)}</td>
            <td>${esc(order.supplierName)}</td>
            <td>${esc(shortDate(order.createdAt))}</td>
            <td class="num">${num(order.items.length)}</td>
            <td class="num">${money(order.total)}</td>
            <td>${statusBadge(order.status)}</td>
            <td><div class="actions">${actions}</div></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty">No purchase orders yet.</td></tr>';

  return {
    actions: '<button type="button" class="primary" data-action="show-form" data-target="#po-form">New purchase order</button>',
    html: `${orderForm('purchase')}
      <div class="panel">
        <div class="panel-head"><h2>Purchase orders</h2><span class="muted">Receiving a PO adds stock</span></div>
        <table><thead><tr><th>Number</th><th>Supplier</th><th>Date</th><th class="num">Lines</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`,
  };
}

/* ----------------------------------------------------------------- invoices */

async function viewInvoices() {
  const data = await api('/invoices');

  const rows = data.invoices.length
    ? data.invoices
        .map(
          (invoice) => `<tr>
            <td>${esc(invoice.number)}</td>
            <td>${esc(invoice.customerName)}</td>
            <td>${esc(shortDate(invoice.issuedAt))}</td>
            <td>${esc(shortDate(invoice.dueAt))}</td>
            <td class="num">${money(invoice.total)}</td>
            <td class="num">${money(invoice.paid)}</td>
            <td class="num">${money(invoice.balance)}</td>
            <td>${statusBadge(invoice.status)}</td>
            <td>${invoice.status !== 'paid'
              ? `<button type="button" class="small primary" data-action="pay-invoice" data-id="${invoice.id}">Record payment</button>`
              : ''}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="empty">No invoices yet. Confirm a sales order and create an invoice.</td></tr>';

  return {
    actions: '',
    html: `<div class="panel">
      <div class="panel-head"><h2>Invoices</h2><span class="muted">Payments update the order status</span></div>
      <table><thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Due</th><th class="num">Total</th>
      <th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`,
  };
}

/* ------------------------------------------------------ customers/suppliers */

async function viewCustomers() {
  const data = await api('/customers');
  const rows = data.customers.length
    ? data.customers
        .map(
          (customer) => `<tr><td>${esc(customer.name)}</td><td>${esc(customer.email || '—')}</td>
            <td>${esc(customer.phone || '—')}</td><td>${esc(customer.city || '—')}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No customers yet.</td></tr>';

  return {
    actions: '<button type="button" class="primary" data-action="new-customer">New customer</button>',
    html: `<div class="panel">
      <div class="panel-head"><h2>Customers</h2><span class="muted">${num(data.customers.length)} records</span></div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>City</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`,
  };
}

async function viewSuppliers() {
  const data = await api('/suppliers');
  const rows = data.suppliers.length
    ? data.suppliers
        .map(
          (supplier) => `<tr><td>${esc(supplier.name)}</td><td>${esc(supplier.email || '—')}</td>
            <td>${esc(supplier.phone || '—')}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="empty">No suppliers yet.</td></tr>';

  return {
    actions: '<button type="button" class="primary" data-action="new-supplier">New supplier</button>',
    html: `<div class="panel">
      <div class="panel-head"><h2>Suppliers</h2><span class="muted">${num(data.suppliers.length)} records</span></div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`,
  };
}

function partyForm(kind) {
  const isCustomer = kind === 'customer';
  return `<form data-form="${kind}">
    <div class="field"><label for="n-name">Name</label><input id="n-name" name="name" required></div>
    <div class="field"><label for="n-email">Email</label><input id="n-email" name="email" type="email"></div>
    <div class="field"><label for="n-phone">Phone</label><input id="n-phone" name="phone"></div>
    ${isCustomer ? '<div class="field"><label for="n-city">City</label><input id="n-city" name="city"></div>' : ''}
    <div class="modal-actions">
      <button type="button" class="ghost" data-action="close-modal">Cancel</button>
      <button type="submit" class="primary">Create ${kind}</button>
    </div>
  </form>`;
}

/* -------------------------------------------------------------- stock ledger */

async function viewStock() {
  const data = await api('/stock-movements?limit=200');
  const rows = data.stockMovements.length
    ? data.stockMovements
        .map(
          (row) => `<tr><td>${esc(shortDate(row.at))}</td><td>${esc(row.sku)}</td>
            <td><span class="badge ${esc(row.type)}">${esc(row.type)}</span></td>
            <td class="num">${row.qty > 0 ? '+' : ''}${num(row.qty)}</td>
            <td class="num">${num(row.balanceAfter)}</td>
            <td>${esc(row.reference)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="empty">No stock movements recorded.</td></tr>';

  return {
    actions: '',
    html: `<div class="panel">
      <div class="panel-head"><h2>Stock ledger</h2><span class="muted">Every sale, receipt, adjustment and opening balance</span></div>
      <table><thead><tr><th>Date</th><th>SKU</th><th>Type</th><th class="num">Qty</th><th class="num">Balance</th><th>Reference</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`,
  };
}

/* ------------------------------------------------------------------ reports */

async function viewReports() {
  const range = state.reportRange ?? defaultRange();
  const [sales, inventory] = await Promise.all([
    api(`/reports/sales?from=${range.from}&to=${range.to}`),
    api('/reports/inventory'),
  ]);

  const productRows = sales.byProduct.length
    ? sales.byProduct
        .map(
          (row) => `<tr><td>${esc(row.sku)}</td><td>${esc(row.name)}</td>
            <td class="num">${num(row.qty)}</td><td class="num">${money(row.revenue)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No sales in this period.</td></tr>';

  const customerRows = sales.byCustomer.length
    ? sales.byCustomer
        .map(
          (row) => `<tr><td>${esc(row.customer)}</td><td class="num">${num(row.orders)}</td>
            <td class="num">${money(row.revenue)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="empty">No sales in this period.</td></tr>';

  const dayRows = sales.byDay.length
    ? sales.byDay
        .map(
          (row) => `<tr><td>${esc(row.date)}</td><td class="num">${num(row.orders)}</td>
            <td class="num">${money(row.revenue)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="empty">No sales in this period.</td></tr>';

  const inventoryRows = inventory.products
    .map(
      (product) => `<tr><td>${esc(product.sku)}</td><td>${esc(product.name)}</td>
        <td class="num">${num(product.stock)}</td><td class="num">${money(product.cost)}</td>
        <td class="num">${money(product.stockValue)}</td>
        <td>${product.low ? '<span class="badge low">low</span>' : ''}</td></tr>`,
    )
    .join('');

  return {
    actions: '',
    html: `<form class="panel inline-form" data-form="report">
        <div class="field"><label for="r-from">From</label><input id="r-from" name="from" type="date" value="${esc(range.from)}"></div>
        <div class="field"><label for="r-to">To</label><input id="r-to" name="to" type="date" value="${esc(range.to)}"></div>
        <div class="form-actions"><button type="submit" class="primary">Run report</button></div>
      </form>
      <div class="cards">
        <div class="card"><div class="label">Revenue</div><div class="value">${money(sales.totals.revenue)}</div><div class="hint">${num(sales.totals.orderCount)} orders</div></div>
        <div class="card"><div class="label">Tax collected</div><div class="value">${money(sales.totals.tax)}</div><div class="hint">In period</div></div>
        <div class="card"><div class="label">Average order</div><div class="value">${money(sales.totals.averageOrder)}</div><div class="hint">Per order</div></div>
        <div class="card"><div class="label">Stock value</div><div class="value">${money(inventory.totals.stockValue)}</div><div class="hint">${num(inventory.totals.units)} units</div></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>Sales by product</h2></div>
          <table><thead><tr><th>SKU</th><th>Product</th><th class="num">Units</th><th class="num">Revenue</th></tr></thead>
          <tbody>${productRows}</tbody></table>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Sales by customer</h2></div>
          <table><thead><tr><th>Customer</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead>
          <tbody>${customerRows}</tbody></table>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>Daily sales</h2></div>
          <table><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead>
          <tbody>${dayRows}</tbody></table>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Inventory valuation</h2></div>
          <table><thead><tr><th>SKU</th><th>Product</th><th class="num">Stock</th><th class="num">Cost</th><th class="num">Value</th><th></th></tr></thead>
          <tbody>${inventoryRows}</tbody></table>
        </div>
      </div>`,
  };
}

/* ------------------------------------------------------------------- router */

const routes = {
  dashboard: { title: 'Dashboard', subtitle: 'Business overview', view: viewDashboard },
  products: { title: 'Products', subtitle: 'Catalogue, pricing and stock levels', view: viewProducts },
  sales: { title: 'Sales orders', subtitle: 'Draft, confirm, invoice and get paid', view: viewSales },
  purchases: { title: 'Purchase orders', subtitle: 'Order from suppliers and receive stock', view: viewPurchases },
  invoices: { title: 'Invoices', subtitle: 'Receivables and payments', view: viewInvoices },
  customers: { title: 'Customers', subtitle: 'Companies that buy from you', view: viewCustomers },
  suppliers: { title: 'Suppliers', subtitle: 'Companies you buy from', view: viewSuppliers },
  stock: { title: 'Stock ledger', subtitle: 'Every inventory movement', view: viewStock },
  reports: { title: 'Reports', subtitle: 'Sales and inventory analytics', view: viewReports },
};

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '').trim();
  return routes[raw] ? raw : 'dashboard';
}

async function render() {
  const name = currentRoute();
  state.route = name;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === name);
  });
  const route = routes[name];
  document.getElementById('view-title').textContent = route.title;
  document.getElementById('view-subtitle').textContent = route.subtitle;
  document.getElementById('topbar-actions').innerHTML = '';
  const view = document.getElementById('view');
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const result = await route.view();
    view.innerHTML = result.html;
    document.getElementById('topbar-actions').innerHTML = result.actions ?? '';
    view.querySelectorAll('form[data-form]').forEach((form) => recalc(form));
  } catch (error) {
    view.innerHTML = `<div class="panel"><p class="muted">${esc(error.message)}</p></div>`;
  }
}

/* ------------------------------------------------------------------ helpers */

function recalc(form) {
  if (!form) return;
  let subtotal = 0;
  form.querySelectorAll('.line-row').forEach((row) => {
    const qty = Number(row.querySelector('.line-qty')?.value) || 0;
    const price = Number(row.querySelector('.line-price')?.value) || 0;
    const total = qty * price;
    const cell = row.querySelector('.line-total');
    if (cell) cell.textContent = money(total);
    subtotal += total;
  });
  const taxRate = Number(form.querySelector('[name="taxRate"]')?.value) || 0;
  const tax = (subtotal * taxRate) / 100;
  const totals = form.querySelector('.totals');
  if (totals) {
    totals.innerHTML = `<span>Subtotal <strong>${money(subtotal)}</strong></span>
      <span>Tax <strong>${money(tax)}</strong></span>
      <span>Total <strong>${money(subtotal + tax)}</strong></span>`;
  }
}

function collectLines(form) {
  return [...form.querySelectorAll('.line-row')].map((row) => ({
    productId: Number(row.querySelector('.line-product').value),
    qty: Number(row.querySelector('.line-qty').value),
    price: Number(row.querySelector('.line-price').value),
  }));
}

/* ------------------------------------------------------------------ events */

document.addEventListener('change', (event) => {
  const select = event.target.closest('.line-product');
  if (!select) return;
  const row = select.closest('.line-row');
  const price = select.selectedOptions[0]?.dataset.price ?? '0';
  const input = row.querySelector('.line-price');
  input.value = Number(price).toFixed(2);
  recalc(select.closest('form'));
});

document.addEventListener('input', (event) => {
  if (event.target.closest('.line-row') || event.target.name === 'taxRate') {
    recalc(event.target.closest('form'));
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? '';

  try {
    if (kind === 'product') {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: value('sku'),
          name: value('name'),
          category: value('category'),
          unitPrice: value('unitPrice'),
          cost: value('cost'),
          stock: value('stock'),
          reorderPoint: value('reorderPoint'),
        }),
      });
      closeModal();
      toast(`Product ${value('sku')} created.`);
    }

    if (kind === 'customer' || kind === 'supplier') {
      const path = kind === 'customer' ? '/customers' : '/suppliers';
      await api(path, {
        method: 'POST',
        body: JSON.stringify({
          name: value('name'),
          email: value('email'),
          phone: value('phone'),
          city: value('city'),
        }),
      });
      closeModal();
      toast(`${kind === 'customer' ? 'Customer' : 'Supplier'} ${value('name')} created.`);
    }

    if (kind === 'sales-order' || kind === 'purchase-order') {
      const isSales = kind === 'sales-order';
      const lines = collectLines(form).map((line) => ({
        productId: line.productId,
        qty: line.qty,
        [isSales ? 'unitPrice' : 'unitCost']: line.price,
      }));
      const created = await api(isSales ? '/sales-orders' : '/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          [isSales ? 'customerId' : 'supplierId']: Number(value('partyId')),
          items: lines,
          taxRate: isSales ? value('taxRate') : undefined,
          note: value('note'),
        }),
      });
      toast(`Draft ${created.order.number} saved.`);
    }

    if (kind === 'payment') {
      const id = form.dataset.id;
      const result = await api(`/invoices/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: value('amount'), method: value('method'), note: value('note') }),
      });
      closeModal();
      toast(`Payment recorded. ${result.invoice.number} balance ${money(result.invoice.balance)}.`);
    }

    if (kind === 'report') {
      state.reportRange = { from: value('from'), to: value('to') };
    }

    await render();
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  const id = trigger.dataset.id;

  try {
    if (action === 'close-modal') {
      closeModal();
      return;
    }
    if (action === 'refresh') {
      await render();
      return;
    }
    if (action === 'new-product') {
      openModal('New product', productForm());
      return;
    }
    if (action === 'new-customer' || action === 'new-supplier') {
      openModal(action === 'new-customer' ? 'New customer' : 'New supplier', partyForm(action.slice(4)));
      return;
    }
    if (action === 'adjust-stock') {
      const product = state.products.find((row) => row.id === Number(id));
      openModal(
        `Adjust stock · ${product?.sku ?? ''}`,
        `<form data-form="adjust" data-id="${esc(id)}">
          <p class="muted">Current stock: ${num(product?.stock)}. Use a negative number to remove stock.</p>
          <div class="field"><label for="a-qty">Quantity change</label><input id="a-qty" name="qty" type="number" step="1" value="1" required></div>
          <div class="field"><label for="a-reason">Reason</label><input id="a-reason" name="reason" placeholder="Stock count correction"></div>
          <div class="modal-actions">
            <button type="button" class="ghost" data-action="close-modal">Cancel</button>
            <button type="submit" class="primary">Apply adjustment</button>
          </div>
        </form>`,
      );
      return;
    }
    if (action === 'pay-invoice') {
      const invoices = await api('/invoices');
      const invoice = invoices.invoices.find((row) => row.id === Number(id));
      openModal(
        `Record payment · ${invoice?.number ?? ''}`,
        `<form data-form="payment" data-id="${esc(id)}">
          <p class="muted">Outstanding balance: ${money(invoice?.balance)}</p>
          <div class="field"><label for="pay-amount">Amount</label>
            <input id="pay-amount" name="amount" type="number" min="0.01" step="0.01" value="${Number(invoice?.balance ?? 0).toFixed(2)}" required></div>
          <div class="field"><label for="pay-method">Method</label>
            <select id="pay-method" name="method">
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select></div>
          <div class="field"><label for="pay-note">Note</label><input id="pay-note" name="note"></div>
          <div class="modal-actions">
            <button type="button" class="ghost" data-action="close-modal">Cancel</button>
            <button type="submit" class="primary">Record payment</button>
          </div>
        </form>`,
      );
      return;
    }
    if (action === 'show-form' || action === 'hide-form') {
      const selector = action === 'show-form' ? trigger.dataset.target : '#so-form, #po-form';
      const target = document.querySelector(selector);
      if (target) {
        const show = target.hidden;
        target.hidden = !show;
        if (show) recalc(target);
      }
      return;
    }
    if (action === 'add-line') {
      const form = trigger.closest('form');
      form.querySelector('.line-rows').insertAdjacentHTML('beforeend', lineRowHtml(trigger.dataset.priceField));
      recalc(form);
      return;
    }
    if (action === 'remove-line') {
      const row = trigger.closest('.line-row');
      const form = trigger.closest('form');
      row.remove();
      recalc(form);
      return;
    }
    if (action === 'confirm-order') {
      const result = await api(`/sales-orders/${id}/confirm`, { method: 'POST' });
      toast(`${result.order.number} confirmed and stock reserved.`);
      await render();
      return;
    }
    if (action === 'cancel-order') {
      const result = await api(`/sales-orders/${id}/cancel`, { method: 'POST' });
      toast(`${result.order.number} cancelled.`);
      await render();
      return;
    }
    if (action === 'invoice-order') {
      const result = await api(`/sales-orders/${id}/invoice`, { method: 'POST' });
      toast(`Invoice ${result.invoice.number} created for ${money(result.invoice.total)}.`);
      await render();
      return;
    }
    if (action === 'receive-po') {
      const result = await api(`/purchase-orders/${id}/receive`, { method: 'POST' });
      toast(`${result.order.number} received, stock updated.`);
      await render();
      return;
    }
  } catch (error) {
    toast(error.message, 'error');
  }
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

window.addEventListener('hashchange', render);
render();
