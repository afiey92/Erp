export function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asInt(value) {
  const parsed = asNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function todayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function buildLines(store, rawItems, priceField) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) throw httpError(400, 'Add at least one line item.');

  return items.map((raw) => {
    const product = store.find('products', raw?.productId);
    if (!product) throw httpError(400, `Unknown product ${raw?.productId}.`);

    const qty = asInt(raw?.qty);
    if (qty === null || qty <= 0) throw httpError(400, 'Quantity must be a positive whole number.');

    const fallback = priceField === 'unitCost' ? product.cost : product.unitPrice;
    const rawPrice = raw?.[priceField];
    const price = asNumber(rawPrice === undefined || rawPrice === null || rawPrice === '' ? fallback : rawPrice);
    if (price === null || price < 0) throw httpError(400, 'Price must be a number of zero or more.');

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      qty,
      [priceField]: round(price),
      lineTotal: round(price * qty),
    };
  });
}
