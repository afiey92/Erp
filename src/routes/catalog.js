import { Router } from 'express';
import { LOW_STOCK_THRESHOLD } from '../store.js';
import { asInt, asNumber, asText, httpError, isEmail, round } from '../util.js';

function requireProduct(store, id) {
  const product = store.find('products', id);
  if (!product) throw httpError(404, 'Product not found.');
  return product;
}

export function catalogRoutes(store) {
  const router = Router();

  router.get('/products', (req, res) => {
    const search = asText(req.query.search).toLowerCase();
    const products = store.data.products.filter((product) => {
      if (!search) return true;
      return `${product.sku} ${product.name} ${product.category ?? ''}`.toLowerCase().includes(search);
    });
    res.json({ products, lowStockThreshold: LOW_STOCK_THRESHOLD });
  });

  router.post('/products', (req, res) => {
    const body = req.body ?? {};
    const sku = asText(body.sku);
    const name = asText(body.name);
    const unitPrice = asNumber(body.unitPrice);
    const cost = asNumber(body.cost ?? 0);
    const stock = asInt(body.stock ?? 0);
    const reorderPoint = asInt(body.reorderPoint ?? LOW_STOCK_THRESHOLD);

    if (!sku || !name) throw httpError(400, 'SKU and name are required.');
    if (unitPrice === null || unitPrice < 0) {
      throw httpError(400, 'Unit price must be a number of zero or more.');
    }
    if (cost === null || cost < 0) throw httpError(400, 'Unit cost must be a number of zero or more.');
    if (stock === null || stock < 0) throw httpError(400, 'Stock must be a whole number of zero or more.');
    if (reorderPoint === null || reorderPoint < 0) {
      throw httpError(400, 'Reorder point must be a whole number of zero or more.');
    }
    if (store.data.products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
      throw httpError(409, `SKU ${sku} already exists.`);
    }

    const product = store.insert('products', {
      sku,
      name,
      category: asText(body.category),
      unitPrice: round(unitPrice),
      cost: round(cost),
      stock,
      reorderPoint,
    });

    if (stock > 0) {
      store.insert('stockMovements', {
        productId: product.id,
        sku: product.sku,
        type: 'opening',
        qty: stock,
        balanceAfter: stock,
        reference: 'Opening balance',
        at: new Date().toISOString(),
      });
    }

    store.persist();
    res.status(201).json({ product });
  });

  router.patch('/products/:id', (req, res) => {
    const product = requireProduct(store, req.params.id);
    const body = req.body ?? {};

    if (body.name !== undefined) {
      const name = asText(body.name);
      if (!name) throw httpError(400, 'Product name is required.');
      product.name = name;
    }
    if (body.category !== undefined) product.category = asText(body.category);
    if (body.unitPrice !== undefined) {
      const unitPrice = asNumber(body.unitPrice);
      if (unitPrice === null || unitPrice < 0) throw httpError(400, 'Unit price must be zero or more.');
      product.unitPrice = round(unitPrice);
    }
    if (body.cost !== undefined) {
      const cost = asNumber(body.cost);
      if (cost === null || cost < 0) throw httpError(400, 'Unit cost must be zero or more.');
      product.cost = round(cost);
    }
    if (body.reorderPoint !== undefined) {
      const reorderPoint = asInt(body.reorderPoint);
      if (reorderPoint === null || reorderPoint < 0) throw httpError(400, 'Reorder point must be zero or more.');
      product.reorderPoint = reorderPoint;
    }

    store.persist();
    res.json({ product });
  });

  router.post('/products/:id/adjust', (req, res) => {
    const product = requireProduct(store, req.params.id);
    const body = req.body ?? {};
    const qty = asInt(body.qty);

    if (qty === null || qty === 0) {
      throw httpError(400, 'Adjustment quantity must be a non-zero whole number.');
    }
    const next = product.stock + qty;
    if (next < 0) {
      throw httpError(400, `Adjustment would leave negative stock (${product.stock} available).`);
    }

    product.stock = next;
    const movement = store.insert('stockMovements', {
      productId: product.id,
      sku: product.sku,
      type: 'adjustment',
      qty,
      balanceAfter: next,
      reference: asText(body.reason) || 'Manual adjustment',
      at: new Date().toISOString(),
    });
    store.persist();
    res.status(201).json({ product, movement });
  });

  router.get('/customers', (req, res) => {
    res.json({ customers: store.data.customers });
  });

  router.post('/customers', (req, res) => {
    const body = req.body ?? {};
    const name = asText(body.name);
    const email = asText(body.email);

    if (!name) throw httpError(400, 'Customer name is required.');
    if (email && !isEmail(email)) throw httpError(400, 'Email address is not valid.');

    const customer = store.insert('customers', {
      name,
      email,
      phone: asText(body.phone),
      city: asText(body.city),
    });
    store.persist();
    res.status(201).json({ customer });
  });

  router.get('/suppliers', (req, res) => {
    res.json({ suppliers: store.data.suppliers });
  });

  router.post('/suppliers', (req, res) => {
    const body = req.body ?? {};
    const name = asText(body.name);
    const email = asText(body.email);

    if (!name) throw httpError(400, 'Supplier name is required.');
    if (email && !isEmail(email)) throw httpError(400, 'Email address is not valid.');

    const supplier = store.insert('suppliers', { name, email, phone: asText(body.phone) });
    store.persist();
    res.status(201).json({ supplier });
  });

  return router;
}
