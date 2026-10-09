(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n).toFixed(2).replace(/\.00$/, '') + ' درهم';
  const qtyLabel = (unit, q) => (unit === 'kg' ? (q < 1 ? `${Math.round(q * 1000)} غ` : `${q} كلغ`) : `× ${q}`);
  const STATUS = {
    new: 'جديد', preparing: 'قيد التحضير', delivering: 'مع الموصّل', delivered: 'تم التوصيل', cancelled: 'ملغى',
  };
  const NEXT = { new: 'preparing', preparing: 'delivering', delivering: 'delivered' };
  const NEXT_LABEL = { new: '✓ قبول وتحضير', preparing: '🛵 خرج للتوصيل', delivering: '✓ تم التوصيل' };

  let tab = 'orders';
  let filter = 'active';
  let orders = [], products = [], categories = [], drivers = [], settings = {};
  let pollTimer;

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
    });
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'error');
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch {}
  }

  // ---------- Auth ----------
  function showLogin() {
    clearInterval(pollTimer);
    $('#appView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }
  async function showApp() {
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    await loadAll();
    render();
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 15000);
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: e.target.password.value } });
      showApp();
    } catch (err) {
      $('#loginError').textContent = err.message === 'too_many_attempts' ? 'محاولات كثيرة، انتظر قليلاً' : 'كلمة السر غير صحيحة';
      $('#loginError').classList.remove('hidden');
    }
  });
  $('#logoutBtn').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); };

  // ---------- Data ----------
  async function loadAll() {
    const [store, o, d, s] = await Promise.all([
      fetch('/api/store').then((r) => r.json()),
      api('/api/admin/orders'), api('/api/admin/drivers'), api('/api/admin/settings'),
    ]);
    products = store.products; categories = store.categories;
    orders = o; drivers = d; settings = s;
    renderAccepting();
  }

  async function poll() {
    try {
      const prevMax = Math.max(0, ...orders.map((o) => o.id));
      orders = await api('/api/admin/orders');
      const newMax = Math.max(0, ...orders.map((o) => o.id));
      if (newMax > prevMax && prevMax > 0) { beep(); toast('🔔 طلب جديد!'); }
      if (tab === 'orders' && !$('#modal:not(.hidden)')) renderOrders();
      updateDot();
    } catch {}
  }

  function updateDot() {
    const n = orders.filter((o) => o.status === 'new').length;
    $('#newDot').textContent = n;
    $('#newDot').classList.toggle('hidden', !n);
    document.title = (n ? `(${n}) ` : '') + 'لوحة التحكم — ميني ماركت الشدادي';
  }

  function renderAccepting() {
    const on = settings.accepting_orders === '1';
    $('#acceptingToggle').checked = on;
    $('#acceptingLabel').textContent = on ? 'المتجر مفتوح' : 'المتجر مغلق';
  }
  $('#acceptingToggle').onchange = async (e) => {
    settings.accepting_orders = e.target.checked ? '1' : '0';
    await api('/api/admin/settings', { method: 'PUT', body: { accepting_orders: settings.accepting_orders } });
    renderAccepting();
    toast(e.target.checked ? 'المتجر يستقبل الطلبات' : 'تم إيقاف الطلبات');
  };

  // ---------- Render ----------
  function render() {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    ({ orders: renderOrders, products: renderProducts, categories: renderCategories, drivers: renderDrivers, settings: renderSettings })[tab]();
    updateDot();
  }

  function waLink(phone, text) {
    let p = String(phone).replace(/[^\d]/g, '');
    if (p.startsWith('00')) p = p.slice(2);
    if (p.startsWith('0')) p = '212' + p.slice(1);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  }

  function orderText(o) {
    return [
      `🛵 طلب #${o.id} — ميني ماركت الشدادي`,
      '',
      `👤 ${o.customer_name}`,
      `📞 ${o.phone}`,
      `📍 ${o.neighborhood ? o.neighborhood + ' — ' : ''}${o.address}`,
      o.notes ? `📝 ${o.notes}` : null,
      '',
      ...o.items.map((i) => `• ${i.name} ${qtyLabel(i.unit, i.qty)}`),
      '',
      `💵 المبلغ للتحصيل: ${money(o.total)}`,
      `🗺️ https://www.google.com/maps/search/${encodeURIComponent((o.address + ' ' + o.neighborhood + ' القصر الكبير').trim())}`,
    ].filter((x) => x !== null).join('\n');
  }

  function fmtDate(s) {
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('fr-MA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  async function renderOrders() {
    let stats = { today_orders: 0, today_revenue: 0, counts: {} };
    try { stats = await api('/api/admin/stats'); } catch {}
    const list = orders.filter((o) =>
      filter === 'all' ? true : filter === 'active' ? ['new', 'preparing', 'delivering'].includes(o.status) : o.status === filter);
    const f = (k, label) => `<button class="cat ${filter === k ? 'active' : ''}" data-filter="${k}">${label}</button>`;
    const activeDrivers = drivers.filter((d) => d.active);

    $('#panel').innerHTML = `
      <div class="stats">
        <div class="stat"><small>طلبات اليوم</small><b>${stats.today_orders}</b></div>
        <div class="stat"><small>مبيعات اليوم</small><b>${money(stats.today_revenue)}</b></div>
        <div class="stat"><small>طلبات جديدة</small><b style="color:var(--red)">${stats.counts.new || 0}</b></div>
        <div class="stat"><small>مع الموصّل</small><b>${stats.counts.delivering || 0}</b></div>
      </div>
      <div class="filters">
        ${f('active', 'الجارية')}${f('new', 'جديد')}${f('preparing', 'قيد التحضير')}${f('delivering', 'مع الموصّل')}${f('delivered', 'تم التوصيل')}${f('cancelled', 'ملغى')}${f('all', 'الكل')}
      </div>
      ${!list.length ? '<p class="empty">لا توجد طلبات هنا</p>' : `<div class="orders">${list.map((o) => `
        <article class="order s-${o.status}" id="order-${o.id}">
          <div class="order-top"><b>#${o.id}</b><span class="pill">${STATUS[o.status]}</span></div>
          <div class="cust">
            <div>👤 <b>${esc(o.customer_name)}</b></div>
            <div>📞 <a href="tel:${esc(o.phone)}" dir="ltr">${esc(o.phone)}</a></div>
            <div>📍 ${o.neighborhood ? `<b>${esc(o.neighborhood)}</b> — ` : ''}${esc(o.address)}</div>
            ${o.notes ? `<div>📝 ${esc(o.notes)}</div>` : ''}
            <div style="color:var(--muted);font-size:12px">🕒 ${fmtDate(o.created_at)}</div>
          </div>
          <ul>${o.items.map((i) => `<li><span>${esc(i.name)} <b>${qtyLabel(i.unit, i.qty)}</b></span><span>${money(i.price * i.qty)}</span></li>`).join('')}
            <li style="color:var(--muted)"><span>التوصيل</span><span>${o.delivery_fee ? money(o.delivery_fee) : 'مجاني'}</span></li>
            <li style="font-weight:800;font-size:16px"><span>الإجمالي</span><span>${money(o.total)}</span></li>
          </ul>
          ${['delivered', 'cancelled'].includes(o.status) ? (o.driver_name ? `<div style="font-size:14px">🛵 ${esc(o.driver_name)}</div>` : '') : `
          <div class="row">
            <select data-driver="${o.id}">
              <option value="">— اختر الموصّل —</option>
              ${activeDrivers.map((d) => `<option value="${d.id}" ${o.driver_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
            </select>
            <button class="btn btn-wa" data-send="${o.id}">💬 أرسل للموصّل</button>
          </div>`}
          <div class="row">
            ${NEXT[o.status] ? `<button class="btn ${o.status === 'delivering' ? 'btn-green' : o.status === 'new' ? 'btn-primary' : 'btn-blue'}" data-next="${o.id}">${NEXT_LABEL[o.status]}</button>` : ''}
            <a class="btn btn-ghost" href="${waLink(o.phone, `السلام عليكم ${o.customer_name}، معك ميني ماركت الشدادي بخصوص طلبك رقم #${o.id}`)}" target="_blank" rel="noopener">💬 الزبون</a>
            <button class="btn btn-ghost" data-print="${o.id}">🖨️</button>
            ${!['delivered', 'cancelled'].includes(o.status) ? `<button class="btn btn-red" data-cancel="${o.id}">إلغاء</button>` : ''}
          </div>
        </article>`).join('')}</div>`}`;
  }

  function productRow(p) {
    const c = categories.find((c) => c.id === p.category_id);
    return `<tr>
      <td><div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc((c || {}).icon || '🛒')}</div></td>
      <td><b>${esc(p.name_ar)}</b><div style="color:var(--muted);font-size:12px">${esc(p.name_fr)}</div></td>
      <td class="hide-sm">${c ? esc(c.name_ar) : '—'}</td>
      <td><b>${money(p.price)}</b> ${p.unit === 'kg' ? '/ كلغ' : ''}</td>
      <td><input type="checkbox" class="switch" data-stock="${p.id}" ${p.in_stock ? 'checked' : ''} title="متوفر"></td>
      <td><button class="btn btn-ghost" style="padding:6px 10px" data-edit="${p.id}">✏️</button></td>
    </tr>`;
  }

  let pSearch = '', pCat = '';
  function renderProducts() {
    $('#panel').innerHTML = `
      <div class="toolbar">
        <input id="pSearch" placeholder="ابحث..." value="${esc(pSearch)}">
        <select id="pCat"><option value="">كل الأصناف</option>${categories.map((c) => `<option value="${c.id}" ${pCat == c.id ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('')}</select>
        <button class="btn btn-primary" data-edit="new">+ منتج جديد</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>المنتج</th><th class="hide-sm">الصنف</th><th>الثمن</th><th>متوفر</th><th></th></tr></thead>
        <tbody id="pBody"></tbody>
      </table></div>`;
    fillProducts();
    $('#pSearch').oninput = (e) => { pSearch = e.target.value; fillProducts(); };
    $('#pCat').onchange = (e) => { pCat = e.target.value; fillProducts(); };
  }
  function fillProducts() {
    const q = pSearch.trim().toLowerCase();
    const list = products.filter((p) => (!q || (p.name_ar + ' ' + p.name_fr).toLowerCase().includes(q)) && (!pCat || p.category_id == pCat));
    $('#pBody').innerHTML = list.map(productRow).join('') || '<tr><td colspan="6" class="empty">لا توجد منتجات</td></tr>';
  }

  function productForm(p) {
    const isNew = !p;
    p = p || { name_ar: '', name_fr: '', price: '', unit: 'piece', category_id: categories[0]?.id, in_stock: 1, featured: 0, image: '' };
    openModal(`
      <h2>${isNew ? 'منتج جديد' : 'تعديل المنتج'}</h2>
      <form id="productForm">
        <div class="field"><label>الاسم بالعربية *</label><input name="name_ar" required value="${esc(p.name_ar)}"></div>
        <div class="field"><label>الاسم بالفرنسية</label><input name="name_fr" dir="ltr" value="${esc(p.name_fr)}"></div>
        <div class="grid2">
          <div class="field"><label>الثمن (درهم) *</label><input name="price" type="number" step="0.01" min="0" required value="${esc(p.price)}" dir="ltr"></div>
          <div class="field"><label>البيع بـ</label><select name="unit">
            <option value="piece" ${p.unit === 'piece' ? 'selected' : ''}>الوحدة</option>
            <option value="kg" ${p.unit === 'kg' ? 'selected' : ''}>الكيلو (الثمن للكيلو)</option></select></div>
        </div>
        <div class="field"><label>الصنف</label><select name="category_id">
          <option value="">—</option>${categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name_ar)}</option>`).join('')}</select></div>
        <div class="field"><label>الصورة</label>
          ${p.image ? `<div class="row" style="margin-bottom:6px"><img src="${esc(p.image)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px"><label class="row"><input type="checkbox" name="remove_image" value="1"> حذف الصورة</label></div>` : ''}
          <input type="file" name="image" accept="image/*" capture="environment"></div>
        <div class="row" style="margin-bottom:14px;gap:16px">
          <label class="row"><input type="checkbox" class="switch" name="in_stock" ${p.in_stock ? 'checked' : ''}> متوفر</label>
          <label class="row"><input type="checkbox" class="switch" name="featured" ${p.featured ? 'checked' : ''}> ⭐ مميز</label>
        </div>
        <div class="row">
          <button class="btn btn-primary" style="flex:1">حفظ</button>
          <button type="button" class="btn btn-ghost" data-close-modal>إلغاء</button>
          ${!isNew ? `<button type="button" class="btn btn-red" data-delete-product="${p.id}">حذف</button>` : ''}
        </div>
      </form>`);
    $('#productForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.set('in_stock', e.target.in_stock.checked ? '1' : '0');
      fd.set('featured', e.target.featured.checked ? '1' : '0');
      if (!e.target.image.files.length) fd.delete('image');
      try {
        await api(isNew ? '/api/admin/products' : `/api/admin/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
        closeModal(); toast('تم الحفظ ✓');
        await refreshProducts(); renderProducts();
      } catch { toast('خطأ — تأكد من المعلومات'); }
    };
  }

  async function refreshProducts() {
    const store = await fetch('/api/store').then((r) => r.json());
    products = store.products; categories = store.categories;
  }

  function renderCategories() {
    $('#panel').innerHTML = `
      <div class="toolbar"><button class="btn btn-primary" data-cat-edit="new">+ صنف جديد</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>الأيقونة</th><th>الاسم</th><th>بالفرنسية</th><th>المنتجات</th><th>الترتيب</th><th></th></tr></thead>
        <tbody>${categories.map((c) => `<tr>
          <td style="font-size:24px">${esc(c.icon)}</td><td><b>${esc(c.name_ar)}</b></td><td>${esc(c.name_fr)}</td>
          <td>${products.filter((p) => p.category_id === c.id).length}</td><td>${c.sort}</td>
          <td><button class="btn btn-ghost" style="padding:6px 10px" data-cat-edit="${c.id}">✏️</button></td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  function categoryForm(c) {
    const isNew = !c;
    c = c || { name_ar: '', name_fr: '', icon: '🛒', sort: categories.length };
    openModal(`
      <h2>${isNew ? 'صنف جديد' : 'تعديل الصنف'}</h2>
      <form id="catForm">
        <div class="field"><label>الاسم بالعربية *</label><input name="name_ar" required value="${esc(c.name_ar)}"></div>
        <div class="field"><label>الاسم بالفرنسية</label><input name="name_fr" dir="ltr" value="${esc(c.name_fr)}"></div>
        <div class="grid2">
          <div class="field"><label>أيقونة (إيموجي)</label><input name="icon" value="${esc(c.icon)}"></div>
          <div class="field"><label>الترتيب</label><input name="sort" type="number" value="${esc(c.sort)}"></div>
        </div>
        <div class="row">
          <button class="btn btn-primary" style="flex:1">حفظ</button>
          <button type="button" class="btn btn-ghost" data-close-modal>إلغاء</button>
          ${!isNew ? `<button type="button" class="btn btn-red" data-delete-cat="${c.id}">حذف</button>` : ''}
        </div>
      </form>`);
    $('#catForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      await api(isNew ? '/api/admin/categories' : `/api/admin/categories/${c.id}`, { method: isNew ? 'POST' : 'PUT', body });
      closeModal(); toast('تم الحفظ ✓'); await refreshProducts(); renderCategories();
    };
  }

  function renderDrivers() {
    $('#panel').innerHTML = `
      <p class="hint">أضف الموصّلين هنا. من صفحة الطلبات، اختر الموصّل واضغط "أرسل للموصّل" باش يوصلو تفاصيل الطلب والعنوان على واتساب.</p>
      <form id="driverForm" class="toolbar">
        <input name="name" placeholder="اسم الموصّل" required>
        <input name="phone" placeholder="الهاتف 06..." dir="ltr" required style="max-width:200px">
        <button class="btn btn-primary">+ إضافة</button>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>طلبات اليوم</th><th></th></tr></thead>
        <tbody>${drivers.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td dir="ltr" style="text-align:end">${esc(d.phone)}</td>
          <td>${orders.filter((o) => o.driver_id === d.id && new Date(o.created_at.replace(' ', 'T') + 'Z').toDateString() === new Date().toDateString()).length}</td>
          <td><button class="btn btn-red" style="padding:6px 10px" data-delete-driver="${d.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا يوجد موصّلين بعد</td></tr>'}</tbody>
      </table></div>`;
    $('#driverForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/drivers', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        drivers = await api('/api/admin/drivers'); renderDrivers(); toast('تمت الإضافة ✓');
      } catch { toast('تأكد من الاسم ورقم الهاتف'); }
    };
  }

  function renderSettings() {
    $('#panel').innerHTML = `
      <form id="settingsForm" style="max-width:520px">
        <div class="field"><label>رقم واتساب المتجر (بصيغة دولية، مثال 2126XXXXXXXX)</label><input name="store_phone" dir="ltr" value="${esc(settings.store_phone)}"></div>
        <div class="grid2">
          <div class="field"><label>ثمن التوصيل (درهم)</label><input name="delivery_fee" type="number" step="0.5" min="0" dir="ltr" value="${esc(settings.delivery_fee)}"></div>
          <div class="field"><label>توصيل مجاني ابتداءً من (0 = لا)</label><input name="free_delivery_from" type="number" min="0" dir="ltr" value="${esc(settings.free_delivery_from)}"></div>
          <div class="field"><label>الحد الأدنى للطلب (درهم)</label><input name="min_order" type="number" min="0" dir="ltr" value="${esc(settings.min_order)}"></div>
          <div class="field"><label>أوقات العمل</label><input name="open_hours" dir="ltr" value="${esc(settings.open_hours)}"></div>
        </div>
        <button class="btn btn-primary">حفظ الإعدادات</button>
      </form>`;
    $('#settingsForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.store_phone = body.store_phone.replace(/[^\d]/g, '');
      await api('/api/admin/settings', { method: 'PUT', body });
      settings = { ...settings, ...body };
      toast('تم الحفظ ✓');
    };
  }

  // ---------- Modal ----------
  function openModal(html) { $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); }

  // ---------- Events ----------
  async function updateOrder(id, body) {
    await api(`/api/admin/orders/${id}`, { method: 'PATCH', body });
    orders = await api('/api/admin/orders');
    renderOrders(); updateDot();
  }

  document.addEventListener('click', async (e) => {
    const el = (s) => e.target.closest(s);
    let x;
    if ((x = el('[data-tab]'))) { tab = x.dataset.tab; return render(); }
    if ((x = el('[data-filter]'))) { filter = x.dataset.filter; return renderOrders(); }
    if ((x = el('[data-next]'))) {
      const o = orders.find((o) => o.id == x.dataset.next);
      return updateOrder(o.id, { status: NEXT[o.status] });
    }
    if ((x = el('[data-cancel]'))) {
      if (confirm(`إلغاء الطلب #${x.dataset.cancel}؟`)) return updateOrder(x.dataset.cancel, { status: 'cancelled' });
      return;
    }
    if ((x = el('[data-send]'))) {
      const o = orders.find((o) => o.id == x.dataset.send);
      const driverId = Number($(`[data-driver="${o.id}"]`).value);
      const d = drivers.find((d) => d.id === driverId);
      if (!d) return toast('اختر الموصّل أولاً');
      window.open(waLink(d.phone, orderText(o)), '_blank');
      return updateOrder(o.id, { driver_id: d.id, status: 'delivering' });
    }
    if ((x = el('[data-print]'))) {
      const card = $(`#order-${x.dataset.print}`);
      card.classList.add('printing'); window.print(); card.classList.remove('printing');
      return;
    }
    if ((x = el('[data-edit]'))) return productForm(x.dataset.edit === 'new' ? null : products.find((p) => p.id == x.dataset.edit));
    if ((x = el('[data-delete-product]'))) {
      if (!confirm('حذف هذا المنتج نهائياً؟')) return;
      await api(`/api/admin/products/${x.dataset.deleteProduct}`, { method: 'DELETE' });
      closeModal(); await refreshProducts(); renderProducts(); return toast('تم الحذف');
    }
    if ((x = el('[data-cat-edit]'))) return categoryForm(x.dataset.catEdit === 'new' ? null : categories.find((c) => c.id == x.dataset.catEdit));
    if ((x = el('[data-delete-cat]'))) {
      if (!confirm('حذف هذا الصنف؟ المنتجات ديالو غادي تبقى بلا صنف.')) return;
      await api(`/api/admin/categories/${x.dataset.deleteCat}`, { method: 'DELETE' });
      closeModal(); await refreshProducts(); renderCategories(); return;
    }
    if ((x = el('[data-delete-driver]'))) {
      if (!confirm('حذف هذا الموصّل؟')) return;
      await api(`/api/admin/drivers/${x.dataset.deleteDriver}`, { method: 'DELETE' });
      drivers = await api('/api/admin/drivers'); return renderDrivers();
    }
    if (el('[data-close-modal]')) return closeModal();
  });

  document.addEventListener('change', async (e) => {
    const s = e.target.closest('[data-stock]');
    if (s) {
      const fd = new FormData(); fd.set('in_stock', s.checked ? '1' : '0');
      await api(`/api/admin/products/${s.dataset.stock}`, { method: 'PUT', body: fd });
      const p = products.find((p) => p.id == s.dataset.stock); if (p) p.in_stock = s.checked ? 1 : 0;
      toast(s.checked ? 'متوفر ✓' : 'غير متوفر');
    }
    const d = e.target.closest('[data-driver]');
    if (d) await api(`/api/admin/orders/${d.dataset.driver}`, { method: 'PATCH', body: { driver_id: d.value || null } });
  });

  fetch('/api/admin/me').then((r) => r.json()).then((m) => (m.loggedIn ? showApp() : showLogin()));
})();
