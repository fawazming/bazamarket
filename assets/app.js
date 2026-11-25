/* Baza Market — single-page front-end */
(() => {
  const app = document.getElementById('app');
  const CART_KEY = 'baza_cart_v1';
  const S = { settings: {}, products: [], batch: null, batches: [], group: [], admin: false, index: {}, filter: 'All' };
  const V = {
    cart: [], cartOpen: false, filter: 'All', variant: null, qty: 1,
    admin: null, adminTab: 'orders', edit: null, editBatch: null,
    order: null, busy: false, orderErr: null
  };

  /* ---------------- utils ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₦' + Number(n || 0).toLocaleString('en-NG');
  const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const fmtDate = s => { if (!s) return '—'; const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const daysTo = s => { if (!s) return null; const d = new Date(s.length <= 10 ? s + 'T23:59:59' : s); return Math.ceil((d - Date.now()) / 86400000); };
  const statusLabel = s => ({ pending: 'Awaiting payment', confirmed: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled', open: 'Open', closed: 'Closed', ordered: 'Ordered', shipped: 'In transit', arrived: 'Arrived' }[s] || s);

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
  }

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const [route, query] = path.split('?');
    const r = await fetch('api.php?r=' + encodeURIComponent(route) + (query ? '&' + query : ''), opt);
    const j = await r.json().catch(() => ({ error: 'Unexpected server response' }));
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  async function sync() {
    const b = await api('bootstrap');
    S.settings = b.settings; S.products = b.products; S.batch = b.batch; S.batches = b.batches; S.group = b.group; S.admin = b.admin;
    S.index = {};
    S.products.forEach(p => p.variants.forEach(v => { S.index[v.id] = { product: p, label: v.label, price: +v.price, emoji: p.emoji }; }));
    S.cart = V.cart;
  }

  const saveCart = () => localStorage.setItem(CART_KEY, JSON.stringify(V.cart));
  function loadCart() {
    try { V.cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]').filter(i => i && i.variant_id); } catch { V.cart = []; }
  }
  const cartRows = () => V.cart.filter(i => S.index[i.variant_id]).map(i => ({ ...i, ...S.index[i.variant_id], sum: S.index[i.variant_id].price * i.qty }));
  const cartTotal = () => cartRows().reduce((t, r) => t + r.sum, 0);
  const cartCount = () => V.cart.reduce((t, i) => t + i.qty, 0);
  function addToCart(variant_id, qty) {
    const ex = V.cart.find(i => i.variant_id === variant_id);
    if (ex) ex.qty = Math.min(99, ex.qty + qty); else V.cart.push({ variant_id, qty });
    saveCart(); toast('Added to your tally'); V.cartOpen = true; render();
  }

  function tallyText(rows, total, code) {
    const lines = [`*${S.settings.brand} — ${S.batch ? S.batch.code : 'Order'}*`];
    rows.forEach((r, i) => lines.push(`${i + 1}. ${r.product} — ${r.label} · ${money(r.price)} × ${r.qty} = ${money(r.price * r.qty)}`));
    lines.push(`TOTAL: ${money(total)}`);
    if (code) lines.push(`ORDER: ${code}`);
    return lines.join('\n');
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); toast('Copied to clipboard');
    }
  }

  function downscale(file, max = 1000) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = rej; img.src = url;
    });
  }

  /* ---------------- router ---------------- */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [page, ...rest] = h.split('/');
    return { page: page || 'shop', param: rest.join('/') };
  }
  function go(path) { location.hash = '#/' + path; }

  /* ---------------- layout ---------------- */
  function header(r) {
    const nav = [
      ['shop', 'Shop'], ['group', 'Group list'], ['batches', 'Batches'], ['admin', 'Sales desk']
    ];
    const cnt = cartCount();
    return `<header class="site-head"><div class="head-in">
      <a class="brand" href="#/shop"><span class="brand-mark">B</span><span>${esc(S.settings.brand || 'Baza Market')}<small>Group buying</small></span></a>
      <nav class="site-nav">
        ${nav.map(([k, l]) => `<a href="#/${k}" class="${r.page === k ? 'active' : ''} ${k === 'batches' || k === 'admin' ? 'hide-sm' : ''}">${l}</a>`).join('')}
        <button class="cart-btn" data-act="cart-toggle" aria-label="Open cart">🛍 <span class="lbl">Tally</span> <span class="cart-count">${cnt}</span></button>
      </nav></div></header>`;
  }

  function drawer() {
    const rows = cartRows();
    return `<div class="overlay ${V.cartOpen ? 'on' : ''}" data-act="cart-close"></div>
    <aside class="drawer ${V.cartOpen ? 'on' : ''}" aria-label="Your tally">
      <div class="drawer-head"><div><h3>Your tally</h3><p class="small muted">${cartCount()} item${cartCount() === 1 ? '' : 's'} · ${S.batch ? S.batch.code : ''}</p></div><button class="icon-btn" data-act="cart-close">✕</button></div>
      <div class="drawer-body">
        ${rows.length ? rows.map(r => `<div class="line-item">
            <div class="lt">${esc(r.emoji)}</div>
            <div><h4>${esc(r.product.name)}</h4><div class="sub">${esc(r.label)} · ${money(r.price)}</div></div>
            <div class="stepper"><button data-act="dec" data-id="${r.variant_id}">−</button><b>${r.qty}</b><button data-act="inc" data-id="${r.variant_id}">+</button></div>
          </div>`).join('') : `<div class="empty"><div class="big">🧺</div><p>Your tally is empty.</p><p class="small">Browse the shop and add the sizes you want.</p></div>`}
      </div>
      <div class="drawer-foot">
        <div class="total-line"><span class="muted small">Total</span><b>${money(cartTotal())}</b></div>
        <button class="btn primary block" data-act="checkout" ${rows.length ? '' : 'disabled'}>Review & place order →</button>
        ${rows.length ? `<button class="btn ghost block sm" style="margin-top:8px" data-act="copy-cart">Copy tally</button>` : ''}
      </div>
    </aside>`;
  }

  function footer() {
    return `<footer class="site-foot"><div class="foot-in">
      <div><b>${esc(S.settings.brand)}</b> · ${esc(S.settings.tagline)}</div>
      <div>Questions? <a href="https://wa.me/${esc(S.settings.whatsapp)}" target="_blank" rel="noopener" style="color:var(--accent-ink);font-weight:600">Chat a sales rep</a> · <a href="#/admin" style="font-weight:600">Sales desk</a></div>
    </div></footer>`;
  }

  /* ---------------- pages ---------------- */
  function hero() {
    const b = S.batch;
    if (!b) return '';
    const d = daysTo(b.closes_at);
    const units = S.group.reduce((t, g) => t + g.units, 0);
    const buyers = new Set(S.group.flatMap(g => g.variants.flatMap(v => v.buyers.map(x => x.name)))).size;
    const created = b.created_at ? new Date(b.created_at).getTime() : Date.now();
    const end = b.closes_at ? new Date(b.closes_at).getTime() : Date.now();
    const pct = Math.max(4, Math.min(100, Math.round(((Date.now() - created) / Math.max(1, end - created)) * 100)));
    return `<section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Monthly import · Nigeria</div>
        <h1>Buy together. Pay less. Get it delivered.</h1>
        <p class="lede">Pick your sizes, build your tally and pay from your phone. Once the batch closes we import in bulk — and everyone sees exactly who is on the list.</p>
        <div class="hero-badges">
          <span class="pill green"><i class="dot pulse"></i> ${esc(b.code)} ${b.status === 'open' ? 'open' : statusLabel(b.status)}</span>
          <span class="pill">🚚 Delivery 7–14 days after close</span>
          <span class="pill">🔒 Payment confirms your slot</span>
        </div>
        <div class="row" style="margin-top:24px">
          <a class="btn primary" href="#/shop">Start your tally</a>
          <a class="btn" href="#/group">See who's buying</a>
        </div>
      </div>
      <div class="batch-card">
        <div>
          <div class="label">${b.status === 'open' ? 'Now collecting' : 'Latest batch'}</div>
          <h3>${esc(b.code)} · ${esc(b.title)}</h3>
          <div class="meta">${b.status === 'open' ? (d !== null && d >= 0 ? `Closes in ${d} day${d === 1 ? '' : 's'} · ${fmtDate(b.closes_at)}` : 'Closing today') : statusLabel(b.status)} · ${esc(b.origin || '')}</div>
          <div class="batch-stat">
            <div><b>${buyers}</b><span>Buyers</span></div>
            <div><b>${units}</b><span>Units claimed</span></div>
            <div><b>${b.eta ? fmtDate(b.eta).replace(/,? \d{4}$/, '') : '—'}</b><span>ETA</span></div>
          </div>
        </div>
        <div><div class="bar"><i style="width:${pct}%"></i></div>
        <p class="tiny" style="color:#8fb3a2;margin-top:8px">${b.status === 'open' ? 'Batch is open — your name appears on the group list once payment is confirmed.' : 'This batch is closed. Watch the updates for shipping news.'}</p></div>
      </div>
    </section>`;
  }

  function shopPage() {
    const cats = ['All', ...new Set(S.products.map(p => p.category))];
    const list = S.filter === 'All' ? S.products : S.products.filter(p => p.category === S.filter);
    return `<div class="wrap">
      ${hero()}
      <div class="spread" style="margin:8px 0 14px">
        <div><h2>Available now</h2><p class="small muted">Prices in Naira, per unit. Sizes and colours shown inside each item.</p></div>
        <span class="pill">${list.length} item${list.length === 1 ? '' : 's'}</span>
      </div>
      <div class="chips">${cats.map(c => `<button class="chip ${S.filter === c ? 'on' : ''}" data-act="filter" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="grid">${list.map(p => card(p)).join('')}</div>
    </div>`;
  }

  function card(p) {
    return `<article class="card prod" data-act="open" data-id="${p.id}" tabindex="0">
      <div class="thumb"><span class="cat">${esc(p.category)}</span>${esc(p.emoji)}</div>
      <div class="prod-body">
        <h3>${esc(p.name)}</h3>
        <div class="price">${money(p.from)} <small>from</small></div>
        <div class="foot"><span class="prod-sizes">${p.variants.length} option${p.variants.length === 1 ? '' : 's'}</span><span class="pill green tiny">Claim slot</span></div>
      </div>
    </article>`;
  }

  function productPage(id) {
    const p = S.products.find(x => x.id == id && x.active);
    if (!p) return `<div class="wrap"><div class="empty"><div class="big">🔍</div><p>This item is no longer available.</p><a class="btn" href="#/shop" style="margin-top:12px">Back to shop</a></div></div>`;
    if (!p.variants.find(v => v.id == V.variant)) V.variant = p.variants[0] ? p.variants[0].id : null;
    const sel = p.variants.find(v => v.id == V.variant) || p.variants[0] || { price: 0, label: '—' };
    const g = S.group.find(x => x.id === p.id);
    return `<div class="wrap">
      <a href="#/shop" class="small muted" style="display:inline-block;margin-bottom:14px">← Back to shop</a>
      <div class="detail">
        <div class="detail-media">${esc(p.emoji)}</div>
        <div class="detail-info">
          <div class="row" style="gap:8px"><span class="pill">${esc(p.category)}</span><span class="pill green"><i class="dot"></i>${S.batch ? esc(S.batch.code) : ''} collecting</span></div>
          <h1 style="margin-top:14px">${esc(p.name)}</h1>
          <div class="price-lg">${money(sel.price)} <span class="small muted" style="font-weight:500;letter-spacing:0">per unit</span></div>
          <p class="lede" style="margin-bottom:18px">${esc(p.description)}</p>
          <div class="field"><label>Choose ${p.variants.length > 1 ? 'size / option' : 'option'}</label>
            <div class="opt-grid">${p.variants.map(v => `<button class="opt ${v.id == V.variant ? 'on' : ''}" data-act="opt" data-id="${v.id}"><b>${esc(v.label)}</b><span>${money(v.price)}</span></button>`).join('')}</div>
          </div>
          <div class="row" style="margin-top:18px;align-items:center">
            <div class="qty"><button data-act="q-minus">−</button><span>${V.qty}</span><button data-act="q-plus">+</button></div>
            <button class="btn primary grow" data-act="add">Add to tally · ${money(sel.price * V.qty)}</button>
          </div>
          <div class="surface pad soft" style="margin-top:18px;padding:16px 18px">
            <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">How it works</div>
            <p class="small">Pay by transfer, send your receipt, and your name is added to the public group list under this item. When the batch closes, we import everything in bulk.</p>
          </div>
        </div>
      </div>
      <section class="interest surface pad">
        <div class="spread"><div><h2>Who's buying this</h2><p class="small muted">Live group list for ${S.batch ? esc(S.batch.code) : 'this batch'} · first name + initial for privacy</p></div>${g ? `<span class="pill green">${g.units} unit${g.units === 1 ? '' : 's'} claimed</span>` : ''}</div>
        ${g ? g.variants.map(v => `<div class="interest-row"><div style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b class="small">${esc(v.label)}</b><span class="small muted">${v.buyers.length} buyer${v.buyers.length === 1 ? '' : 's'} · ${v.units} unit${v.units === 1 ? '' : 's'}</span></div>
          ${v.buyers.map(b => `<span class="buyer"><span class="av">${esc(initials(b.name))}</span><b>${esc(b.name)}</b> ×${b.qty}</span>`).join('')}
        </div>`).join('') : `<div class="empty" style="padding:26px 10px"><div class="big">🫱</div><p>No one has claimed this yet — be the first.</p></div>`}
      </section>
    </div>`;
  }

  function checkoutPage() {
    const rows = cartRows();
    if (!rows.length) return `<div class="wrap"><div class="empty"><div class="big">🧺</div><p>Your tally is empty.</p><a class="btn primary" href="#/shop" style="margin-top:12px">Go to shop</a></div></div>`;
    return `<div class="wrap">
      <a href="#/shop" class="small muted" style="display:inline-block;margin-bottom:14px">← Continue shopping</a>
      <div class="page-head"><div><div class="eyebrow">Checkout</div><h1>Place your order</h1><p class="lede">We only need the basics. Your tally is sent to the sales rep with your payment receipt.</p></div></div>
      <div class="two-col">
        <form class="surface pad-lg stack" id="checkout-form">
          <h3>Delivery details</h3>
          <div class="form-grid">
            <div class="field"><label>Full name</label><input class="input" name="name" placeholder="e.g. Aisha Bello" required></div>
            <div class="field"><label>Phone / WhatsApp</label><input class="input" name="phone" placeholder="0803 000 0000" required></div>
            <div class="field"><label>City</label><input class="input" name="city" placeholder="e.g. Abuja" required></div>
            <div class="field"><label>Delivery address (optional)</label><input class="input" name="address" placeholder="Street, landmark"></div>
            <div class="field full"><label>Note for the sales rep (optional)</label><textarea class="input" name="note" placeholder="Colour preference, delivery instructions…"></textarea></div>
          </div>
          <div class="surface pad soft small" style="padding:14px 16px">
            <b>What happens next?</b><br>
            You'll get an order code and bank details. Transfer, upload the receipt, and your name is added to the group list once the rep confirms payment.
          </div>
          <button class="btn primary block" type="submit" ${V.busy ? 'disabled' : ''}>${V.busy ? 'Placing order…' : 'Place order · ' + money(cartTotal())}</button>
          <p class="hint">No card needed. Bank transfer only — this is a group-buy, not a checkout race.</p>
        </form>
        <div class="surface pad stack" style="position:sticky;top:86px">
          <div class="spread"><h3>Your tally</h3><span class="pill">${S.batch ? esc(S.batch.code) : ''}</span></div>
          <div class="tally-list">${rows.map(r => `<div class="tally-row"><div><b>${esc(r.product.name)}</b><div class="small muted">${esc(r.label)} × ${r.qty}</div></div><div class="r">${money(r.sum)}</div></div>`).join('')}</div>
          <div class="divider" style="margin:6px 0"></div>
          <div class="spread"><span class="muted">Total</span><b style="font-size:22px">${money(cartTotal())}</b></div>
          <button class="btn sm block" type="button" data-act="copy-cart">Copy tally</button>
        </div>
      </div>
    </div>`;
  }

  function orderPage() {
    if (V.orderErr) return `<div class="wrap"><div class="empty"><div class="big">🧾</div><p>${esc(V.orderErr)}</p><a class="btn" href="#/shop" style="margin-top:12px">Back to shop</a></div></div>`;
    if (!V.order) return `<div class="wrap"><div class="boot"><span class="spinner"></span><p>Fetching your order…</p></div></div>`;
    const o = V.order;
    const items = o.items || [];
    const isPaid = ['confirmed', 'delivered'].includes(o.status);
    const st = o.status === 'pending' ? (o.has_receipt ? 'Receipt received' : 'Awaiting payment') : statusLabel(o.status);
    const stepIdx = o.status === 'delivered' ? 4 : o.status === 'confirmed' ? 3 : o.has_receipt ? 2 : 1;
    const steps = ['Order placed', 'Receipt sent', 'Payment confirmed', 'In batch'];
    const tally = tallyText(items.map(i => ({ product: i.product, label: i.label, price: +i.price, qty: +i.qty })), o.total, o.code);
    const wa = `https://wa.me/${(S.settings.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(tally + `\nName: ${o.public_name || ''}`)}`;
    return `<div class="wrap">
      <a href="#/shop" class="small muted" style="display:inline-block;margin-bottom:14px">← Back to shop</a>
      <div class="order-hero">
        <div class="spread" style="align-items:flex-start">
          <div><div class="eyebrow">Order ${esc(o.batch ? o.batch.code : '')}</div>
            <div class="code">${esc(o.code)}</div>
            <p class="small muted" style="margin-top:6px">Placed ${fmtDate(o.created_at)} · ${esc(o.public_name || '')}</p></div>
          <span class="status ${esc(o.status)}">${esc(st)}</span>
        </div>
        <div class="steps">${steps.map((s, i) => `<div class="step ${i < stepIdx ? 'done' : ''}">${s}</div>`).join('')}</div>
      </div>
      <div class="two-col" style="margin-top:20px">
        <div class="stack">
          <div class="surface pad">
            <div class="spread"><h3>Your tally</h3><button class="btn sm" data-act="copy-order" data-code="${esc(o.code)}">Copy</button></div>
            <div class="tally-list" style="margin-top:8px">${items.map(i => `<div class="tally-row"><div><b>${esc(i.product)}</b><div class="small muted">${esc(i.label)} · ${money(i.price)} × ${i.qty}</div></div><div class="r">${money(i.price * i.qty)}</div></div>`).join('')}</div>
            <div class="divider" style="margin:14px 0"></div>
            <div class="spread"><span class="muted">Total to transfer</span><b style="font-size:24px">${money(o.total)}</b></div>
          </div>
          ${!isPaid && o.status !== 'cancelled' ? `<div class="surface pad">
            <h3>1 · Transfer ${money(o.total)}</h3>
            <div style="margin:10px 0 4px">
              <div class="bank-row"><span class="muted">Bank</span><b>${esc(S.settings.bank_name)}</b></div>
              <div class="bank-row"><span class="muted">Account number</span><b class="mono">${esc(S.settings.bank_account)}</b></div>
              <div class="bank-row"><span class="muted">Account name</span><b>${esc(S.settings.account_name)}</b></div>
              <div class="bank-row"><span class="muted">Narration</span><b class="mono">${esc(o.code)}</b></div>
            </div>
            <button class="btn sm" data-act="copy-bank">Copy bank details</button>
            <div class="divider"></div>
            <h3>2 · Upload your receipt</h3>
            <p class="small muted" style="margin:4px 0 10px">A screenshot from your bank app is fine. The rep confirms it and adds your name to the group list.</p>
            ${o.has_receipt ? `<div class="pill green" style="margin-bottom:10px"><i class="dot"></i>Receipt uploaded — awaiting confirmation</div>` : ''}
            <label class="upload" for="receipt-input"><div class="big">📤</div><b>${o.has_receipt ? 'Replace receipt' : 'Tap to upload receipt'}</b><p class="small muted">PNG or JPG · compressed automatically</p></label>
            <input id="receipt-input" type="file" accept="image/*" hidden>
          </div>` : ''}
          ${isPaid ? `<div class="surface pad"><h3>You're on the list 🎉</h3><p class="small muted" style="margin-top:6px">Your name now appears under your items on the public group list for ${esc(o.batch ? o.batch.code : 'this batch')}. Watch the batch for shipping updates.</p><a class="btn primary sm" href="#/group" style="margin-top:12px">View group list</a></div>` : ''}
        </div>
        <div class="stack">
          <div class="surface pad">
            <h3>Send to the sales rep</h3>
            <p class="small muted" style="margin:6px 0 10px">Your tally is ready. Send it on WhatsApp together with your receipt so the rep can match your payment.</p>
            <div class="copybox" style="max-height:220px;overflow:auto">${esc(tally)}</div>
            <div class="row" style="margin-top:12px">
              <a class="btn primary grow" href="${wa}" target="_blank" rel="noopener">Open WhatsApp</a>
              <button class="btn" data-act="copy-order" data-code="${esc(o.code)}">Copy</button>
            </div>
          </div>
          <div class="surface pad">
            <h3>Batch progress</h3>
            <p class="small muted" style="margin-top:4px">${o.batch ? `${esc(o.batch.code)} · ${statusLabel(o.batch.status)}` : ''}</p>
            ${o.batch && o.batch.eta ? `<p class="small" style="margin-top:6px">Expected arrival: <b>${fmtDate(o.batch.eta)}</b></p>` : ''}
            <a class="btn sm" href="#/batches" style="margin-top:10px">Batch updates</a>
          </div>
          <div class="surface pad soft"><p class="small">${esc(S.settings.support_note || '')}</p></div>
        </div>
      </div>
    </div>`;
  }

  function groupPage() {
    const b = S.batch;
    return `<div class="wrap">
      <div class="page-head"><div><div class="eyebrow">Public group list</div><h1>Who's buying what</h1><p class="lede">This is the digital version of the group list. Every confirmed payment adds a name and quantity under the item. Names are shortened for privacy.</p></div>
        <span class="pill green"><i class="dot pulse"></i>${b ? esc(b.code) + ' · ' + statusLabel(b.status) : 'No active batch'}</span></div>
      ${S.group.length ? `<div class="board">${S.group.map(g => `<div class="surface board-card">
        <div class="bc-head"><div class="bc-emoji">${esc(g.emoji)}</div><div class="grow"><h3>${esc(g.name)}</h3><p class="small muted">${g.buyers} buyer${g.buyers === 1 ? '' : 's'} · ${g.units} unit${g.units === 1 ? '' : 's'}</p></div><a class="btn sm" href="#/product/${g.id}">Join</a></div>
        ${g.variants.map(v => `<div class="vrow"><div class="vr-head"><b>${esc(v.label)}</b><span>${v.units} unit${v.units === 1 ? '' : 's'}</span></div>
          <div class="buyers">${v.buyers.map(x => `<span class="buyer"><span class="av">${esc(initials(x.name))}</span><b>${esc(x.name)}</b> ×${x.qty}</span>`).join('')}</div></div>`).join('')}
      </div>`).join('')}</div>` : `<div class="surface empty"><div class="big">📋</div><p>No confirmed names yet for this batch.</p><p class="small">Be the first — place an order and upload your receipt.</p><a class="btn primary" href="#/shop" style="margin-top:14px">Browse products</a></div>`}
      <div class="surface pad soft" style="margin-top:18px"><p class="small muted">🔒 Only confirmed buyers appear here. Your full name, phone and address stay private with the sales rep.</p></div>
    </div>`;
  }

  function batchesPage() {
    const open = S.batches.find(b => b.status === 'open');
    return `<div class="wrap">
      <div class="page-head"><div><div class="eyebrow">Import batches</div><h1>Batch board</h1><p class="lede">We import in monthly batches. When a batch closes the order is placed in bulk; updates are posted here for everyone.</p></div></div>
      ${S.batches.map(b => `<section class="surface pad" style="margin-bottom:16px">
        <div class="spread" style="align-items:flex-start">
          <div class="row"><div class="avatar" style="width:42px;height:42px;border-radius:12px;font-size:14px">${b.status === 'open' ? '●' : b.status === 'arrived' ? '✓' : '↗'}</div>
            <div><h3>${esc(b.code)} · ${esc(b.title)}</h3><p class="small muted">${esc(b.origin || '')} · ${b.orders} order${b.orders === 1 ? '' : 's'} · ${money(b.value)}</p></div></div>
          <span class="status ${esc(b.status)}">${statusLabel(b.status)}</span>
        </div>
        <div class="row" style="margin-top:12px">
          <span class="pill">${b.status === 'open' ? 'Closes ' + fmtDate(b.closes_at) : 'Closed ' + fmtDate(b.closes_at)}</span>
          <span class="pill">ETA ${fmtDate(b.eta)}</span>
        </div>
        ${b.updates.length ? `<div class="tl" style="margin-top:18px">${b.updates.map((u, i) => `<div class="tl-item ${i === 0 && b.status === 'open' ? 'now' : ''}"><b>${esc(u.title)}</b><p>${esc(u.body)}</p><p class="tiny" style="margin-top:2px">${fmtDate(u.created_at)}</p></div>`).join('')}</div>` : `<p class="small muted" style="margin-top:14px">Updates will appear here once the batch closes.</p>`}
      </section>`).join('')}
      <div class="surface pad soft"><p class="small muted">Batches run monthly. A new batch opens a few days after the previous one is dispatched. ${open ? `<a href="#/shop" style="color:var(--accent-ink);font-weight:600">Join ${esc(open.code)} →</a>` : ''}</p></div>
    </div>`;
  }

  /* ---------------- admin ---------------- */
  function adminPage() {
    if (!S.admin) return `<div class="wrap" style="max-width:520px">
      <div class="surface pad-lg stack" style="margin-top:40px">
        <div class="brand-mark" style="width:44px;height:44px;border-radius:14px;font-size:20px">B</div>
        <div><h2>Sales desk</h2><p class="small muted">Confirm payments, add names to the group list, manage products and batches.</p></div>
        <form id="login-form" class="stack">
          <div class="field"><label>Passcode</label><input class="input" type="password" name="pass" placeholder="Enter admin passcode" required autofocus></div>
          <button class="btn primary block">Enter sales desk</button>
          <p class="hint">Demo passcode: <b>admin123</b></p>
        </form>
      </div></div>`;
    const A = V.admin;
    if (!A) return `<div class="wrap"><div class="boot"><span class="spinner"></span><p>Loading sales desk…</p></div></div>`;
    const tabs = [['orders', 'Orders'], ['products', 'Products'], ['batches', 'Batches'], ['marketing', 'Marketing'], ['settings', 'Settings']];
    const st = A.stats || {};
    const body = V.adminTab === 'orders' ? adminOrders(A) : V.adminTab === 'products' ? adminProducts(A) : V.adminTab === 'batches' ? adminBatches(A) : V.adminTab === 'marketing' ? adminMarketing() : adminSettings(A);
    return `<div class="wrap">
      <div class="page-head"><div><div class="eyebrow">Sales desk</div><h1>Operations</h1><p class="lede">Confirm a payment to publish the buyer's name on the group list.</p></div>
        <button class="btn sm" data-act="admin-out">Sign out</button></div>
      <div class="stat-grid">
        <div class="surface stat"><span>Awaiting</span><b>${st.pending || 0}</b></div>
        <div class="surface stat"><span>Confirmed</span><b>${st.confirmed || 0}</b></div>
        <div class="surface stat"><span>Delivered</span><b>${st.delivered || 0}</b></div>
        <div class="surface stat"><span>Collected</span><b>${money(st.revenue || 0)}</b></div>
      </div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${V.adminTab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${body}
    </div>`;
  }

  function adminOrders(A) {
    return `<div class="surface table-wrap"><table>
      <thead><tr><th>Order</th><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th><th>Receipt</th><th></th></tr></thead>
      <tbody>${A.orders.map(o => `<tr>
        <td><b class="mono">${esc(o.code)}</b><div class="tiny muted">${fmtDate(o.created_at)}</div></td>
        <td>${esc(o.customer_name)}<div class="tiny muted">${esc(o.phone)} · ${esc(o.city)}</div></td>
        <td class="small">${o.items.map(i => `${esc(i.product)} <span class="muted">(${esc(i.label)})</span> ×${i.qty}`).join('<br>')}</td>
        <td class="mono"><b>${money(o.total)}</b></td>
        <td><span class="status ${esc(o.status)}">${statusLabel(o.status)}</span></td>
        <td>${o.has_receipt ? `<a class="btn sm" href="api.php?r=receipt.file&id=${o.id}" target="_blank">View</a>` : '<span class="tiny muted">none</span>'}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap">
          ${o.status !== 'confirmed' && o.status !== 'delivered' ? `<button class="btn primary sm" data-act="ord" data-do="confirm" data-id="${o.id}">Confirm</button>` : ''}
          ${o.status === 'confirmed' ? `<button class="btn sm" data-act="ord" data-do="deliver" data-id="${o.id}">Delivered</button>` : ''}
          ${o.status !== 'cancelled' && o.status !== 'delivered' ? `<button class="btn sm" data-act="ord" data-do="cancel" data-id="${o.id}">Cancel</button>` : ''}
        </div></td>
      </tr>`).join('')}</tbody></table>
      ${A.orders.length ? '' : `<div class="empty">No orders yet.</div>`}</div>`;
  }

  function adminProducts(A) {
    const e = V.edit;
    const form = e ? `<form class="surface pad stack" id="product-form" style="margin-bottom:16px">
      <div class="spread"><h3>${e.id ? 'Edit product' : 'New product'}</h3><button type="button" class="btn sm" data-act="edit-close">Close</button></div>
      <div class="form-grid">
        <div class="field"><label>Name</label><input class="input" name="name" value="${esc(e.name)}" required></div>
        <div class="field"><label>Category</label><input class="input" name="category" value="${esc(e.category || '')}" placeholder="Home"></div>
        <div class="field"><label>Emoji</label><input class="input" name="emoji" value="${esc(e.emoji || '📦')}" maxlength="4"></div>
        <div class="field"><label>Status</label><select class="input" name="active"><option value="1" ${e.active ? 'selected' : ''}>Active</option><option value="0" ${e.active ? '' : 'selected'}>Hidden</option></select></div>
        <div class="field full"><label>Description</label><textarea class="input" name="description">${esc(e.description || '')}</textarea></div>
      </div>
      <div class="field"><label>Sizes / options</label><div id="variant-rows" class="stack" style="gap:8px">
        ${(e.variants && e.variants.length ? e.variants : [{ id: 0, label: '', price: '' }]).map(v => `<div class="row vrow-edit" data-id="${v.id || 0}"><input class="input v-label" placeholder="e.g. 12 Litre" value="${esc(v.label)}" style="flex:2"><input class="input v-price" type="number" min="0" placeholder="Price ₦" value="${v.price}" style="flex:1"><button type="button" class="icon-btn" data-act="del-var">✕</button></div>`).join('')}
      </div>
      <button type="button" class="btn sm" data-act="add-var" style="align-self:flex-start">+ Add option</button></div>
      <button class="btn primary">${e.id ? 'Save changes' : 'Create product'}</button>
    </form>` : '';
    return `${form}${!e ? `<button class="btn primary" data-act="prod-new" style="margin-bottom:16px">+ New product</button>` : ''}
    <div class="surface table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Options</th><th>From</th><th>Status</th><th></th></tr></thead>
      <tbody>${A.products.map(p => `<tr>
        <td><b>${esc(p.emoji)} ${esc(p.name)}</b></td><td>${esc(p.category)}</td>
        <td class="small">${p.variants.map(v => `${esc(v.label)} · ${money(v.price)}`).join('<br>')}</td>
        <td class="mono">${money(p.from)}</td>
        <td><span class="status ${p.active ? 'confirmed' : 'cancelled'}">${p.active ? 'Active' : 'Hidden'}</span></td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-act="prod-edit" data-id="${p.id}">Edit</button><button class="btn sm" data-act="prod-toggle" data-id="${p.id}">${p.active ? 'Hide' : 'Show'}</button></div></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function adminBatches(A) {
    const b = V.editBatch;
    return `<div class="two-col" style="grid-template-columns:1fr 1fr">
      <div class="stack">
        <form class="surface pad stack" id="batch-form">
          <div class="spread"><h3>${b && b.id ? 'Edit batch' : 'New batch'}</h3>${b && b.id ? `<button type="button" class="btn sm" data-act="batch-new">Clear</button>` : ''}</div>
          <input type="hidden" name="id" value="${b && b.id ? b.id : 0}">
          <div class="form-grid">
            <div class="field"><label>Batch code</label><input class="input" name="code" value="${esc(b ? b.code : 'Batch ' + String(Math.max(0, ...A.batches.map(x => parseInt(String(x.code).replace(/\D/g, ''), 10) || 0)) + 1).padStart(2, '0'))}" required></div>
            <div class="field"><label>Title</label><input class="input" name="title" value="${esc(b ? b.title : '')}" placeholder="December restock"></div>
            <div class="field"><label>Origin</label><input class="input" name="origin" value="${esc(b ? b.origin : '')}" placeholder="Guangzhou · Istanbul"></div>
            <div class="field"><label>Status</label><select class="input" name="status">${['open', 'closed', 'ordered', 'shipped', 'arrived'].map(s => `<option value="${s}" ${b && b.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></div>
            <div class="field"><label>Closes on</label><input class="input" type="date" name="closes_at" value="${esc(b && b.closes_at ? b.closes_at.slice(0, 10) : '')}"></div>
            <div class="field"><label>ETA</label><input class="input" type="date" name="eta" value="${esc(b && b.eta ? b.eta.slice(0, 10) : '')}"></div>
          </div>
          <p class="hint">Setting a batch to “Open” closes any other open batch automatically.</p>
          <button class="btn primary">${b && b.id ? 'Save batch' : 'Create batch'}</button>
        </form>
        <div class="surface pad stack">
          <h3>Batches</h3>
          ${A.batches.map(x => `<div class="spread" style="border-top:1px solid var(--line-2);padding-top:10px">
            <div><b class="small">${esc(x.code)}</b> <span class="status ${esc(x.status)}">${statusLabel(x.status)}</span><div class="tiny muted">${x.orders} orders · ${money(x.value)} · ETA ${fmtDate(x.eta)}</div></div>
            <button class="btn sm" data-act="batch-edit" data-id="${x.id}">Edit</button></div>`).join('')}
        </div>
      </div>
      <div class="stack">
        <form class="surface pad stack" id="update-form">
          <h3>Post a batch update</h3>
          <div class="field"><label>Batch</label><select class="input" name="batch_id">${A.batches.map(x => `<option value="${x.id}" ${S.batch && S.batch.id === x.id ? 'selected' : ''}>${esc(x.code)} — ${esc(x.title)}</option>`).join('')}</select></div>
          <div class="field"><label>Headline</label><input class="input" name="title" placeholder="Cleared Lagos customs" required></div>
          <div class="field"><label>Details</label><textarea class="input" name="body" placeholder="Duty paid. Goods moved to our Ikeja facility."></textarea></div>
          <button class="btn primary">Publish update</button>
        </form>
        <div class="surface pad"><h3 style="margin-bottom:8px">Recent updates</h3>
          ${A.batches.flatMap(x => x.updates.map(u => ({ ...u, code: x.code }))).slice(0, 6).map(u => `<div class="tl-item" style="padding-left:0;margin-top:10px"><b>${esc(u.title)}</b><p>${esc(u.code)} · ${fmtDate(u.created_at)}</p></div>`).join('') || '<p class="small muted">Nothing posted yet.</p>'}
        </div>
      </div>
    </div>`;
  }

  function marketingPrompts() {
    const brand = S.settings.brand || 'Baza Market';
    const url = location.origin + location.pathname.replace(/index\.php$/, '');
    const context = `${brand} is a Nigerian group-buying and dropshipping storefront at ${url}. Customers browse a monthly import batch of home, kitchen, power, fashion and gadget products sourced from China and Turkey, choose exact sizes, build an automatic tally, pay by bank transfer and upload a payment receipt. A sales rep confirms the payment, which publishes the buyer's short name and quantity on a public group list for that batch. When the batch closes, the goods are imported in bulk and shipping updates are posted for everyone. Store owners get a Sales Desk to confirm payments, view receipts, manage products and sizes, create batches, publish updates and edit branding and bank details. It replaces the old WhatsApp routine of copying prices into private notes, doing manual arithmetic and manually updating a group list.`;
    return [
      {
        key: 'features', icon: '✨', title: 'App features',
        blurb: 'Positioning line, grouped feature bullets, hero blurb and pitch-deck highlights.',
        body: `You are a senior product marketer for a modern African e-commerce brand.

Product context: ${context}

Task: write the features section for the ${brand} website.
1. A one-line positioning statement, maximum 12 words.
2. Ten feature bullets grouped under four headings — Shopper experience, Operations, Trust and transparency, Admin tools. Each bullet: a bold feature name, then one sentence on the customer or business benefit.
3. A 60-word hero blurb that could sit under the headline.
4. Three feature highlights for a pitch deck, maximum 15 words each.

Rules: plain English, no jargon, no emojis, no invented features beyond the context. Write for a Nigerian audience.`
      },
      {
        key: 'how', icon: '🧭', title: 'How it works',
        blurb: 'Six customer steps, a WhatsApp/FAQ version and three trust lines.',
        body: `You are a customer education writer.

Product context: ${context}

Task: write a 'How it works' explainer for ${brand} customers.
1. Six numbered steps from browsing to receiving goods, maximum 18 words per step.
2. A 120-word summary version suitable for WhatsApp or an FAQ page.
3. Three reassurance lines covering payment safety, the public group list and delivery timing.

Tone: warm, confident, everyday Nigerian English. No emojis and no technical terms.`
      },
      {
        key: 'workflow', icon: '⚙️', title: 'Workflow',
        blurb: 'Stage-by-stage operations table, batch lifecycle and bottleneck fixes.',
        body: `You are an operations consultant for a cross-border e-commerce business.

Product context: ${context}

Task: map the end-to-end operating workflow for ${brand}, from sourcing to delivery.
1. A stage-by-stage table with the columns: Stage | What happens | Who owns it | System touchpoint | Customer-visible update.
2. Cover the full batch lifecycle — open, closed, ordered, shipped, arrived — and show where payment confirmation publishes a buyer's name on the group list.
3. List the five likeliest operational bottlenecks and a one-line fix for each.

Keep it practical for a small team of two to five people.`
      },
      {
        key: 'advantage', icon: '🏆', title: 'Advantages',
        blurb: 'Comparison table against WhatsApp and ordinary stores, plus subheads.',
        body: `You are a brand strategist.

Product context: ${context}

Task: write the 'Why ${brand}' advantages section.
1. A comparison table with rows for price transparency, order accuracy, payment proof, group visibility, delivery updates and customer support. Columns: WhatsApp plus private notes, a typical online store, and ${brand}.
2. Five punchy one-liners, maximum 14 words each, usable as website subheads.
3. A 100-word paragraph built to reassure a first-time buyer.

No hype and no invented statistics. Be specific and honest.`
      },
      {
        key: 'usecase', icon: '🛍️', title: 'Use cases',
        blurb: 'Eight Nigerian scenarios, three illustrative stories and a best-fit customer.',
        body: `You are a customer insights lead.

Product context: ${context}

Task: describe who ${brand} is for.
1. Eight realistic Nigerian use cases. For each give a bold scenario title, the situation in one sentence, and how the platform helps in one sentence. Include resellers restocking, office bulk orders, families, event planners, festive hampers, students, salon owners and small retailers.
2. Three illustrative customer stories of 60 words each. Label them clearly as illustrative.
3. One line naming the single best-fit customer and why.

Plain English, no jargon.`
      },
      {
        key: 'guide', icon: '📘', title: 'How to use',
        blurb: 'Beginner guide, common questions and a troubleshooting list.',
        body: `You are a customer support writer.

Product context: ${context}

Task: write a first-time buyer guide for ${brand}.
1. A 30-word intro.
2. Numbered steps from opening the shop link to receiving goods: choose product and size, set quantity, review the tally, checkout with name, phone and city, transfer to the bank details, upload the receipt, find your short name on the public group list, follow batch updates.
3. Six common questions with short answers.
4. Five troubleshooting problems and fixes: wrong size selected, receipt not confirmed, name missing from the list, batch already closed, delivery delay.

Use short bold step headings and keep every sentence simple.`
      },
      {
        key: 'sales', icon: '📣', title: 'Sales kit',
        blurb: 'Pitch, WhatsApp broadcast, Instagram caption, objections, follow-ups and referrals.',
        body: `You are the sales lead for ${brand}, a Nigerian group-buying store.

Product context: ${context}

Task: build a WhatsApp-first sales kit.
1. A 30-second spoken elevator pitch.
2. A WhatsApp broadcast under 90 words, at most one emoji, with a clear call to action and the shop link.
3. An Instagram caption of 120 words maximum plus eight relevant Nigerian e-commerce hashtags.
4. Objection handling in two sentences each for: 'It is too expensive', 'Is this legit?', 'Why should I pay before delivery?', 'What if the size is wrong?', 'When will it arrive?'.
5. A three-message follow-up sequence for someone who built a tally but did not pay.
6. A referral message asking a confirmed buyer to invite one friend.

Tone: confident, friendly and truthful. Never promise a delivery date that is not the batch ETA.`
      }
    ];
  }

  function adminMarketing() {
    const prompts = marketingPrompts();
    return `<div class="spread" style="margin-bottom:16px;align-items:flex-end">
      <div><h2>Marketing prompts</h2><p class="small muted" style="max-width:70ch">Copy any prompt into ChatGPT, Claude or Gemini. Each prompt already carries the product context, so it works on its own. Replace anything in [brackets] before sending.</p></div>
      <div class="row"><a class="btn sm" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT ↗</a><button class="btn sm primary" data-act="copy-prompts">Copy all ${prompts.length}</button></div>
    </div>
    <div class="prompt-grid">${prompts.map(p => `<div class="surface prompt-card">
      <div class="spread"><div class="row" style="gap:9px"><span class="promote-ico">${p.icon}</span><h3>${esc(p.title)}</h3></div><span class="pill tiny">${p.body.length} chars</span></div>
      <p class="small muted">${esc(p.blurb)}</p>
      <pre class="prompt-box">${esc(p.body)}</pre>
      <div class="spread"><span class="tiny muted">Paste into any AI chat</span><button class="btn sm" data-act="copy-prompt" data-key="${p.key}">Copy prompt</button></div>
    </div>`).join('')}</div>`;
  }

  function adminSettings(A) {
    const s = A.settings;
    return `<form class="surface pad-lg stack" id="settings-form" style="max-width:720px">
      <h3>Store settings</h3>
      <div class="form-grid">
        <div class="field"><label>Brand name</label><input class="input" name="brand" value="${esc(s.brand)}" required></div>
        <div class="field"><label>WhatsApp number</label><input class="input" name="whatsapp" value="${esc(s.whatsapp)}" placeholder="2348012345678"></div>
        <div class="field full"><label>Tagline</label><input class="input" name="tagline" value="${esc(s.tagline)}"></div>
        <div class="field"><label>Bank</label><input class="input" name="bank_name" value="${esc(s.bank_name)}"></div>
        <div class="field"><label>Account number</label><input class="input" name="bank_account" value="${esc(s.bank_account)}"></div>
        <div class="field"><label>Account name</label><input class="input" name="account_name" value="${esc(s.account_name)}"></div>
        <div class="field"><label>New admin passcode (optional)</label><input class="input" name="new_pass" type="text" placeholder="Leave blank to keep current"></div>
        <div class="field full"><label>Support note shown to buyers</label><textarea class="input" name="support_note">${esc(s.support_note || '')}</textarea></div>
      </div>
      <button class="btn primary" style="align-self:flex-start">Save settings</button>
      <p class="hint">Demo passcode is <b>admin123</b>. Change it before sharing this link.</p>
    </form>`;
  }

  /* ---------------- render ---------------- */
  async function render() {
    const r = parseHash();
    if (r.page === 'order' && r.param) {
      if (!V.order || V.order.code !== r.param) await fetchOrder(r.param);
    }
    if (r.page === 'admin' && S.admin && !V.admin) await loadAdmin();
    let page;
    switch (r.page) {
      case 'product': page = productPage(r.param); break;
      case 'checkout': page = checkoutPage(); break;
      case 'order': page = orderPage(); break;
      case 'group': page = groupPage(); break;
      case 'batches': page = batchesPage(); break;
      case 'admin': page = adminPage(); break;
      case 'cart': page = checkoutPage(); break;
      default: page = shopPage();
    }
    app.innerHTML = header(r) + `<main>${page}</main>` + footer() + drawer();
    if (!V._scrolled) { window.scrollTo({ top: 0, behavior: 'instant' }); }
    V._scrolled = false;
  }

  async function fetchOrder(code) {
    V.order = null; V.orderErr = null;
    try { V.order = (await api('order.get?code=' + encodeURIComponent(code))).order; }
    catch (e) { V.orderErr = e.message; }
  }

  async function loadAdmin() {
    try { V.admin = await api('admin.data'); }
    catch (e) { if (/session/i.test(e.message)) { S.admin = false; V.admin = null; } else toast(e.message); }
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    try {
      switch (act) {
        case 'open': go('product/' + id); break;
        case 'filter': S.filter = el.dataset.cat; render(); break;
        case 'cart-toggle': V.cartOpen = !V.cartOpen; V._scrolled = true; render(); break;
        case 'cart-close': if (V.cartOpen) { V.cartOpen = false; V._scrolled = true; render(); } break;
        case 'opt': V.variant = +id; V._scrolled = true; render(); break;
        case 'q-minus': V.qty = Math.max(1, V.qty - 1); V._scrolled = true; render(); break;
        case 'q-plus': V.qty = Math.min(99, V.qty + 1); V._scrolled = true; render(); break;
        case 'add': if (V.variant) addToCart(V.variant, V.qty); break;
        case 'inc': { const it = V.cart.find(i => i.variant_id == id); if (it) { it.qty = Math.min(99, it.qty + 1); saveCart(); render(); } } break;
        case 'dec': { const it = V.cart.find(i => i.variant_id == id); if (it) { it.qty--; if (it.qty < 1) V.cart = V.cart.filter(i => i !== it); saveCart(); render(); } } break;
        case 'checkout': V.cartOpen = false; go('checkout'); break;
        case 'copy-cart': copy(tallyText(cartRows(), cartTotal())); break;
        case 'copy-order': {
          if (!V.order) break;
          copy(tallyText(V.order.items.map(i => ({ product: i.product, label: i.label, price: +i.price, qty: +i.qty })), V.order.total, el.dataset.code));
          break;
        }
        case 'copy-bank': copy(`${S.settings.bank_name}\n${S.settings.bank_account}\n${S.settings.account_name}\nNarration: ${V.order ? V.order.code : ''}`); break;
        case 'copy-prompt': {
          const p = marketingPrompts().find(x => x.key === el.dataset.key);
          if (p) copy(p.body);
          break;
        }
        case 'copy-prompts': copy(marketingPrompts().map(p => `## ${p.title}\n\n${p.body}`).join('\n\n---\n\n')); break;
        case 'tab': V.adminTab = el.dataset.tab; V.edit = null; V.editBatch = null; V._scrolled = true; render(); break;
        case 'admin-out': await api('admin.logout', {}); S.admin = false; V.admin = null; V.edit = null; toast('Signed out'); render(); break;
        case 'ord': {
          const labels = { confirm: 'confirmed', cancel: 'cancelled', deliver: 'delivered' };
          await api('admin.order', { id: +id, action: el.dataset.do });
          await Promise.all([loadAdmin(), sync()]);
          toast(`Order ${labels[el.dataset.do]}`);
          render(); break;
        }
        case 'prod-new': V.edit = { name: '', category: '', emoji: '📦', description: '', active: 1, variants: [{ id: 0, label: '', price: '' }] }; V._scrolled = true; render(); break;
        case 'prod-edit': {
          const p = V.admin.products.find(x => x.id == id);
          V.edit = { ...p, variants: p.variants.map(v => ({ ...v })) }; V._scrolled = true; render(); break;
        }
        case 'edit-close': V.edit = null; render(); break;
        case 'prod-toggle': await api('admin.toggle', { id: +id }); await Promise.all([loadAdmin(), sync()]); render(); break;
        case 'add-var': {
          const rows = document.getElementById('variant-rows');
          const div = document.createElement('div');
          div.className = 'row vrow-edit'; div.dataset.id = '0';
          div.innerHTML = `<input class="input v-label" placeholder="e.g. 12 Litre" style="flex:2"><input class="input v-price" type="number" min="0" placeholder="Price ₦" style="flex:1"><button type="button" class="icon-btn" data-act="del-var">✕</button>`;
          rows.appendChild(div); break;
        }
        case 'del-var': el.closest('.vrow-edit').remove(); break;
        case 'batch-new': V.editBatch = null; render(); break;
        case 'batch-edit': { const b = V.admin.batches.find(x => x.id == id); V.editBatch = { ...b }; V._scrolled = true; render(); break; }
      }
    } catch (err) { toast(err.message); }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target;
    e.preventDefault();
    const fd = new FormData(f);
    try {
      if (f.id === 'checkout-form') {
        if (V.busy) return;
        V.busy = true; render();
        const payload = {
          name: fd.get('name'), phone: fd.get('phone'), city: fd.get('city'),
          address: fd.get('address'), note: fd.get('note'),
          items: V.cart.map(i => ({ variant_id: i.variant_id, qty: i.qty }))
        };
        const res = await api('order.create', payload);
        V.cart = []; saveCart(); V.busy = false;
        V.order = res.order;
        toast('Order placed — now send your receipt');
        go('order/' + res.order.code);
        return;
      }
      if (f.id === 'login-form') {
        await api('admin.login', { pass: fd.get('pass') });
        S.admin = true; V.admin = null; toast('Welcome back');
        await loadAdmin(); render(); return;
      }
      if (f.id === 'product-form') {
        const variants = [...document.querySelectorAll('#variant-rows .vrow-edit')].map(r => ({
          id: +r.dataset.id || 0,
          label: r.querySelector('.v-label').value.trim(),
          price: +r.querySelector('.v-price').value || 0
        })).filter(v => v.label);
        await api('admin.product', {
          id: V.edit.id || 0, name: fd.get('name'), category: fd.get('category'), emoji: fd.get('emoji'),
          description: fd.get('description'), active: fd.get('active') === '1', variants
        });
        V.edit = null; await Promise.all([loadAdmin(), sync()]); toast('Product saved'); render(); return;
      }
      if (f.id === 'batch-form') {
        await api('admin.batch', {
          id: +fd.get('id') || 0, code: fd.get('code'), title: fd.get('title'), origin: fd.get('origin'),
          status: fd.get('status'), closes_at: fd.get('closes_at'), eta: fd.get('eta')
        });
        V.editBatch = null; await Promise.all([loadAdmin(), sync()]); toast('Batch saved'); render(); return;
      }
      if (f.id === 'update-form') {
        await api('admin.update', { batch_id: +fd.get('batch_id'), title: fd.get('title'), body: fd.get('body') });
        await Promise.all([loadAdmin(), sync()]); toast('Update published'); render(); return;
      }
      if (f.id === 'settings-form') {
        const body = {}; ['brand', 'tagline', 'whatsapp', 'bank_name', 'bank_account', 'account_name', 'support_note', 'new_pass'].forEach(k => { if (fd.get(k)) body[k] = fd.get(k); });
        await api('admin.settings', body);
        await Promise.all([loadAdmin(), sync()]); toast('Settings saved'); render(); return;
      }
    } catch (err) { V.busy = false; toast(err.message); render(); }
  });

  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'receipt-input' || !V.order) return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const code = V.order.code;
      toast('Compressing receipt…');
      const data = await downscale(file);
      await api('order.receipt', { code, receipt: data });
      await fetchOrder(code);
      toast('Receipt uploaded — the rep will confirm shortly');
      render();
    } catch (err) { toast(err.message); }
  });

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && V.cartOpen) { V.cartOpen = false; render(); } });

  let lastHash = '';
  window.addEventListener('hashchange', () => {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    V._scrolled = false; V.orderErr = null;
    render().catch(err => toast(err.message));
  });

  /* ---------------- boot ---------------- */
  (async () => {
    loadCart();
    try {
      await sync();
      if (!location.hash) history.replaceState(null, '', '#/shop');
      lastHash = location.hash;
      render();
    } catch (e) {
      app.innerHTML = `<div class="boot"><p>Could not reach the server.</p><p class="small">${esc(e.message)}</p></div>`;
    }
  })();
})();
