# 🛒 Mini Market Cheddadi — ميني ماركت الشدادي

Online store for Mini Market Cheddadi, Ksar El Kebir. Customers order online, pay cash on delivery, and the owner dispatches each order to a driver over WhatsApp.

## Features

**Customers** (`/`), in Arabic (RTL) and French
- Browse by category, search, and see the most-ordered products
- Products sold by the piece or by weight (spices and herbs go in 250 g steps)
- Cart is saved on the phone, with a progress bar toward free delivery and a minimum-order check
- Checkout with name, phone, neighborhood and address. Payment is cash on delivery.
- After ordering, the customer gets an order number and can also send the order to the shop on WhatsApp
- Order tracking with the order number and phone number

**Owner** (`/admin`), in Arabic, password protected
- Orders come in with a sound alert and refresh every 15 seconds
- Order flow: New → Preparing → With driver → Delivered (or Cancelled)
- **Send to driver**: pick a driver, and WhatsApp opens with the items, the customer's phone and address, the amount to collect, and a Google Maps link
- Call or WhatsApp the customer, and print an order
- Products: add, edit, or delete; upload a photo (the phone camera works); mark items in or out of stock or as featured
- Manage categories and drivers
- Settings: WhatsApp number, delivery fee, free-delivery threshold, minimum order, opening hours
- One switch opens or closes the store

## Run locally

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` and set `ADMIN_PASSWORD` and `SESSION_SECRET`, then:

```bash
npm start
```

Open http://localhost:3000 for the store and http://localhost:3000/admin for the admin panel.

On first run the database (`data/store.db`) is created with the categories from the shop sign and about 27 sample products. Change or delete them from the admin panel.

## First things to do in /admin
1. **Settings**: enter the real WhatsApp number in international format, e.g. `2126XXXXXXXX`, and set the delivery fee.
2. **Drivers**: add the delivery driver(s).
3. **Products**: replace the sample prices and add photos.

## Deploying

This is a plain Node.js app with SQLite. It needs a host with a **persistent disk**, because `data/` (the database) and `uploads/` (product photos) must survive restarts:
- A small VPS (Hetzner, DigitalOcean, Contabo, ~5 €/month) with `pm2` and Nginx + Let's Encrypt for HTTPS, or
- Railway / Render / Fly.io with a mounted volume for `data/` and `uploads/`

Serverless hosts such as Vercel or Netlify will **not** work, because they have no persistent disk.

Back up `data/store.db` and `uploads/` regularly.

## Structure
```
server.js           Express API (store, orders, admin)
db.js               SQLite schema, defaults, seed data
public/index.html   Storefront
public/js/app.js    Storefront logic (cart, checkout, tracking)
public/js/i18n.js   Arabic / French text
public/css/style.css
public/admin/       Admin panel
```
