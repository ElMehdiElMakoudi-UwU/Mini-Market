const path = require('path');
const Database = require('better-sqlite3');

const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'store.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🛒',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'piece',      -- 'piece' or 'kg'
  image TEXT NOT NULL DEFAULT '',
  in_stock INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal REAL NOT NULL,
  delivery_fee REAL NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',      -- new, preparing, delivering, delivered, cancelled
  driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  unit TEXT NOT NULL,
  qty REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const defaults = {
  store_phone: '212600000000',
  delivery_fee: '10',
  free_delivery_from: '200',
  min_order: '30',
  open_hours: '08:00 - 23:00',
  accepting_orders: '1',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

// Seed categories (from the shop sign) and a few sample products on first run
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  const cats = [
    ['المواد الغذائية', 'Épicerie', '🥫'],
    ['التوابل', 'Épices', '🌶️'],
    ['الأعشاب', 'Herbes', '🌿'],
    ['مواد الحلويات', 'Pâtisserie', '🧁'],
    ['الزيوت', 'Huiles', '🫒'],
    ['مواد التنظيف', 'Nettoyage', '🧽'],
    ['المشروبات', 'Boissons', '🥤'],
    ['الحليب ومشتقاته', 'Produits laitiers', '🥛'],
  ];
  const insCat = db.prepare('INSERT INTO categories (name_ar, name_fr, icon, sort) VALUES (?, ?, ?, ?)');
  const ids = {};
  cats.forEach(([ar, fr, icon], i) => { ids[fr] = insCat.run(ar, fr, icon, i).lastInsertRowid; });

  const products = [
    ['Épicerie', 'دقيق ممتاز 5 كلغ', 'Farine extra 5kg', 45, 'piece', 1],
    ['Épicerie', 'سكر قالب', 'Sucre en pain', 14, 'piece', 0],
    ['Épicerie', 'أرز 1 كلغ', 'Riz 1kg', 16, 'piece', 0],
    ['Épicerie', 'عدس', 'Lentilles', 18, 'kg', 0],
    ['Épicerie', 'شاي أخضر 200غ', 'Thé vert 200g', 22, 'piece', 1],
    ['Épices', 'كمون', 'Cumin', 90, 'kg', 1],
    ['Épices', 'فلفل أسود', 'Poivre noir', 140, 'kg', 0],
    ['Épices', 'زعفران حر (1غ)', 'Safran pur (1g)', 35, 'piece', 1],
    ['Épices', 'رأس الحانوت', 'Ras el hanout', 120, 'kg', 0],
    ['Épices', 'تحميرة (فلفل أحمر)', 'Paprika', 80, 'kg', 0],
    ['Herbes', 'زعتر', 'Thym', 60, 'kg', 0],
    ['Herbes', 'لويزة', 'Verveine', 100, 'kg', 0],
    ['Herbes', 'شيبة', 'Absinthe', 70, 'kg', 0],
    ['Pâtisserie', 'خميرة الحلويات', 'Levure chimique', 2, 'piece', 0],
    ['Pâtisserie', 'سمسم', 'Sésame', 50, 'kg', 1],
    ['Pâtisserie', 'لوز مقشر', 'Amandes décortiquées', 130, 'kg', 0],
    ['Pâtisserie', 'شوكولاتة الطبخ', 'Chocolat pâtissier', 25, 'piece', 0],
    ['Huiles', 'زيت الزيتون', "Huile d'olive", 85, 'piece', 1],
    ['Huiles', 'زيت المائدة 5 لتر', 'Huile de table 5L', 95, 'piece', 0],
    ['Huiles', 'زيت أركان', "Huile d'argan", 120, 'piece', 0],
    ['Nettoyage', 'جافيل', 'Javel', 8, 'piece', 0],
    ['Nettoyage', 'صابون الأواني', 'Liquide vaisselle', 15, 'piece', 0],
    ['Nettoyage', 'مسحوق الغسيل 3 كلغ', 'Lessive 3kg', 55, 'piece', 0],
    ['Boissons', 'ماء معدني 1.5 لتر', 'Eau minérale 1,5L', 6, 'piece', 0],
    ['Boissons', 'مشروب غازي 1 لتر', 'Soda 1L', 10, 'piece', 0],
    ['Produits laitiers', 'حليب 1 لتر', 'Lait 1L', 7.5, 'piece', 1],
    ['Produits laitiers', 'زبدة 250غ', 'Beurre 250g', 22, 'piece', 0],
  ];
  const insP = db.prepare('INSERT INTO products (category_id, name_ar, name_fr, price, unit, featured) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [cat, ar, fr, price, unit, featured] of products) insP.run(ids[cat], ar, fr, price, unit, featured);
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

module.exports = { db, getSettings };
