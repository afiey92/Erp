import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { LOW_STOCK_THRESHOLD } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

function round(value) {
  return Math.round(value * 100) / 100;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createApp(store) {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'meog-erp' });
  });

  app.get('/api/products', (req, res) => {
    res.json({ products: store.data.products });
  });

  app.post('/api/products', (req, res) => {
    const body = req.body ?? {};
    const sku = asText(body.sku);
    const name = asText(body.name);
    const unitPrice = asNumber(body.unitPrice);
    const stock = asNumber(body.stock ?? 0);

    if (!sku || !name) {
      return res.status(400).json({ error: 'SKU and name are required.' });
    }
    if (unitPrice === null || unitPrice < 0) {
      return res.status(400).json({ error: 'Unit price must be a number of zero or more.' });
    }
    if (stock === null || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({ error: 'Stock must be a whole number of zero or more.' });
    }
    if (store.data.products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
      return res.status(409).json({ error: `SKU ${sku} already exists.` });
    }

    const product = { id: store.nextId('products'), sku, name, unitPrice: round(unitPrice), stock };
    store.data.products.push(product);
    store.persist();
    return res.status(201).json({ product });
  });

  app.get('/api/customers', (req, res) => {
    res.json({ customers: store.data.customers });
  });

  app.post('/api/customers', (req, res) => {
    const body = req.body ?? {};
    const name = asText(body.name);
    const email = asText(body.email);

    if (!name) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email address is not valid.' });
    }

    const customer = { id: store.nextId('customers'), name, email };
    store.data.customers.push(customer);
    store.persist();
    return res.status(201).json({ customer });
  });

  app.get('/api/orders', (req, res) => {
    res.json({ orders: store.data.orders });
  });

  app.post('/api/orders', (req, res) => {
    const body = req.body ?? {};
    const customerId = asNumber(body.customerId);
    const rawItems = Array.isArray(body.items) ? body.items : [];

    const customer = store.data.customers.find((row) => row.id === customerId);
    if (!customer) {
      return res.status(400).json({ error: 'Choose an existing customer for the order.' });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'An order needs at least one line item.' });
    }

    const lines = [];
    for (const rawItem of rawItems) {
      const product = store.data.products.find((row) => row.id === asNumber(rawItem?.productId));
      const qty = asNumber(rawItem?.qty);

      if (!product) {
        return res.status(400).json({ error: `Unknown product ${rawItem?.productId}.` });
      }
      if (qty === null || qty <= 0 || !Number.isInteger(qty)) {
        return res.status(400).json({ error: 'Quantity must be a positive whole number.' });
      }
      if (product.stock < qty) {
        return res.status(400).json({
          error: `Insufficient stock for ${product.sku}: ${product.stock} available, ${qty} requested.`,
        });
      }
      lines.push({ product, qty });
    }

    const order = {
      id: store.nextId('orders'),
      customerId: customer.id,
      customerName: customer.name,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      total: 0,
      items: [],
    };

    for (const { product, qty } of lines) {
      product.stock -= qty;
      order.items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        qty,
        unitPrice: product.unitPrice,
        lineTotal: round(product.unitPrice * qty),
      });
    }

    order.total = round(order.items.reduce((sum, line) => sum + line.lineTotal, 0));
    store.data.orders.push(order);
    store.persist();
    return res.status(201).json({ order });
  });

  app.get('/api/summary', (req, res) => {
    const { products, customers, orders } = store.data;
    const lowStock = products.filter((product) => product.stock <= LOW_STOCK_THRESHOLD);

    res.json({
      products,
      customers,
      orders,
      lowStock,
      stats: {
        productCount: products.length,
        customerCount: customers.length,
        orderCount: orders.length,
        revenue: round(orders.reduce((sum, order) => sum + order.total, 0)),
        lowStockCount: lowStock.length,
      },
    });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error?.status === 400 ? 400 : 500;
    const message = status === 400 ? 'Request body is not valid JSON.' : 'Unexpected server error.';
    return res.status(status).json({ error: message });
  });

  return app;
}
