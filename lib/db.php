<?php
declare(strict_types=1);

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    if (!is_dir($dir . '/receipts')) @mkdir($dir . '/receipts', 0777, true);
    $pdo = new PDO('sqlite:' . $dir . '/store.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT, title TEXT, origin TEXT,
        status TEXT DEFAULT 'open',
        closes_at TEXT, eta TEXT, created_at TEXT
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, category TEXT, emoji TEXT, description TEXT,
        active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER, label TEXT, price INTEGER, sort INTEGER DEFAULT 0
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE, customer_name TEXT, phone TEXT,
        city TEXT, address TEXT, note TEXT,
        total INTEGER, status TEXT DEFAULT 'pending',
        batch_id INTEGER, receipt TEXT, created_at TEXT, updated_at TEXT
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER, product_id INTEGER, variant_id INTEGER,
        qty INTEGER, price INTEGER
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER, title TEXT, body TEXT, created_at TEXT
    )");
    if ((int)$pdo->query("SELECT COUNT(*) FROM products")->fetchColumn() === 0) seed($pdo);
}

function seed(PDO $pdo): void {
    $now = date('c');
    $set = $pdo->prepare("INSERT OR REPLACE INTO settings (k,v) VALUES (?,?)");
    $settings = [
        'brand' => 'Baza Market',
        'tagline' => 'Buy together. Pay less. Get it delivered.',
        'whatsapp' => '2348012345678',
        'bank_name' => 'Moniepoint MFB',
        'bank_account' => '8123456789',
        'account_name' => 'Baza Market Ltd',
        'admin_pass' => password_hash('admin123', PASSWORD_DEFAULT),
        'support_note' => 'Send your receipt to the sales rep on WhatsApp. Names are added to the group list once payment is confirmed.',
    ];
    foreach ($settings as $k => $v) $set->execute([$k, $v]);

    $b = $pdo->prepare("INSERT INTO batches (code,title,origin,status,closes_at,eta,created_at) VALUES (?,?,?,?,?,?,?)");
    $b->execute(['Batch 09', 'December restock', 'Guangzhou · Istanbul', 'open', '2026-12-05', '2027-01-08', $now]);
    $b->execute(['Batch 08', 'November restock', 'Guangzhou', 'shipped', '2026-11-03', '2026-12-12', $now]);
    $b->execute(['Batch 07', 'October restock', 'Istanbul · Lagos', 'arrived', '2026-10-02', '2026-10-29', $now]);

    $products = [
        ['Insulated Cooler Box', 'Home', '🧊', 'Rotomoulded cooler that keeps drinks cold for up to 48 hours. Perfect for events, travel and harmattan heat.', [
            ['12 Litre', 18500], ['24 Litre', 26000], ['36 Litre', 34500],
        ]],
        ['Vacuum Flask', 'Kitchen', '🍶', 'Double-walled stainless flask. Hot for 12 hours, cold for 24. Leak-proof lid.', [
            ['500 ml', 5800], ['1 Litre', 7200], ['1.5 Litre', 9100],
        ]],
        ['Rechargeable Standing Fan', 'Power', '🌀', 'Runs 6–9 hours on a full charge with USB backup and remote control.', [
            ['12 inch', 29000], ['16 inch', 38500],
        ]],
        ['Air Fryer 5.5L', 'Kitchen', '🍟', 'Oil-free frying with digital touch panel, 8 presets and a dishwasher-safe basket.', [
            ['5.5 Litre', 52000],
        ]],
        ['Solar Flood Light', 'Power', '💡', 'Weatherproof solar flood light with motion sensor and remote. Zero electricity cost.', [
            ['60W', 12400], ['100W', 17900],
        ]],
        ['Retro Sneakers', 'Fashion', '👟', 'Unisex retro court sneakers with cushioned sole. True to size.', [
            ['Size 40', 21000], ['Size 41', 21000], ['Size 42', 21000], ['Size 43', 21000], ['Size 44', 21000], ['Size 45', 21000],
        ]],
        ['Kitchen Knife Set', 'Kitchen', '🔪', 'Six-piece stainless knife set with wooden block and sharpener.', [
            ['6 pieces', 15300],
        ]],
        ['Bluetooth Speaker', 'Gadgets', '🔊', 'Deep bass, 12-hour battery, IPX6 splash-proof. Pairs with any phone.', [
            ['Mini', 8800], ['Pro', 14500],
        ]],
    ];
    $pi = $pdo->prepare("INSERT INTO products (name,category,emoji,description,active,sort,created_at) VALUES (?,?,?,?,1,?,?)");
    $vi = $pdo->prepare("INSERT INTO variants (product_id,label,price,sort) VALUES (?,?,?,?)");
    $map = [];
    foreach ($products as $i => $p) {
        $pi->execute([$p[0], $p[1], $p[2], $p[3], $i, $now]);
        $pid = (int)$pdo->lastInsertId();
        foreach ($p[4] as $j => $v) $vi->execute([$pid, $v[0], $v[1], $j]);
        $map[$p[0]] = $pid;
    }
    $vid = fn(string $name, string $label) => (int)$pdo->query("SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE p.name='$name' AND v.label='$label'")->fetchColumn();

    $batchId = (int)$pdo->query("SELECT id FROM batches WHERE code='Batch 09'")->fetchColumn();
    $seedOrder = function (string $code, string $name, string $phone, string $city, array $items) use ($pdo, $batchId, $now, $vid) {
        $total = 0; $rows = [];
        foreach ($items as $it) { $v = $vid($it[0], $it[1]); $pid = $pdo->query("SELECT product_id FROM variants WHERE id=$v")->fetchColumn(); $price = (int)$pdo->query("SELECT price FROM variants WHERE id=$v")->fetchColumn(); $total += $price * $it[2]; $rows[] = [$pid, $v, $it[2], $price]; }
        $pdo->prepare("INSERT INTO orders (code,customer_name,phone,city,address,note,total,status,batch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'confirmed',?,?,?)")
            ->execute([$code, $name, $phone, $city, '', '', $total, $batchId, $now, $now]);
        $oid = (int)$pdo->lastInsertId();
        $ins = $pdo->prepare("INSERT INTO order_items (order_id,product_id,variant_id,qty,price) VALUES (?,?,?,?,?)");
        foreach ($rows as $r) $ins->execute([$oid, $r[0], $r[1], $r[2], $r[3]]);
    };
    $seedOrder('BZ-7K2QA', 'Aisha Bello', '08031112222', 'Abuja', [['Insulated Cooler Box', '12 Litre', 3], ['Vacuum Flask', '1 Litre', 2]]);
    $seedOrder('BZ-4M8RT', 'Chinedu Okeke', '08065554444', 'Lagos', [['Insulated Cooler Box', '12 Litre', 2], ['Rechargeable Standing Fan', '16 inch', 1]]);
    $seedOrder('BZ-9LP3W', 'Fatima Yusuf', '07099887766', 'Kano', [['Insulated Cooler Box', '12 Litre', 4], ['Solar Flood Light', '100W', 2]]);
    $seedOrder('BZ-2XH6D', 'Tunde Adeyemi', '08144556677', 'Ibadan', [['Insulated Cooler Box', '12 Litre', 2], ['Vacuum Flask', '1 Litre', 1]]);
    $seedOrder('BZ-6NQ1S', 'Grace Eze', '09022334455', 'Enugu', [['Air Fryer 5.5L', '5.5 Litre', 1], ['Bluetooth Speaker', 'Mini', 2]]);

    $u = $pdo->prepare("INSERT INTO updates (batch_id,title,body,created_at) VALUES (?,?,?,?)");
    $b8 = (int)$pdo->query("SELECT id FROM batches WHERE code='Batch 08'")->fetchColumn();
    $b7 = (int)$pdo->query("SELECT id FROM batches WHERE code='Batch 07'")->fetchColumn();
    $u->execute([$batchId, 'Batch 09 is now open', 'New sizes added to the cooler and flask lines. Payment confirms your slot — first come, first served.', $now]);
    $u->execute([$b8, 'Left Guangzhou', 'Cargo departed the Guangzhou warehouse. Tracking shared with confirmed buyers.', $now]);
    $u->execute([$b8, 'Cleared Lagos customs', 'Duty paid. Goods moved to our Ikeja holding facility for sorting.', $now]);
    $u->execute([$b7, 'Batch 07 delivered', 'All confirmed orders have been dispatched. Thank you for buying together.', $now]);
}

function settings(): array {
    $out = [];
    foreach (db()->query("SELECT k,v FROM settings") as $r) $out[$r['k']] = $r['v'];
    return $out;
}

function set_setting(string $k, string $v): void {
    db()->prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")->execute([$k, $v]);
}

function public_name(string $full): string {
    $parts = preg_split('/\s+/', trim($full));
    if (count($parts) < 2) return $parts[0] ?? 'Buyer';
    return $parts[0] . ' ' . strtoupper(mb_substr(end($parts), 0, 1)) . '.';
}

function current_batch(): ?array {
    $b = db()->query("SELECT * FROM batches ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, Id DESC LIMIT 1")->fetch();
    return $b ?: null;
}
