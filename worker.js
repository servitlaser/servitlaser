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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/create-checkout-session' && request.method === 'POST') {
      return createCheckoutSession(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
