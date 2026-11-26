import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';

async function startServer() {
  const store = new Store(null);
  const app = createApp(store);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '0.0.0.0', () => resolve(instance));
  });
  const { port } = server.address();
  return {
    store,
    url: `http://127.0.0.1:${port}`,
    async get(path) {
      const response = await fetch(`${this.url}${path}`);
      return { status: response.status, body: await response.json() };
    },
    async send(method, path, body) {
      const response = await fetch(`${this.url}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    post(path, body) {
      return this.send('POST', path, body);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function productStock(app, sku) {
  return app.store.data.products.find((product) => product.sku === sku).stock;
}

test('health endpoint reports the service', async () => {
  const app = await startServer();
  try {
    const response = await app.get('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok', service: 'meog-erp' });
  } finally {
    await app.close();
  }
});

test('dashboard summarises revenue, receivables and stock value', async () => {
  const app = await startServer();
  try {
    const { status, body } = await app.get('/api/dashboard');
    assert.equal(status, 200);
    assert.equal(body.stats.revenue, 160);
    assert.equal(body.stats.outstanding, 75);
    assert.equal(body.stats.productCount, 6);
    assert.equal(body.stats.customerCount, 3);
    assert.equal(body.stats.supplierCount, 2);
    assert.equal(body.stats.stockValue, 7469);
    assert.equal(body.stats.lowStockCount, 1);
    assert.equal(body.trend.length, 7);
    assert.equal(body.topProducts[0].sku, 'MEG-1001');
    assert.equal(body.openInvoices[0].number, 'INV-0001');

    const summary = await app.get('/api/summary');
    assert.equal(summary.body.stats.productCount, 6);
    assert.equal(summary.body.stats.revenue, 160);
  } finally {
    await app.close();
  }
});

test('creates products, rejects duplicate SKUs and records stock adjustments', async () => {
  const app = await startServer();
  try {
    const created = await app.post('/api/products', {
      sku: 'MEG-2001',
      name: 'Conveyor Roller',
      unitPrice: 19.99,
      cost: 12,
      stock: 40,
      reorderPoint: 10,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.product.sku, 'MEG-2001');
    assert.equal(created.body.product.stock, 40);

    const ledger = await app.get(`/api/stock-movements?productId=${created.body.product.id}`);
    assert.equal(ledger.body.stockMovements[0].type, 'opening');
    assert.equal(ledger.body.stockMovements[0].balanceAfter, 40);

    const duplicate = await app.post('/api/products', { sku: 'meg-2001', name: 'Dupe', unitPrice: 1 });
    assert.equal(duplicate.status, 409);

    const invalid = await app.post('/api/products', { sku: '', name: '', unitPrice: -1 });
    assert.equal(invalid.status, 400);

    const adjusted = await app.post(`/api/products/${created.body.product.id}/adjust`, {
      qty: -5,
      reason: 'Damaged in transit',
    });
    assert.equal(adjusted.status, 201);
    assert.equal(adjusted.body.product.stock, 35);
    assert.equal(adjusted.body.movement.qty, -5);
    assert.equal(adjusted.body.movement.reference, 'Damaged in transit');

    const tooLow = await app.post(`/api/products/${created.body.product.id}/adjust`, { qty: -500 });
    assert.equal(tooLow.status, 400);
    assert.equal(app.store.data.products.find((row) => row.sku === 'MEG-2001').stock, 35);
  } finally {
    await app.close();
  }
});

test('creates customers and suppliers with email validation', async () => {
  const app = await startServer();
  try {
    const customer = await app.post('/api/customers', { name: 'Harbour Logistics', email: 'desk@harbour.example' });
    assert.equal(customer.status, 201);

    const badCustomer = await app.post('/api/customers', { name: 'Bad Email', email: 'nope' });
    assert.equal(badCustomer.status, 400);

    const supplier = await app.post('/api/suppliers', { name: 'Nordic Seals', email: 'sales@nordic.example' });
    assert.equal(supplier.status, 201);
    assert.equal(supplier.body.supplier.name, 'Nordic Seals');

    const badSupplier = await app.post('/api/suppliers', { name: 'No Email', email: 'bad' });
    assert.equal(badSupplier.status, 400);
  } finally {
    await app.close();
  }
});

test('a sales order reserves stock only when it is confirmed', async () => {
  const app = await startServer();
  try {
    const draft = await app.post('/api/sales-orders', {
      customerId: 1,
      taxRate: 10,
      items: [{ productId: 1, qty: 2, unitPrice: 12.5 }],
    });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.order.status, 'draft');
    assert.equal(draft.body.order.number, 'SO-0003');
    assert.equal(draft.body.order.subtotal, 25);
    assert.equal(draft.body.order.tax, 2.5);
    assert.equal(draft.body.order.total, 27.5);
    assert.equal(productStock(app, 'MEG-1001'), 240, 'draft orders must not touch stock');

    const confirmed = await app.post(`/api/sales-orders/${draft.body.order.id}/confirm`, {});
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.order.status, 'confirmed');
    assert.equal(productStock(app, 'MEG-1001'), 238);

    const movements = await app.get('/api/stock-movements?productId=1');
    assert.equal(movements.body.stockMovements[0].type, 'sale');
    assert.equal(movements.body.stockMovements[0].qty, -2);
    assert.equal(movements.body.stockMovements[0].reference, 'SO-0003');

    const again = await app.post(`/api/sales-orders/${draft.body.order.id}/confirm`, {});
    assert.equal(again.status, 409);
  } finally {
    await app.close();
  }
});

test('sales orders reject unknown customers, empty lines and insufficient stock', async () => {
  const app = await startServer();
  try {
    const unknownCustomer = await app.post('/api/sales-orders', {
      customerId: 999,
      items: [{ productId: 1, qty: 1 }],
    });
    assert.equal(unknownCustomer.status, 400);

    const emptyLines = await app.post('/api/sales-orders', { customerId: 1, items: [] });
    assert.equal(emptyLines.status, 400);

    const tooMany = await app.post('/api/sales-orders', {
      customerId: 1,
      items: [{ productId: 3, qty: 500 }],
    });
    assert.equal(tooMany.status, 201, 'the draft is accepted');

    const confirm = await app.post(`/api/sales-orders/${tooMany.body.order.id}/confirm`, {});
    assert.equal(confirm.status, 409);
    assert.match(confirm.body.error, /Insufficient stock/);
    assert.equal(productStock(app, 'MEG-1003'), 18, 'stock must not change when confirmation fails');
  } finally {
    await app.close();
  }
});

test('draft sales orders can be cancelled but confirmed ones cannot', async () => {
  const app = await startServer();
  try {
    const draft = await app.post('/api/sales-orders', {
      customerId: 2,
      items: [{ productId: 5, qty: 1 }],
    });
    const cancelled = await app.post(`/api/sales-orders/${draft.body.order.id}/cancel`, {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.order.status, 'cancelled');

    const confirmedCancel = await app.post('/api/sales-orders/2/cancel', {});
    assert.equal(confirmedCancel.status, 409);
  } finally {
    await app.close();
  }
});

test('invoicing a confirmed order tracks payments until it is paid', async () => {
  const app = await startServer();
  try {
    const draft = await app.post('/api/sales-orders', {
      customerId: 1,
      items: [{ productId: 2, qty: 1, unitPrice: 34 }],
    });
    await app.post(`/api/sales-orders/${draft.body.order.id}/confirm`, {});

    const invoice = await app.post(`/api/sales-orders/${draft.body.order.id}/invoice`, {});
    assert.equal(invoice.status, 201);
    assert.equal(invoice.body.invoice.number, 'INV-0002');
    assert.equal(invoice.body.invoice.balance, 34);
    assert.equal(invoice.body.invoice.status, 'open');
    assert.equal(invoice.body.order.status, 'invoiced');

    const notConfirmed = await app.post('/api/sales-orders/1/invoice', {});
    assert.equal(notConfirmed.status, 409);

    const partial = await app.post(`/api/invoices/${invoice.body.invoice.id}/payments`, { amount: 10 });
    assert.equal(partial.status, 201);
    assert.equal(partial.body.invoice.status, 'partial');
    assert.equal(partial.body.invoice.balance, 24);

    const overpay = await app.post(`/api/invoices/${invoice.body.invoice.id}/payments`, { amount: 100 });
    assert.equal(overpay.status, 400);

    const settled = await app.post(`/api/invoices/${invoice.body.invoice.id}/payments`, { amount: 24 });
    assert.equal(settled.status, 201);
    assert.equal(settled.body.invoice.status, 'paid');
    assert.equal(settled.body.invoice.balance, 0);

    const order = await app.get(`/api/sales-orders/${draft.body.order.id}`);
    assert.equal(order.body.order.status, 'paid');
  } finally {
    await app.close();
  }
});

test('receiving a purchase order adds stock and updates the unit cost', async () => {
  const app = await startServer();
  try {
    const created = await app.post('/api/purchase-orders', {
      supplierId: 2,
      items: [{ productId: 2, qty: 10, unitCost: 20 }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.order.total, 200);
    assert.equal(created.body.order.status, 'draft');

    const received = await app.post(`/api/purchase-orders/${created.body.order.id}/receive`, {});
    assert.equal(received.status, 200);
    assert.equal(received.body.order.status, 'received');

    const product = app.store.data.products.find((row) => row.sku === 'MEG-1002');
    assert.equal(product.stock, 95);
    assert.equal(product.cost, 20);

    const again = await app.post(`/api/purchase-orders/${created.body.order.id}/receive`, {});
    assert.equal(again.status, 409);
    assert.equal(product.stock, 95, 'receiving twice must not duplicate stock');
  } finally {
    await app.close();
  }
});

test('sales and inventory reports aggregate the confirmed orders', async () => {
  const app = await startServer();
  try {
    const sales = await app.get('/api/reports/sales');
    assert.equal(sales.status, 200);
    assert.equal(sales.body.totals.orderCount, 2);
    assert.equal(sales.body.totals.revenue, 160);
    assert.equal(sales.body.byCustomer[0].revenue, 125);
    assert.equal(sales.body.byProduct.length, 2);

    const inventory = await app.get('/api/reports/inventory');
    assert.equal(inventory.status, 200);
    assert.equal(inventory.body.totals.units, 553);
    assert.equal(inventory.body.totals.stockValue, 7469);
    assert.equal(inventory.body.totals.lowStockCount, 1);

    const emptyRange = await app.get('/api/reports/sales?from=2000-01-01&to=2000-01-31');
    assert.equal(emptyRange.body.totals.revenue, 0);
  } finally {
    await app.close();
  }
});

test('unknown API endpoints return a JSON 404', async () => {
  const app = await startServer();
  try {
    const response = await app.get('/api/does-not-exist');
    assert.equal(response.status, 404);
    assert.match(response.body.error, /Unknown API endpoint/);
  } finally {
    await app.close();
  }
});
