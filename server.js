require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, getSettings } = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cheddadi2026';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD not set — using the default. Set it in .env before going live.');
}

const app = express();
app.set('trust proxy', 1); // behind Coolify's reverse proxy: real client IPs + HTTPS detection
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const STATUSES = ['new', 'preparing', 'delivering', 'delivered', 'cancelled'];
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Admin auth (signed cookie) ----------
function sign(value) {
  return value + '.' + crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function verify(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const value = token.slice(0, i);
  const expected = sign(value);
  if (expected.length !== token.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return false;
  return Number(value) > Date.now();
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function requireAdmin(req, res, next) {
  if (verify(getCookie(req, 'admin'))) return next();
  res.status(401).json({ error: 'unauthorized' });
}

const loginAttempts = new Map();
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'too_many_attempts' });

  const pw = String(req.body.password || '');
  const ok = pw.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(ADMIN_PASSWORD));
  if (!ok) { a.n++; loginAttempts.set(ip, a); return res.status(401).json({ error: 'wrong_password' }); }

  loginAttempts.delete(ip);
  const token = sign(String(Date.now() + 30 * 24 * 3600e3));
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${30 * 24 * 3600}${secure}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ loggedIn: verify(getCookie(req, 'admin')) }));

// ---------- Public API ----------
function publicSettings() {
  const s = getSettings();
  return {
    store_phone: s.store_phone,
    delivery_fee: Number(s.delivery_fee),
    free_delivery_from: Number(s.free_delivery_from),
    min_order: Number(s.min_order),
    open_hours: s.open_hours,
    accepting_orders: s.accepting_orders === '1',
  };
}

app.get('/api/store', (req, res) => {
  res.json({
    settings: publicSettings(),
    categories: db.prepare('SELECT * FROM categories ORDER BY sort, id').all(),
    products: db.prepare('SELECT * FROM products ORDER BY featured DESC, name_ar').all(),
  });
});

function validPhone(p) {
  const digits = String(p).replace(/[\s\-.]/g, '');
  return /^(\+212|00212|0)[5-7]\d{8}$/.test(digits) ? digits : null;
}

const orderRate = new Map();
app.post('/api/orders', (req, res) => {
  const settings = publicSettings();
  if (!settings.accepting_orders) return res.status(400).json({ error: 'closed' });

  // simple anti-spam: max 5 orders per IP per 10 minutes
  const now = Date.now();
  const hits = (orderRate.get(req.ip) || []).filter((t) => now - t < 10 * 60e3);
  if (hits.length >= 5) return res.status(429).json({ error: 'too_many_orders' });

  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = validPhone(b.phone || '');
  const address = String(b.address || '').trim().slice(0, 300);
  const neighborhood = String(b.neighborhood || '').trim().slice(0, 80);
  const notes = String(b.notes || '').trim().slice(0, 500);
  if (!name || !address) return res.status(400).json({ error: 'missing_fields' });
  if (!phone) return res.status(400).json({ error: 'invalid_phone' });
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 100) {
    return res.status(400).json({ error: 'empty_cart' });
  }

  // Prices are always recomputed server-side from the database
  const getP = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  for (const it of b.items) {
    const p = getP.get(Number(it.id));
    if (!p || !p.in_stock) return res.status(400).json({ error: 'unavailable', product: p ? p.name_ar : null });
    let qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100) return res.status(400).json({ error: 'bad_qty' });
    qty = p.unit === 'kg' ? Math.round(qty * 4) / 4 : Math.round(qty);
    if (qty <= 0) return res.status(400).json({ error: 'bad_qty' });
    lines.push({ p, qty });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.p.price * l.qty, 0));
  if (subtotal < settings.min_order) return res.status(400).json({ error: 'min_order', min: settings.min_order });
  const fee = settings.free_delivery_from > 0 && subtotal >= settings.free_delivery_from ? 0 : settings.delivery_fee;
  const total = round2(subtotal + fee);

  const create = db.transaction(() => {
    const id = db.prepare(`INSERT INTO orders (customer_name, phone, address, neighborhood, notes, subtotal, delivery_fee, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(name, phone, address, neighborhood, notes, subtotal, fee, total).lastInsertRowid;
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, unit, qty) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lines) insItem.run(id, l.p.id, l.p.name_ar, l.p.price, l.p.unit, l.qty);
    return id;
  });
  const id = create();
  hits.push(now); orderRate.set(req.ip, hits);
  res.json({ ok: true, id, total, subtotal, delivery_fee: fee });
});

// Order tracking: requires order id + phone so strangers can't browse orders
app.get('/api/orders/track', (req, res) => {
  const phone = validPhone(req.query.phone || '');
  const o = phone && db.prepare('SELECT id, status, total, created_at, phone FROM orders WHERE id = ?').get(Number(req.query.id));
  if (!o || o.phone.slice(-9) !== phone.slice(-9)) return res.status(404).json({ error: 'not_found' });
  delete o.phone;
  res.json(o);
});

// ---------- Admin API ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

function removeImage(img) {
  if (img && img.startsWith('/uploads/')) fs.unlink(path.join(UPLOAD_DIR, path.basename(img)), () => {});
}

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const { status } = req.query;
  const where = STATUSES.includes(status) ? 'WHERE o.status = ?' : '';
  const orders = db.prepare(`SELECT o.*, d.name AS driver_name, d.phone AS driver_phone FROM orders o
    LEFT JOIN drivers d ON d.id = o.driver_id ${where} ORDER BY o.id DESC LIMIT 300`).all(...(where ? [status] : []));
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = items.all(o.id);
  res.json(orders);
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const today = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders
    WHERE date(created_at,'localtime') = date('now','localtime') AND status != 'cancelled'`).get();
  const counts = {};
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all()) counts[r.status] = r.n;
  const latest = db.prepare('SELECT MAX(id) id FROM orders').get().id || 0;
  res.json({ today_orders: today.n, today_revenue: today.s, counts, latest });
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'not_found' });
  const status = STATUSES.includes(req.body.status) ? req.body.status : o.status;
  const driver_id = 'driver_id' in req.body ? (req.body.driver_id ? Number(req.body.driver_id) : null) : o.driver_id;
  db.prepare("UPDATE orders SET status = ?, driver_id = ?, updated_at = datetime('now') WHERE id = ?").run(status, driver_id, o.id);
  res.json({ ok: true });
});

