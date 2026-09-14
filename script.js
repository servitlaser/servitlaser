  let cart = [];
  let cartIdCounter = 1;
  const SHIPPING_FLAT = 7.90;
  const SHIPPING_MAX_QTY = { 'Bookmark': 10, 'Card Box': 4, 'Keychain': 10 };
  function getOverLimitItems(){
    return cart.filter(function(i){
      const max = SHIPPING_MAX_QTY[i.name];
      return max && i.qty > max;
    });
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
  function addToCart(name, price, engraveId){
    let note = '';
    if(engraveId){
      const input = document.getElementById(engraveId);
      if(input){
        note = input.value.trim();
        input.value = '';
      }
    }
    const existing = cart.find(function(i){ return i.name === name && i.note === note; });
    if(existing){ existing.qty += 1; } else { cart.push({id:cartIdCounter++, name:name, price:price, qty:1, note:note}); }
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
        return '<div class="cart-item"><span>'+i.name+'<br><small>'+priceStr+'</small>'+noteHtml+'</span>'+
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
    const shipping = cart.length > 0 ? SHIPPING_FLAT : 0;
    const total = subtotal + shipping;
    subtotalEl.textContent = '€'+subtotal.toFixed(2).replace('.',',');
    shippingEl.textContent = '€'+shipping.toFixed(2).replace('.',',');
    totalEl.textContent = '€'+total.toFixed(2).replace('.',',');
    const overLimit = getOverLimitItems();
    if(overLimit.length > 0){
      const names = overLimit.map(function(i){ return i.name; }).join(', ');
      warningEl.textContent = 'Your order includes more '+names+' than fit in one standard shipment at this rate. Please contact us at info@servitlaser.com for a shipping quote before paying.';
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
      return '- '+i.name+' x'+i.qty+' — '+priceStr+noteStr;
    });
    const subtotal = cart.reduce(function(s,i){ return s + i.price*i.qty; }, 0);
    const shipping = SHIPPING_FLAT;
    const total = subtotal + shipping;
    let body = 'Hello! I would like to order:\n\n'+lines.join('\n')+
      '\n\nSubtotal: €'+subtotal.toFixed(2).replace('.',',')+
      '\nShipping: €'+shipping.toFixed(2).replace('.',',')+
      '\nTotal: €'+total.toFixed(2).replace('.',',');
    const overLimit = getOverLimitItems();
    if(overLimit.length > 0){
      body += '\n\nNote: this order has more '+overLimit.map(function(i){ return i.name; }).join(', ')+' than fit in one standard shipment — please confirm the shipping cost with me.';
    }
    const url = 'mailto:info@servitlaser.com?subject='+encodeURIComponent('New order - SerVit Laser')+'&body='+encodeURIComponent(body);
    window.location.href = url;
  }
  function payWithPaypal(){
    if(cart.length === 0){ alert('Your cart is empty.'); return; }
    const overLimit = getOverLimitItems();
    if(overLimit.length > 0){
      alert('Your order includes more '+overLimit.map(function(i){ return i.name; }).join(', ')+' than fit in one standard shipment at this rate.\n\nPlease email info@servitlaser.com for a shipping quote before paying.');
      return;
    }
    const form = document.createElement('form');
    form.method = 'post';
    form.action = 'https://www.paypal.com/cgi-bin/webscr';
    form.target = '_blank';
    function addField(name, value){
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    addField('cmd', '_cart');
    addField('upload', '1');
    addField('business', 'O-TEU-EMAIL-PAYPAL@exemplo.com');
    addField('currency_code', 'EUR');
    cart.forEach(function(i, idx){
      const n = idx + 1;
      addField('item_name_'+n, i.name);
      addField('amount_'+n, i.price.toFixed(2));
      addField('quantity_'+n, i.qty);
      if(i.note){
        addField('on0_'+n, 'Customization');
        addField('os0_'+n, i.note);
      }
    });
    const shippingIndex = cart.length + 1;
    addField('item_name_'+shippingIndex, 'Shipping (Posti, Finland)');
    addField('amount_'+shippingIndex, SHIPPING_FLAT.toFixed(2));
    addField('quantity_'+shippingIndex, '1');
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
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
