  let cart = [];
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
  function addToCart(name, price){
    const existing = cart.find(function(i){ return i.name === name; });
    if(existing){ existing.qty += 1; } else { cart.push({name:name, price:price, qty:1}); }
    renderCart();
    openCart();
  }
  function removeFromCart(name){
    cart = cart.filter(function(i){ return i.name !== name; });
    renderCart();
  }
  function renderCart(){
    const itemsEl = document.getElementById('cartItems');
    const countEl = document.getElementById('cartCount');
    const totalEl = document.getElementById('cartTotal');
    const totalQty = cart.reduce(function(s,i){ return s+i.qty; }, 0);
    countEl.textContent = totalQty;
    if(cart.length === 0){
      itemsEl.innerHTML = '<p class="cart-empty">O carrinho está vazio.</p>';
    } else {
      itemsEl.innerHTML = cart.map(function(i){
        const priceStr = i.price > 0 ? ('€'+(i.price*i.qty).toFixed(2).replace('.',',')) : 'A combinar';
        return '<div class="cart-item"><span>'+i.name+' x'+i.qty+'<br><small>'+priceStr+'</small></span><button onclick="removeFromCart(\''+i.name.replace(/'/g,"\\'")+'\')">✕</button></div>';
      }).join('');
    }
    const total = cart.reduce(function(s,i){ return s + i.price*i.qty; }, 0);
    totalEl.textContent = '€'+total.toFixed(2).replace('.',',');
  }
  function checkout(){
    if(cart.length === 0){ alert('O carrinho está vazio.'); return; }
    const note = document.getElementById('nota-personalizacao').value.trim();
    const lines = cart.map(function(i){
      const priceStr = i.price > 0 ? ('€'+(i.price*i.qty).toFixed(2).replace('.',',')) : 'a combinar';
      return '- '+i.name+' x'+i.qty+' — '+priceStr;
    });
    const total = cart.reduce(function(s,i){ return s + i.price*i.qty; }, 0);
    let body = 'Olá! Gostaria de encomendar:\n\n'+lines.join('\n')+'\n\nTotal: €'+total.toFixed(2).replace('.',',');
    if(note) body += '\n\nPersonalização:\n'+note;
    const url = 'mailto:info@servitlaser.com?subject='+encodeURIComponent('Nova encomenda - SerVit Laser')+'&body='+encodeURIComponent(body);
    window.location.href = url;
  }
  function enviarPersonalizacao(){
    const nome = document.getElementById('p-nome').value.trim();
    const produto = document.getElementById('p-produto').value.trim();
    const detalhe = document.getElementById('p-detalhe').value.trim();
    const body = 'Nome: '+nome+'\nProduto: '+produto+'\nO que quero gravado:\n'+detalhe;
    window.location.href = 'mailto:info@servitlaser.com?subject='+encodeURIComponent('Pedido de Personalização')+'&body='+encodeURIComponent(body);
  }
  function subscribeNewsletter(e){
    e.preventDefault();
    const email = document.getElementById('newsletterEmail').value;
    window.location.href = 'mailto:info@servitlaser.com?subject='+encodeURIComponent('Nova subscrição newsletter')+'&body='+encodeURIComponent('Email para subscrever: '+email);
    return false;
  }
