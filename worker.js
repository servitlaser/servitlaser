// Cloudflare Worker — serve o site estático (via ASSETS) e trata do
// checkout da Stripe no caminho /create-checkout-session.
//
// A chave secreta do Stripe NUNCA vai neste ficheiro. Fica guardada como
// "Secret" nas definições do projeto no Cloudflare:
// Workers & Pages > (o teu projeto) > Settings > Variables and Secrets > Add
//   Nome:  STRIPE_SECRET_KEY
//   Valor: a tua chave sk_test_... (ou sk_live_... quando fores para produção)
//   Tipo:  Secret (encrypted)

// Preços oficiais — nunca confiar no preço que vem do browser, só na
// quantidade e no nome do produto. Se mudares um preço no site, muda aqui também.
const PRODUCTS = {
  'Bookmark': 6.00,
  'Card Box': 10.00,
  'Keychain': 6.90,
};

// Mesma regra de portes que está no script.js do site.
function getShippingCost(totalQty) {
  if (totalQty > 10) return null; // bloqueado
  if (totalQty > 5) return 9.90;
  return 7.90;
}

// Converte um objeto/array JS na notação de colchetes que a API da Stripe
// espera (ex: line_items[0][price_data][unit_amount]=600).
function addParam(params, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach(function (v, i) { addParam(params, key + '[' + i + ']', v); });
  } else if (typeof value === 'object') {
    Object.keys(value).forEach(function (k) { addParam(params, key + '[' + k + ']', value[k]); });
  } else {
    params.append(key, String(value));
  }
}

async function createCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe is not configured yet.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cart = Array.isArray(body.cart) ? body.cart : [];
  if (cart.length === 0) {
    return new Response(JSON.stringify({ error: 'Your cart is empty.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const totalQty = cart.reduce(function (sum, item) { return sum + (Number(item.qty) || 0); }, 0);
  const shippingCost = getShippingCost(totalQty);
  if (shippingCost === null) {
    return new Response(JSON.stringify({ error: 'This order has more than 10 items. Please contact us at info@servitlaser.com for a shipping quote.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let line_items;
  try {
    line_items = cart.map(function (item) {
      const unitPrice = PRODUCTS[item.name];
      if (unitPrice === undefined) {
        throw new Error('Unknown product: ' + item.name);
      }
      const qty = Math.max(1, Number(item.qty) || 1);
      const product_data = { name: item.name };
      if (item.note) {
        product_data.description = 'Engraving: ' + String(item.note).slice(0, 200);
      }
      return {
        price_data: {
          currency: 'eur',
          product_data: product_data,
          unit_amount: Math.round(unitPrice * 100),
        },
        quantity: qty,
      };
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  line_items.push({
    price_data: {
      currency: 'eur',
      product_data: { name: 'Shipping (Posti, Finland)' },
      unit_amount: Math.round(shippingCost * 100),
    },
    quantity: 1,
  });

  const origin = new URL(request.url).origin;

  const payload = {
    mode: 'payment',
    ui_mode: 'hosted_page',
    locale: 'en',
    line_items: line_items,
    success_url: origin + '/success.html',
    cancel_url: origin + '/index.html',
    billing_address_collection: 'auto',
    shipping_address_collection: { allowed_countries: ['FI'] },
  };

  const params = new URLSearchParams();
  Object.keys(payload).forEach(function (key) { addParam(params, key, payload[key]); });

  try {
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      const message = (session.error && session.error.message) ? session.error.message : 'Stripe error.';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Confirma que o pedido veio mesmo da Stripe (evita que alguém envie
// pedidos falsos para o nosso webhook fingindo ser a Stripe).
async function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = {};
  signatureHeader.split(',').forEach(function (part) {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    parts[part.slice(0, idx)] = part.slice(idx + 1);
  });
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Rejeita pedidos com mais de 5 minutos (proteção contra reenvios antigos).
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) return false;

  const signedPayload = timestamp + '.' + payload;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');

  return expectedSignature === signature;
}

// Número sequencial da encomenda, guardado na KV (ORDERS_KV). Cada chamada
// lê o último número, soma 1 e grava logo o novo valor.
// Nota: como o volume de encomendas é muito baixo, não há proteção contra
// duas encomendas em simultâneo (seria preciso um Durable Object para isso),
// mas na prática não deve acontecer.
async function getNextOrderNumber(env) {
  if (!env.ORDERS_KV) return null;
  const current = await env.ORDERS_KV.get('order_counter');
  const next = (parseInt(current, 10) || 0) + 1;
  await env.ORDERS_KV.put('order_counter', String(next));
  return next;
}

// Vai buscar os artigos da encomenda (com as gravações) e envia o email
// com tudo o que é preciso para preparar a encomenda.
async function sendOrderEmail(session, env) {
  const orderNumber = await getNextOrderNumber(env);
  const lineItemsResponse = await fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + session.id + '/line_items?expand[]=data.price.product',
    { headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } }
  );
  const lineItemsData = await lineItemsResponse.json();
  const items = Array.isArray(lineItemsData.data) ? lineItemsData.data : [];

  const lines = items.map(function (item) {
    const name = item.description || 'Item';
    const qty = item.quantity || 1;
    const amount = ((item.amount_total || 0) / 100).toFixed(2).replace('.', ',');
    const note = (item.price && item.price.product && item.price.product.description) ? item.price.product.description : '';
    return '- ' + name + ' x' + qty + ' — €' + amount + (note ? ' (' + note + ')' : '');
  }).join('\n');

  const customerName = (session.customer_details && session.customer_details.name) || 'N/A';
  const customerEmail = (session.customer_details && session.customer_details.email) || 'N/A';
  const shipping = session.shipping_details || session.customer_details || {};
  const address = shipping.address || {};
  const addressLines = [
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(' '),
    address.country,
  ].filter(Boolean).join('\n');

  const total = ((session.amount_total || 0) / 100).toFixed(2).replace('.', ',');

  const orderLabel = orderNumber ? ('Order #' + orderNumber) : 'New order';

  const body =
    orderLabel + ' received!\n\n' +
    'Customer: ' + customerName + ' (' + customerEmail + ')\n\n' +
    'Shipping address:\n' + (addressLines || 'N/A') + '\n\n' +
    'Items:\n' + (lines || 'N/A') + '\n\n' +
    'Total: €' + total;

  await env.EMAIL.send({
    from: 'orders@servitlaser.com',
    to: 'servitlaser@gmail.com',
    subject: orderLabel + ' - SerVit Laser (€' + total + ')',
    text: body,
  });
}

async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook not configured.', { status: 500 });
  }

  const signature = request.headers.get('Stripe-Signature');
  const payload = await request.text();

  const isValid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return new Response('Invalid signature.', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch (err) {
    return new Response('Invalid JSON.', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    try {
      await sendOrderEmail(event.data.object, env);
    } catch (err) {
      // Não falha a confirmação à Stripe só porque o email correu mal —
      // a encomenda continua válida, só o aviso é que pode não ter chegado.
    }
  }

  return new Response('OK', { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/create-checkout-session' && request.method === 'POST') {
      return createCheckoutSession(request, env);
    }
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
