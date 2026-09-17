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
      // A chave da imagem é sempre gerada por nós no /upload-image (um UUID),
      // por isso validamos o formato em vez de confiar cegamente no que vem do browser.
      if (item.imageKey && /^[0-9a-f-]{20,80}\.[a-z0-9]{2,5}$/i.test(item.imageKey)) {
        product_data.metadata = { image_key: item.imageKey };
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

// Recebe uma imagem enviada por um cliente (para gravar numa peça) e
// guarda-a temporariamente na KV (ORDERS_KV, mesma que já tens) com um
// nome aleatório. Expira ao fim de 30 dias — só precisa de durar até a
// encomenda ser paga e o email sair. Devolve a chave, que o browser depois
// anexa ao artigo do carrinho.
async function handleImageUpload(request, env) {
  if (!env.ORDERS_KV) {
    return new Response(JSON.stringify({ error: 'Image uploads are not configured yet.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType = request.headers.get('Content-Type') || '';
  const extensionByType = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
  };
  const extension = extensionByType[contentType];
  if (!extension) {
    return new Response(JSON.stringify({ error: 'Unsupported file type. Please upload a JPG, PNG, WEBP, SVG or PDF.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Limite baixo de propósito: a imagem vai como anexo de email, e a
  // Cloudflare recusa mensagens com mais de 5 MB (já a contar com o anexo).
  const maxBytes = 3 * 1024 * 1024;
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > maxBytes) {
    return new Response(JSON.stringify({ error: 'File is too large (max 3 MB, so it can be emailed as an attachment).' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const originalName = (new URL(request.url).searchParams.get('name') || ('engraving.' + extension)).slice(0, 100);
  const key = crypto.randomUUID() + '.' + extension;

  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      return new Response(JSON.stringify({ error: 'File is too large (max 3 MB, so it can be emailed as an attachment).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    await env.ORDERS_KV.put('upload:' + key, bytes, {
      metadata: { contentType: contentType, filename: originalName },
      expirationTtl: 60 * 60 * 24 * 30,
    });
    console.log('Upload guardado: upload:' + key + ' — ' + bytes.byteLength + ' bytes, tipo ' + contentType);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upload failed. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ key: key }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Converte bytes (a imagem lida da KV) para texto base64. Construído byte a
// byte, com a tabela RFC 4648, para não depender de truques como
// String.fromCharCode.apply/btoa que podem comportar-se mal com ficheiros
// maiores em alguns motores JavaScript.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result += chars[(chunk >> 18) & 63] + chars[(chunk >> 12) & 63] + chars[(chunk >> 6) & 63] + chars[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    result += chars[(chunk >> 18) & 63] + chars[(chunk >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result += chars[(chunk >> 18) & 63] + chars[(chunk >> 12) & 63] + chars[(chunk >> 6) & 63] + '=';
  }
  return result;
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

// Vai buscar os artigos da encomenda (com as gravações) e monta os dados
// comuns aos dois emails (interno e do cliente).
async function buildOrderDetails(session, env) {
  const lineItemsResponse = await fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + session.id + '/line_items?expand[]=data.price.product',
    { headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } }
  );
  const lineItemsData = await lineItemsResponse.json();
  const items = Array.isArray(lineItemsData.data) ? lineItemsData.data : [];

  const lineTexts = [];
  const attachments = [];

  for (const item of items) {
    const name = item.description || 'Item';
    const qty = item.quantity || 1;
    const amount = ((item.amount_total || 0) / 100).toFixed(2).replace('.', ',');
    const note = (item.price && item.price.product && item.price.product.description) ? item.price.product.description : '';
    const imageKey = (item.price && item.price.product && item.price.product.metadata) ? item.price.product.metadata.image_key : null;

    let imageNote = '';
    if (imageKey && env.ORDERS_KV) {
      try {
        const stored = await env.ORDERS_KV.getWithMetadata('upload:' + imageKey, 'arrayBuffer');
        console.log('KV lookup upload:' + imageKey + ' → ' + (stored && stored.value ? (stored.value.byteLength + ' bytes encontrados') : 'NADA encontrado'));
        if (stored && stored.value) {
          const meta = stored.metadata || {};
          const filename = meta.filename || imageKey;
          const base64 = arrayBufferToBase64(stored.value);
          console.log('Anexo pronto: ' + filename + ', tipo ' + (meta.contentType || '?') + ', base64 com ' + base64.length + ' caracteres');
          attachments.push({
            content: base64,
            filename: filename,
            type: meta.contentType || 'application/octet-stream',
            disposition: 'attachment',
          });
          imageNote = ' [image attached: ' + filename + ']';
        }
      } catch (err) {
        console.error('Erro ao ir buscar a imagem à KV: ' + err.message);
      }
    }

    lineTexts.push('- ' + name + ' x' + qty + ' — €' + amount + (note ? ' (' + note + ')' : '') + imageNote);
  }

  const lines = lineTexts.join('\n');

  const customerName = (session.customer_details && session.customer_details.name) || 'N/A';
  const customerEmail = (session.customer_details && session.customer_details.email) || null;
  const shipping = session.shipping_details || session.customer_details || {};
  const address = shipping.address || {};
  const addressLines = [
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(' '),
    address.country,
  ].filter(Boolean).join('\n');

  const total = ((session.amount_total || 0) / 100).toFixed(2).replace('.', ',');

  return { lines: lines, customerName: customerName, customerEmail: customerEmail, addressLines: addressLines, total: total, attachments: attachments };
}

// Email interno — para o teu Gmail, com os dados para preparares a encomenda.
// Vai pelo binding EMAIL da Cloudflare (só pode enviar para o teu próprio
// endereço verificado).
async function sendOrderEmail(details, orderNumber, env) {
  const orderLabel = orderNumber ? ('Order #' + orderNumber) : 'New order';

  const body =
    orderLabel + ' received!\n\n' +
    'Customer: ' + details.customerName + ' (' + (details.customerEmail || 'N/A') + ')\n\n' +
    'Shipping address:\n' + (details.addressLines || 'N/A') + '\n\n' +
    'Items:\n' + (details.lines || 'N/A') + '\n\n' +
    'Total: €' + details.total;

  const payload = {
    from: 'orders@servitlaser.com',
    to: 'servitlaser@gmail.com',
    subject: orderLabel + ' - SerVit Laser (€' + details.total + ')',
    text: body,
  };
  if (details.attachments && details.attachments.length > 0) {
    payload.attachments = details.attachments;
  }

  await env.EMAIL.send(payload);
}

// Email de confirmação para o cliente, enviado via Resend — o binding EMAIL
// da Cloudflare não permite enviar para endereços de clientes (só para
// endereços verificados na nossa própria conta).
async function sendCustomerConfirmationEmail(details, orderNumber, env) {
  if (!details.customerEmail) return;
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY não está definido — email do cliente não foi enviado.');
    return;
  }

  const orderLabel = orderNumber ? ('Order #' + orderNumber) : 'Your order';

  const body =
    'Thank you for your order, ' + details.customerName + '!\n\n' +
    orderLabel + ' — SerVit Laser\n\n' +
    'Items:\n' + (details.lines || 'N/A') + '\n\n' +
    'Shipping address:\n' + (details.addressLines || 'N/A') + '\n\n' +
    'Total: €' + details.total + '\n\n' +
    'We will ship your order via Posti soon. Questions? Just reply to this email or contact info@servitlaser.com.';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SerVit Laser <info@servitlaser.com>',
      to: details.customerEmail,
      subject: orderLabel + ' confirmed - SerVit Laser',
      text: body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Resend recusou o envio (' + response.status + '): ' + errorText);
  }
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
    const session = event.data.object;
    const orderNumber = await getNextOrderNumber(env);
    let details = null;
    try {
      details = await buildOrderDetails(session, env);
    } catch (err) {
      // Sem os detalhes não dá para enviar nenhum dos dois emails.
    }
    if (details) {
      try {
        await sendOrderEmail(details, orderNumber, env);
      } catch (err) {
        // Não falha a confirmação à Stripe só porque o email interno correu
        // mal — a encomenda continua válida.
      }
      try {
        await sendCustomerConfirmationEmail(details, orderNumber, env);
      } catch (err) {
        // Idem: um problema no email do cliente não deve travar o webhook.
      }
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
    if (url.pathname === '/upload-image' && request.method === 'POST') {
      return handleImageUpload(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
