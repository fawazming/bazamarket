# Baza Market — Nigerian group-buy / dropshipping storefront

A PHP 8 + SQLite single-page store that digitises the WhatsApp dropshipping workflow:

1. **Browse** products and sizes in the shop.
2. **Build a tally** in the cart — quantities and totals are calculated automatically (replaces the private-notes + manual summation step).
3. **Checkout** with name, phone, city. You get an order code, bank details and a ready-to-send WhatsApp tally.
4. **Upload a receipt** (auto-compressed screenshot). The sales rep reviews it from the Sales Desk.
5. **Confirm payment** in the Sales Desk — the buyer's short name and quantity instantly appear under each variant on the public **Group list** (the digital version of adding names in the group).
6. **Batch board** follows the monthly import cycle: open → closed → ordered → shipped → arrived, with updates posted to everyone.

## Run

Place the folder in `htdocs` (already at `C:\xampp\htdocs\ecommerce`) and open:

```
http://localhost/ecommerce/
```

Or run it with PHP's built-in server:

```
php -S localhost:8000
```

The SQLite database is created and seeded automatically at `data/store.sqlite` on first request. Delete the `data/` folder to reset the demo.

## Sales desk

- URL: `#/admin` (or footer link)
- Passcode: `admin123` — change it under Settings.

From the Sales Desk you can confirm/cancel/deliver orders, view uploaded receipts, add or edit products and variants, create batches, post batch updates, and edit branding/bank details.

## Notes

- No framework, no build step: `index.php`, `api.php`, `assets/app.js`, `assets/style.css`.
- Prices are stored as whole Naira integers. All totals are recalculated server-side.
- Public group names are shortened to first name + last initial for privacy.
- Only confirmed/delivered orders for the current batch appear on the group list.
