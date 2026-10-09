(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let lang = store.get('lang', 'ar');
  let data = { settings: {}, categories: [], products: [] };
  let cart = store.get('cart', {}); // { productId: qty }
  let activeCat = 'all';
  let query = '';
  let view = 'cart'; // cart | checkout | success

  const t = (k, vars) => {
    let s = (I18N[lang] && I18N[lang][k]) ?? I18N.ar[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b);
    return s;
  };
  const money = (n) => {
    const v = Number(n).toFixed(2).replace(/\.00$/, '');
    return `${v} ${t('mad')}`;
  };
  const pName = (p) => (lang === 'fr' && p.name_fr) || p.name_ar;
  const cName = (c) => (lang === 'fr' && c.name_fr) || c.name_ar;
  const catOf = (p) => data.categories.find((c) => c.id === p.category_id);
  const icon = (p) => (catOf(p) || {}).icon || '🛒';
  const step = (p) => (p.unit === 'kg' ? 0.25 : 1);
  const qtyLabel = (p, q) => {
    if (p.unit !== 'kg') return String(q);
    return q < 1 ? `${Math.round(q * 1000)} ${t('g')}` : `${q} ${t('kg')}`;
  };

  // ---------- i18n ----------
  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = lang === 'ar' ? 'ميني ماركت الشدادي — القصر الكبير' : 'Mini Market Cheddadi — Ksar El Kebir';
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
    $('#langBtn').textContent = lang === 'ar' ? 'FR' : 'ع';
  }

  // ---------- Rendering ----------
  function renderHero() {
    const s = data.settings;
    const chips = [
      `<span class="chip">${t('chipDelivery')}: <b>${money(s.delivery_fee)}</b></span>`,
      s.free_delivery_from > 0 ? `<span class="chip">${t('chipFree')} <b>${money(s.free_delivery_from)}</b></span>` : '',
      `<span class="chip">${t('chipCod')}</span>`,
      `<span class="chip">🕗 <b dir="ltr">${esc(s.open_hours)}</b></span>`,
    ];
    $('#heroChips').innerHTML = chips.join('');
    $('#closedBanner').classList.toggle('hidden', s.accepting_orders);
    const ph = String(s.store_phone || '');
    $('#footPhone').textContent = '+' + ph;
    $('#footPhone').href = 'tel:+' + ph;
    $('#footHours').textContent = s.open_hours;
  }

  function renderCats() {
    const used = new Set(data.products.map((p) => p.category_id));
    const cats = data.categories.filter((c) => used.has(c.id));
    $('#cats').innerHTML =
      `<button class="cat ${activeCat === 'all' ? 'active' : ''}" data-cat="all">🛒 ${t('all')}</button>` +
      cats.map((c) => `<button class="cat ${activeCat == c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.icon)} ${esc(cName(c))}</button>`).join('');
  }

  function cardHTML(p) {
    const q = cart[p.id] || 0;
    const img = p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : esc(icon(p));
    const badge = !p.in_stock ? `<span class="badge out">${t('outOfStock')}</span>` : '';
    let actions;
    if (!p.in_stock) actions = `<button class="btn btn-ghost btn-block" disabled>${t('outOfStock')}</button>`;
    else if (q > 0) actions = `<div class="stepper"><button data-dec="${p.id}" aria-label="-">−</button><span>${qtyLabel(p, q)}</span><button data-inc="${p.id}" aria-label="+">+</button></div>`;
    else actions = `<button class="btn btn-primary btn-block" data-inc="${p.id}">+ ${t('add')}</button>`;
    return `<article class="card">
      <div class="card-img">${img}${badge}</div>
      <div class="card-body">
        <div class="card-name">${esc(pName(p))}</div>
        <div class="card-price">${money(p.price)} <small>${p.unit === 'kg' ? t('perKg') : ''}</small></div>
        <div class="actions">${actions}</div>
      </div>
    </article>`;
  }

  function renderProducts() {
    const q = query.trim().toLowerCase();
    let list = data.products;
    if (q) list = list.filter((p) => (p.name_ar + ' ' + p.name_fr).toLowerCase().includes(q));
    if (activeCat !== 'all') list = list.filter((p) => p.category_id == activeCat);

    let html = '';
    if (!list.length) html = `<p class="empty">${t('noResults')}</p>`;
    else if (activeCat === 'all' && !q) {
      const featured = list.filter((p) => p.featured);
      if (featured.length) html += `<h2 class="section-title">${t('featured')}</h2><div class="grid">${featured.map(cardHTML).join('')}</div>`;
      for (const c of data.categories) {
        const items = list.filter((p) => p.category_id === c.id);
        if (items.length) html += `<h2 class="section-title" id="cat-${c.id}">${esc(c.icon)} ${esc(cName(c))}</h2><div class="grid">${items.map(cardHTML).join('')}</div>`;
      }
      const orphans = list.filter((p) => !catOf(p));
      if (orphans.length) html += `<h2 class="section-title">🛒</h2><div class="grid">${orphans.map(cardHTML).join('')}</div>`;
    } else {
      html = `<div class="grid" style="margin-top:8px">${list.map(cardHTML).join('')}</div>`;
    }
    $('#products').innerHTML = html;
  }

  // ---------- Cart ----------
  const cartLines = () =>
    Object.entries(cart)
      .map(([id, qty]) => ({ p: data.products.find((x) => x.id == id), qty }))
      .filter((l) => l.p && l.p.in_stock && l.qty > 0);
  const subtotal = () => Math.round(cartLines().reduce((s, l) => s + l.p.price * l.qty, 0) * 100) / 100;
  const fee = (sub) => (data.settings.free_delivery_from > 0 && sub >= data.settings.free_delivery_from ? 0 : data.settings.delivery_fee);
  const itemCount = () => cartLines().length;

  function saveCart() {
    store.set('cart', cart);
    const n = itemCount();
    $('#cartCount').textContent = n;
    $('#bottomCount').textContent = n;
    $('#bottomTotal').textContent = money(subtotal());
    $('#bottomBar').classList.toggle('has-items', n > 0);
  }

  function changeQty(id, dir) {
    const p = data.products.find((x) => x.id == id);
    if (!p) return;
    const before = cart[id] || 0;
    let q = Math.round((before + dir * step(p)) * 100) / 100;
    if (q <= 0) delete cart[id];
    else cart[id] = Math.min(q, 100);
    if (!before && q > 0) toast(t('added'));
    saveCart();
    renderProducts();
    if ($('#drawer').classList.contains('open') && view === 'cart') renderDrawer();
  }

  function totalsHTML() {
    const sub = subtotal();
    const f = fee(sub);
    return `<div class="totals">
      <div><span>${t('subtotal')}</span><span>${money(sub)}</span></div>
      <div><span>${t('delivery')}</span><span>${f === 0 ? t('free') : money(f)}</span></div>
      <div class="grand"><span>${t('total')}</span><span>${money(sub + f)}</span></div>
    </div>`;
  }

  function renderDrawer() {
    const body = $('#drawerBody');
    const foot = $('#drawerFoot');
    const s = data.settings;

    if (view === 'cart') {
      $('#drawerTitle').textContent = t('yourCart');
      const lines = cartLines();
      if (!lines.length) {
        body.innerHTML = `<p class="empty">${t('emptyCart')}</p>`;
        foot.innerHTML = `<button class="btn btn-ghost btn-block" data-close-drawer>${t('continueShopping')}</button>`;
        return;
      }
      body.innerHTML = lines.map(({ p, qty }) => `
        <div class="line-item">
          <div class="line-thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(icon(p))}</div>
          <div><div class="line-name">${esc(pName(p))}</div><div class="line-price">${money(p.price)} ${p.unit === 'kg' ? t('perKg') : ''} · <b>${money(p.price * qty)}</b></div></div>
          <div class="stepper"><button data-dec="${p.id}">−</button><span>${qtyLabel(p, qty)}</span><button data-inc="${p.id}">+</button></div>
        </div>`).join('');

      const sub = subtotal();
      let hint = '';
      if (s.free_delivery_from > 0) {
        const pct = Math.min(100, (sub / s.free_delivery_from) * 100);
        hint = `<div class="progress"><i style="width:${pct}%"></i></div><p class="hint">${sub >= s.free_delivery_from ? t('freeGot') : t('freeLeft', { x: (s.free_delivery_from - sub).toFixed(2).replace(/\.00$/, '') })}</p>`;
      }
      const belowMin = sub < s.min_order;
      foot.innerHTML = hint + totalsHTML() +
        (belowMin ? `<p class="hint warn">${t('minOrder', { x: s.min_order })}</p>` : '') +
        `<button class="btn btn-primary btn-block" id="goCheckout" ${belowMin || !s.accepting_orders ? 'disabled' : ''}>${t('checkout')}</button>`;
      return;
    }

    if (view === 'checkout') {
      $('#drawerTitle').textContent = t('checkout');
      const saved = store.get('customer', {});
      body.innerHTML = `
        <form id="checkoutForm" novalidate>
          <div class="field"><label>${t('name')}</label><input name="name" required autocomplete="name" value="${esc(saved.name)}"></div>
          <div class="field"><label>${t('phone')}</label><input name="phone" type="tel" inputmode="tel" dir="ltr" required autocomplete="tel" placeholder="06 XX XX XX XX" value="${esc(saved.phone)}"></div>
          <div class="field"><label>${t('neighborhood')}</label><input name="neighborhood" value="${esc(saved.neighborhood)}"></div>
          <div class="field"><label>${t('address')}</label><textarea name="address" required placeholder="${t('addressPh')}">${esc(saved.address)}</textarea></div>
          <div class="field"><label>${t('notes')}</label><textarea name="notes" placeholder="${t('notesPh')}"></textarea></div>
          <div class="pay-note">💵 ${t('cod')}</div>
          <p class="error hidden" id="checkoutError"></p>
        </form>`;
      foot.innerHTML = totalsHTML() +
        `<div style="display:flex;gap:8px">
          <button class="btn btn-ghost" id="backToCart">${t('back')}</button>
          <button class="btn btn-primary" style="flex:1" id="placeOrder">${t('confirmOrder')}</button>
        </div>`;
      return;
    }

    if (view === 'success') {
      const o = store.get('lastOrder', {});
      $('#drawerTitle').textContent = t('done');
      body.innerHTML = `<div class="success">
        <div class="check">✓</div>
        <h3>${t('thanks')}</h3>
        <p>${t('orderNo')}</p>
        <div class="order-no">#${esc(o.id)}</div>
        <p>${t('willCall')}</p>
        ${o.wa ? `<a class="btn btn-wa btn-block" target="_blank" rel="noopener" href="${esc(o.wa)}">💬 ${t('sendWa')}</a>` : ''}
      </div>`;
      foot.innerHTML = `<button class="btn btn-primary btn-block" data-close-drawer>${t('continueShopping')}</button>`;
    }
  }

  function openDrawer(v = 'cart') {
    view = v;
    renderDrawer();
    $('#drawer').classList.add('open');
    $('#overlay').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#overlay').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    if (view === 'success') view = 'cart';
  }

  async function placeOrder() {
    const form = $('#checkoutForm');
    const fd = Object.fromEntries(new FormData(form));
    const err = $('#checkoutError');
    err.classList.add('hidden');
    if (!fd.name.trim() || !fd.phone.trim() || !fd.address.trim()) {
      err.textContent = t('err_missing_fields'); err.classList.remove('hidden'); return;
    }
    const btn = $('#placeOrder');
    btn.disabled = true;
    const lines = cartLines();
    try {
      const res = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fd, items: lines.map((l) => ({ id: l.p.id, qty: l.qty })) }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'generic');

      store.set('customer', { name: fd.name, phone: fd.phone, address: fd.address, neighborhood: fd.neighborhood });
      const msg = [
        `🛒 طلب جديد #${out.id} — ميني ماركت الشدادي`,
        '',
        ...lines.map((l) => `• ${l.p.name_ar} × ${qtyLabel(l.p, l.qty)} = ${money(l.p.price * l.qty)}`),
        '',
        `${t('total')}: ${money(out.total)}`,
        `👤 ${fd.name}`,
        `📞 ${fd.phone}`,
        `📍 ${fd.neighborhood ? fd.neighborhood + ' — ' : ''}${fd.address}`,
        fd.notes ? `📝 ${fd.notes}` : '',
      ].filter((x) => x !== null).join('\n');
      const wa = data.settings.store_phone ? `https://wa.me/${data.settings.store_phone}?text=${encodeURIComponent(msg)}` : '';
      store.set('lastOrder', { id: out.id, wa });
      cart = {};
      saveCart();
      renderProducts();
      view = 'success';
      renderDrawer();
    } catch (e) {
      err.textContent = t('err_' + e.message) !== 'err_' + e.message ? t('err_' + e.message) : t('err_generic');
      err.classList.remove('hidden');
      btn.disabled = false;
      if (e.message === 'unavailable') load(); // refresh stock
    }
  }

  // ---------- Tracking ----------
  async function track(e) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const err = $('#trackError');
    err.classList.add('hidden');
    $('#trackResult').innerHTML = '';
    const res = await fetch(`/api/orders/track?id=${encodeURIComponent(fd.id.replace('#', ''))}&phone=${encodeURIComponent(fd.phone)}`);
    if (!res.ok) { err.textContent = t('notFound'); err.classList.remove('hidden'); return; }
    const o = await res.json();
    const flow = ['new', 'preparing', 'delivering', 'delivered'];
    let html;
    if (o.status === 'cancelled') html = `<div class="status-steps"><div class="now">✕ ${t('st_cancelled')}</div></div>`;
    else {
      const idx = flow.indexOf(o.status);
      html = `<div class="status-steps">${flow.map((s, i) =>
        `<div class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${i < idx ? '✓' : i === idx ? '●' : '○'} ${t('st_' + s)}</div>`).join('')}</div>`;
    }
    $('#trackResult').innerHTML = `<p style="margin:14px 0 0"><b>#${o.id}</b> · ${money(o.total)}</p>` + html;
  }

  // ---------- Install as app (PWA) ----------
  let installPrompt = null; // Android/Chrome install event, kept until the user taps "Install"
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function renderInstall() {
    const show = !standalone && !store.get('installDismissed', false) && (installPrompt || isIos);
    $('#installBar').classList.toggle('hidden', !show);
    if (!show) return;
    $('#installText').textContent = installPrompt ? t('installText') : t('installIos');
    $('#installBtn').classList.toggle('hidden', !installPrompt);
  }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
  addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
  $('#installBtn').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderInstall();
  };
  $('#installClose').onclick = () => { store.set('installDismissed', true); renderInstall(); };
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  // ---------- Misc ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function renderAll() {
    applyLang();
    renderInstall();
    renderHero();
    renderCats();
    renderProducts();
    saveCart();
    if ($('#drawer').classList.contains('open')) renderDrawer();
  }

  async function load() {
    const res = await fetch('/api/store');
    data = await res.json();
    // drop cart entries for removed products
    for (const id of Object.keys(cart)) if (!data.products.find((p) => p.id == id)) delete cart[id];
    renderAll();
  }

  // ---------- Events ----------
  document.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) return changeQty(inc.dataset.inc, 1);
    if (dec) return changeQty(dec.dataset.dec, -1);
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      activeCat = cat.dataset.cat;
      renderCats(); renderProducts();
      window.scrollTo({ top: $('.cats-wrap').offsetTop - 60, behavior: 'smooth' });
      return;
    }
    if (e.target.closest('[data-close-drawer]')) return closeDrawer();
    if (e.target.closest('#goCheckout')) { view = 'checkout'; return renderDrawer(); }
    if (e.target.closest('#backToCart')) { view = 'cart'; return renderDrawer(); }
    if (e.target.closest('#placeOrder')) return placeOrder();
    if (e.target.closest('[data-close]')) return $('#trackModal').classList.add('hidden');
  });
  $('#cartBtn').onclick = () => openDrawer('cart');
  $('#bottomCartBtn').onclick = () => openDrawer('cart');
  $('#closeDrawer').onclick = closeDrawer;
  $('#overlay').onclick = closeDrawer;
  $('#langBtn').onclick = () => { lang = lang === 'ar' ? 'fr' : 'ar'; store.set('lang', lang); renderAll(); };
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderProducts(); });
  $('#trackBtn').onclick = () => {
    const f = $('#trackForm');
    const last = store.get('lastOrder', {});
    const c = store.get('customer', {});
    if (last.id && !f.id.value) f.id.value = last.id;
    if (c.phone && !f.phone.value) f.phone.value = c.phone;
    $('#trackModal').classList.remove('hidden');
  };
  $('#trackForm').addEventListener('submit', track);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); $('#trackModal').classList.add('hidden'); } });

  applyLang();
  load();
})();
