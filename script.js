  let cart = [];
  let cartIdCounter = 1;
  // Quanto cobrar a mais por gravar nos 2 lados, por produto. Quando
  // adicionares mais produtos, acrescenta aqui o valor certo para cada um.
  const DOUBLE_SIDED_SURCHARGES = {
    'Bookmark': 2.00,
    'Card Box': 2.00,
    'Keychain': 2.00,
  };
  const SHIPPING_RATE_STANDARD = 7.90;
  const SHIPPING_RATE_EXTENDED = 9.90;
  const SHIPPING_STANDARD_MAX_QTY = 5;
  const SHIPPING_EXTENDED_MAX_QTY = 10;
  function getShippingInfo(){
    const totalQty = cart.reduce(function(s,i){ return s + i.qty; }, 0);
    const blocked = totalQty > SHIPPING_EXTENDED_MAX_QTY;
    const cost = totalQty === 0 ? 0 : (totalQty > SHIPPING_STANDARD_MAX_QTY ? SHIPPING_RATE_EXTENDED : SHIPPING_RATE_STANDARD);
    return { blocked: blocked, totalQty: totalQty, cost: cost };
  }
  function goToProduct(url, event){
    if(event.target.closest('.dot')) return;
    window.location.href = url;
  }
  let lockedScrollY = 0;
  function lockScroll(){
    lockedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + lockedScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
  }
  function unlockScroll(){
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    window.scrollTo(0, lockedScrollY);
  }

  function toggleNav(){
    const nav = document.getElementById('mainNav');
    const willOpen = !nav.classList.contains('open');
    nav.classList.toggle('open');
    if(willOpen){ lockScroll(); } else { unlockScroll(); }
  }
  function toggleSearch(){
    const bar = document.getElementById('searchBar');
    bar.classList.toggle('open');
    if(bar.classList.contains('open')) document.getElementById('searchInput').focus();
  }
  document.getElementById('searchInput').addEventListener('input', function(e){
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.product-card').forEach(function(card){
      const name = (card.dataset.name||'').toLowerCase();
      card.style.display = name.includes(q) ? '' : 'none';
    });
  });

  function openCart(){
    document.getElementById('cartPanel').classList.add('open');
    document.getElementById('cartOverlay').classList.add('open');
    lockScroll();
  }
  function closeCart(){
    document.getElementById('cartPanel').classList.remove('open');
    document.getElementById('cartOverlay').classList.remove('open');
    unlockScroll();
  }
  // Guarda a imagem já carregada para cada produto (enquanto ainda não foi
  // adicionado ao carrinho), indexado pelo sufixo do produto (ex: "portachaves").
  const uploadedFiles = {};

  async function handleFileUpload(inputEl, productId){
    const file = inputEl.files && inputEl.files[0];
    const statusEl = document.getElementById('upload-status-' + productId);
    if(!file) return;
    const maxBytes = 3 * 1024 * 1024;
    if(file.size > maxBytes){
      statusEl.textContent = 'File is too large (max 3 MB).';
      statusEl.className = 'upload-status error';
      inputEl.value = '';
      delete uploadedFiles[productId];
      return;
    }
    statusEl.textContent = 'Uploading…';
    statusEl.className = 'upload-status';
    try {
      const response = await fetch('/upload-image?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await response.json();
      if(data.key){
        uploadedFiles[productId] = { key: data.key, name: file.name };
        statusEl.textContent = '✓ ' + file.name;
        statusEl.className = 'upload-status ok';
      } else {
        statusEl.textContent = data.error || 'Upload failed. Please try again.';
        statusEl.className = 'upload-status error';
        delete uploadedFiles[productId];
      }
    } catch(err){
      statusEl.textContent = 'Upload failed. Please try again.';
      statusEl.className = 'upload-status error';
      delete uploadedFiles[productId];
    }
  }

  function addToCart(name, price, engraveId, uploadId, doubleSidedId){
    let note = '';
    if(engraveId){
      const input = document.getElementById(engraveId);
      if(input){
        note = input.value.trim();
        input.value = '';
      }
    }
    let imageKey = null, imageName = null;
    if(uploadId && uploadedFiles[uploadId]){
      imageKey = uploadedFiles[uploadId].key;
      imageName = uploadedFiles[uploadId].name;
      delete uploadedFiles[uploadId];
      const fileInput = document.getElementById('upload-' + uploadId);
      if(fileInput) fileInput.value = '';
      const statusEl = document.getElementById('upload-status-' + uploadId);
      if(statusEl){ statusEl.textContent = 'No file selected'; statusEl.className = 'upload-status'; }
    }
    let doubleSided = false;
    let finalPrice = price;
    if(doubleSidedId){
      const toggle = document.getElementById(doubleSidedId);
      if(toggle && toggle.checked){
        doubleSided = true;
        finalPrice = price + (DOUBLE_SIDED_SURCHARGES[name] || 0);
        toggle.checked = false;
      }
    }
    const existing = cart.find(function(i){ return i.name === name && i.note === note && i.imageKey === imageKey && i.doubleSided === doubleSided; });
    if(existing){ existing.qty += 1; } else { cart.push({id:cartIdCounter++, name:name, price:finalPrice, qty:1, note:note, imageKey:imageKey, imageName:imageName, doubleSided:doubleSided}); }
    renderCart();
    openCart();
  }
  function removeFromCart(id){
    cart = cart.filter(function(i){ return i.id !== id; });
    renderCart();
  }
  function changeQty(id, delta){
    const item = cart.find(function(i){ return i.id === id; });
    if(!item) return;
    item.qty = Math.max(1, item.qty + delta);
    renderCart();
  }
  function renderCart(){
    const itemsEl = document.getElementById('cartItems');
    const countEl = document.getElementById('cartCount');
    const subtotalEl = document.getElementById('cartSubtotal');
    const shippingEl = document.getElementById('cartShipping');
    const totalEl = document.getElementById('cartTotal');
    const warningEl = document.getElementById('cartWarning');
    const totalQty = cart.reduce(function(s,i){ return s+i.qty; }, 0);
    countEl.textContent = totalQty;
    if(cart.length === 0){
      itemsEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    } else {
      itemsEl.innerHTML = cart.map(function(i){
        const priceStr = i.price > 0 ? ('€'+(i.price*i.qty).toFixed(2).replace('.',',')) : 'A combinar';
        const noteHtml = i.note ? ('<br><small class="cart-item-note">Engraving: '+i.note+'</small>') : '';
        const imageHtml = i.imageKey ? ('<br><small class="cart-item-note">📎 '+(i.imageName||'Image attached')+'</small>') : '';
        const doubleSidedHtml = i.doubleSided ? ('<br><small class="cart-item-note">Engraved on both sides</small>') : '';
        return '<div class="cart-item"><span>'+i.name+'<br><small>'+priceStr+'</small>'+noteHtml+imageHtml+doubleSidedHtml+'</span>'+
          '<div class="cart-item-actions">'+
          '<div class="qty-stepper">'+
          '<button onclick="changeQty('+i.id+', -1)" aria-label="Decrease quantity">−</button>'+
          '<span>'+i.qty+'</span>'+
          '<button onclick="changeQty('+i.id+', 1)" aria-label="Increase quantity">+</button>'+
          '</div>'+
          '<button class="cart-item-remove" onclick="removeFromCart('+i.id+')" aria-label="Remove item">✕</button>'+
          '</div></div>';
      }).join('');
    }
    const subtotal = cart.reduce(function(s,i){ return s + i.price*i.qty; }, 0);
    const shippingInfo = getShippingInfo();
    const shipping = shippingInfo.cost;
    const total = subtotal + shipping;
    subtotalEl.textContent = '€'+subtotal.toFixed(2).replace('.',',');
    shippingEl.textContent = '€'+shipping.toFixed(2).replace('.',',');
    totalEl.textContent = '€'+total.toFixed(2).replace('.',',');
    if(shippingInfo.blocked){
      warningEl.textContent = 'Your order has '+shippingInfo.totalQty+' items, which is more than we can ship in one order (max 10). Please contact us at info@servitlaser.com for a shipping quote before paying.';
      warningEl.style.display = 'block';
    } else {
      warningEl.textContent = '';
      warningEl.style.display = 'none';
    }
  }
  function checkout(){
    if(cart.length === 0){ alert('Your cart is empty.'); return; }
    const lines = cart.map(function(i){
      const priceStr = i.price > 0 ? ('€'+(i.price*i.qty).toFixed(2).replace('.',',')) : 'a combinar';
      const noteStr = i.note ? (' (Engraving: '+i.note+')') : '';
      const imageStr = i.imageKey ? (' [I uploaded a custom image ('+(i.imageName||'file')+') on the site — could you let me know if I should attach it here too, or if you already have it?]') : '';
      const doubleSidedStr = i.doubleSided ? ' [Engraved on both sides]' : '';
      return '- '+i.name+' x'+i.qty+' — '+priceStr+noteStr+imageStr+doubleSidedStr;
    });
    const subtotal = cart.reduce(function(s,i){ return s + i.price*i.qty; }, 0);
    const shippingInfo = getShippingInfo();
    const shipping = shippingInfo.cost;
    const total = subtotal + shipping;
    let body = 'Hello! I would like to order:\n\n'+lines.join('\n')+
      '\n\nSubtotal: €'+subtotal.toFixed(2).replace('.',',')+
      '\nShipping: €'+shipping.toFixed(2).replace('.',',')+
      '\nTotal: €'+total.toFixed(2).replace('.',',');
    if(shippingInfo.blocked){
      body += '\n\nNote: this order has '+shippingInfo.totalQty+' items, more than we can ship in one order (max 10) — please confirm the shipping cost with me.';
    }
    const url = 'mailto:info@servitlaser.com?subject='+encodeURIComponent('New order - SerVit Laser')+'&body='+encodeURIComponent(body);
    window.location.href = url;
  }
  async function payWithStripe(){
    if(cart.length === 0){ alert('Your cart is empty.'); return; }
    const shippingInfo = getShippingInfo();
    if(shippingInfo.blocked){
      alert('Your order has '+shippingInfo.totalQty+' items, which is more than we can ship in one order (max 10).\n\nPlease email info@servitlaser.com for a shipping quote before paying.');
      return;
    }
    try {
      const response = await fetch('/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart }),
      });
      const data = await response.json();
      if(data.url){
        window.location.href = data.url;
      } else {
        alert(data.error || 'Something went wrong starting checkout. Please try again or use another payment option.');
      }
    } catch(err){
      alert('Something went wrong starting checkout. Please try again or use another payment option.');
    }
  }
  function enviarPersonalizacao(){
    const nome = document.getElementById('p-nome').value.trim();
    const produto = document.getElementById('p-produto').value.trim();
    const detalhe = document.getElementById('p-detalhe').value.trim();
    const body = 'Name: '+nome+'\nProduct: '+produto+'\nWhat I want engraved:\n'+detalhe;
    window.location.href = 'mailto:info@servitlaser.com?subject='+encodeURIComponent('Customization Request')+'&body='+encodeURIComponent(body);
  }

  document.querySelectorAll('.photo-carousel').forEach(function(carousel){
    const dotsWrap = carousel.parentElement.querySelector('.photo-dots');
    if(!dotsWrap) return;
    const dots = dotsWrap.querySelectorAll('.dot');
    carousel.addEventListener('scroll', function(){
      const index = Math.round(carousel.scrollLeft / carousel.clientWidth);
      dots.forEach(function(d,i){ d.classList.toggle('active', i===index); });
    });
    dots.forEach(function(dot,i){
      dot.addEventListener('click', function(){
        carousel.scrollTo({left: i * carousel.clientWidth, behavior:'smooth'});
      });
    });
  });

  // Dropdown "Products": hover-intent simples (abrir logo, fechar com pequeno atraso)
  // em vez de calcular distâncias do rato — evita ficar preso aberto.
  document.querySelectorAll('.has-dropdown').forEach(function(item){
    let closeTimer = null;
    item.addEventListener('mouseenter', function(){
      clearTimeout(closeTimer);
      item.classList.add('open');
    });
    item.addEventListener('mouseleave', function(){
      clearTimeout(closeTimer);
      closeTimer = setTimeout(function(){ item.classList.remove('open'); }, 200);
    });
  });

  function closeAllDropdowns(){
    document.querySelectorAll('.has-dropdown.open').forEach(function(item){
      item.classList.remove('open');
    });
  }
  // Redes de segurança: fecha em qualquer clique fora, ao fazer scroll, ou com Escape.
  document.addEventListener('click', function(e){
    if(!e.target.closest('.has-dropdown')) closeAllDropdowns();
  });
  window.addEventListener('scroll', closeAllDropdowns, {passive:true});
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeAllDropdowns();
  });