// Products
app.post('/api/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  const b = req.body;
  if (!b.name_ar || !(Number(b.price) >= 0)) return res.status(400).json({ error: 'missing_fields' });
  const image = req.file ? '/uploads/' + req.file.filename : '';
  const r = db.prepare(`INSERT INTO products (category_id, name_ar, name_fr, price, unit, image, in_stock, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(b.category_id || null, b.name_ar.trim(), (b.name_fr || '').trim(),
    Number(b.price), b.unit === 'kg' ? 'kg' : 'piece', image, b.in_stock === '0' ? 0 : 1, b.featured === '1' ? 1 : 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not_found' });
  const b = req.body;
  let image = p.image;
  if (req.file) { removeImage(p.image); image = '/uploads/' + req.file.filename; }
  else if (b.remove_image === '1') { removeImage(p.image); image = ''; }
  db.prepare(`UPDATE products SET category_id=?, name_ar=?, name_fr=?, price=?, unit=?, image=?, in_stock=?, featured=? WHERE id=?`)
    .run(b.category_id !== undefined ? (b.category_id || null) : p.category_id, (b.name_ar ?? p.name_ar).trim(), (b.name_fr ?? p.name_fr).trim(),
      b.price !== undefined ? Number(b.price) : p.price, b.unit ? (b.unit === 'kg' ? 'kg' : 'piece') : p.unit, image,
      b.in_stock !== undefined ? (b.in_stock === '0' || b.in_stock === 0 ? 0 : 1) : p.in_stock,
      b.featured !== undefined ? (b.featured === '1' || b.featured === 1 ? 1 : 0) : p.featured, p.id);
  res.json({ ok: true });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (p) { removeImage(p.image); db.prepare('DELETE FROM products WHERE id = ?').run(p.id); }
  res.json({ ok: true });
});

// Categories
app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const { name_ar, name_fr = '', icon = '🛒', sort = 0 } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'missing_fields' });
  db.prepare('INSERT INTO categories (name_ar, name_fr, icon, sort) VALUES (?, ?, ?, ?)').run(name_ar, name_fr, icon, Number(sort) || 0);
  res.json({ ok: true });
});
app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const { name_ar, name_fr = '', icon = '🛒', sort = 0 } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'missing_fields' });
  db.prepare('UPDATE categories SET name_ar=?, name_fr=?, icon=?, sort=? WHERE id=?').run(name_ar, name_fr, icon, Number(sort) || 0, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Drivers
app.get('/api/admin/drivers', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM drivers ORDER BY name').all()));
app.post('/api/admin/drivers', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').replace(/[^\d]/g, '');
  if (!name || phone.length < 9) return res.status(400).json({ error: 'missing_fields' });
  db.prepare('INSERT INTO drivers (name, phone) VALUES (?, ?)').run(name, phone);
  res.json({ ok: true });
});
app.delete('/api/admin/drivers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM drivers WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Settings
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(getSettings()));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = ['store_phone', 'delivery_fee', 'free_delivery_from', 'min_order', 'open_hours', 'accepting_orders'];
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of allowed) if (k in req.body) up.run(k, String(req.body[k]));
  res.json({ ok: true });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => {
  console.log(`🛒 Mini Market Cheddadi running on http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin`);
});
