import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';

async function startServer() {
  const store = new Store(null);
  const app = createApp(store);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  return {
    store,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('health endpoint reports the service', async () => {
  const app = await startServer();
  try {
    const response = await fetch(`${app.url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'meog-erp' });
  } finally {
    await app.close();
  }
});

test('summary exposes seeded inventory, customers and stats', async () => {
  const app = await startServer();
  try {
    const response = await fetch(`${app.url}/api/summary`);
    const summary = await response.json();
    assert.equal(response.status, 200);
    assert.equal(summary.stats.productCount, 3);
    assert.equal(summary.stats.customerCount, 2);
    assert.equal(summary.stats.orderCount, 0);
    assert.equal(summary.stats.revenue, 0);
    assert.equal(summary.stats.lowStockCount, 1);
  } finally {
    await app.close();
  }
});

test('creates products and rejects duplicate SKUs', async () => {
  const app = await startServer();
  try {
    const created = await post(`${app.url}/api/products`, {
      sku: 'MEG-2001',
      name: 'Conveyor Roller',
      unitPrice: 19.99,
      stock: 40,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.product.sku, 'MEG-2001');
    assert.equal(created.body.product.stock, 40);

    const duplicate = await post(`${app.url}/api/products`, {
      sku: 'meg-2001',
      name: 'Duplicate',
      unitPrice: 1,
      stock: 1,
    });
    assert.equal(duplicate.status, 409);

    const invalid = await post(`${app.url}/api/products`, { sku: '', name: '', unitPrice: -1 });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});

test('creates customers and validates the email address', async () => {
  const app = await startServer();
  try {
    const created = await post(`${app.url}/api/customers`, {
      name: 'Harbour Logistics',
      email: 'desk@harbour.example',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.customer.name, 'Harbour Logistics');

    const invalid = await post(`${app.url}/api/customers`, { name: 'Bad Email', email: 'nope' });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});

test('an order totals its lines and reduces stock', async () => {
  const app = await startServer();
  try {
    const before = app.store.data.products.find((product) => product.sku === 'MEG-1002');
    const result = await post(`${app.url}/api/orders`, {
      customerId: 1,
      items: [
        { productId: 2, qty: 5 },
        { productId: 1, qty: 4 },
      ],
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.order.total, 220);
    assert.equal(result.body.order.items.length, 2);
    assert.equal(result.body.order.status, 'confirmed');

    const after = app.store.data.products.find((product) => product.sku === 'MEG-1002');
    assert.equal(after.stock, before.stock - 5);

    const summary = await (await fetch(`${app.url}/api/summary`)).json();
    assert.equal(summary.stats.orderCount, 1);
    assert.equal(summary.stats.revenue, 220);
  } finally {
    await app.close();
  }
});

test('orders are rejected for unknown customers and insufficient stock', async () => {
  const app = await startServer();
  try {
    const unknownCustomer = await post(`${app.url}/api/orders`, {
      customerId: 999,
      items: [{ productId: 1, qty: 1 }],
    });
    assert.equal(unknownCustomer.status, 400);

    const emptyOrder = await post(`${app.url}/api/orders`, { customerId: 1, items: [] });
    assert.equal(emptyOrder.status, 400);

    const tooMany = await post(`${app.url}/api/orders`, {
      customerId: 1,
      items: [{ productId: 3, qty: 500 }],
    });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /Insufficient stock/);

    const product = app.store.data.products.find((row) => row.id === 3);
    assert.equal(product.stock, 18, 'stock must not change when the order is rejected');
    assert.equal(app.store.data.orders.length, 0);
  } finally {
    await app.close();
  }
});
