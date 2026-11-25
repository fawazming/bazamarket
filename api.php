<?php
declare(strict_types=1);
session_start();
require __DIR__ . '/lib/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$route = $_GET['r'] ?? 'bootstrap';
$in = [];
$raw = file_get_contents('php://input');
if ($raw) { $j = json_decode($raw, true); if (is_array($j)) $in = $j; }
$in = array_merge($in, $_POST);

function out($data, int $code = 200): void { http_response_code($code); echo json_encode($data); exit; }
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }
function is_admin(): bool { return !empty($_SESSION['admin']); }
function require_admin(): void { if (!is_admin()) fail('Admin session required', 401); }
function money(int $n): string { return '₦' . number_format($n); }

function product_list(): array {
    $ps = db()->query("SELECT * FROM products ORDER BY sort, id")->fetchAll();
    $vs = db()->query("SELECT * FROM variants ORDER BY sort, id")->fetchAll();
    foreach ($ps as &$p) {
        $p['variants'] = array_values(array_filter($vs, fn($v) => (int)$v['product_id'] === (int)$p['id']));
        $p['from'] = $p['variants'] ? min(array_column($p['variants'], 'price')) : 0;
    }
    return $ps;
}

function group_list(?int $batchId = null): array {
    $batchId = $batchId ?? (int)(current_batch()['id'] ?? 0);
    if (!$batchId) return [];
    $st = db()->prepare("SELECT o.id oid, o.customer_name, o.created_at, p.id pid, p.name pname, p.emoji,
                                v.id vid, v.label, SUM(oi.qty) qty, SUM(oi.qty * oi.price) amount
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        JOIN variants v ON v.id = oi.variant_id
        WHERE o.status IN ('confirmed','delivered') AND o.batch_id = ?
        GROUP BY o.id, v.id
        ORDER BY o.created_at ASC");
    $st->execute([$batchId]);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $pid = (int)$r['pid']; $vid = (int)$r['vid'];
        if (!isset($out[$pid])) $out[$pid] = ['id'=>$pid,'name'=>$r['pname'],'emoji'=>$r['emoji'],'variants'=>[],'units'=>0,'buyers'=>0];
        if (!isset($out[$pid]['variants'][$vid])) $out[$pid]['variants'][$vid] = ['id'=>$vid,'label'=>$r['label'],'buyers'=>[],'units'=>0];
        $out[$pid]['variants'][$vid]['buyers'][] = ['name'=>public_name($r['customer_name']), 'qty'=>(int)$r['qty']];
        $out[$pid]['variants'][$vid]['units'] += (int)$r['qty'];
        $out[$pid]['units'] += (int)$r['qty'];
    }
    foreach ($out as &$p) {
        $p['variants'] = array_values($p['variants']);
        $p['buyers'] = array_sum(array_map(fn($v) => count($v['buyers']), $p['variants']));
        usort($p['variants'], fn($a, $b) => $b['units'] <=> $a['units']);
        $p['variants'] = array_values($p['variants']);
    }
    usort($out, fn($a, $b) => $b['units'] <=> $a['units']);
    return array_values($out);
}

function batch_list(): array {
    $bs = db()->query("SELECT * FROM batches ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END, id DESC")->fetchAll();
    $us = db()->query("SELECT * FROM updates ORDER BY id DESC")->fetchAll();
    foreach ($bs as &$b) {
        $b['updates'] = array_values(array_filter($us, fn($u) => (int)$u['batch_id'] === (int)$b['id']));
        $st = db()->prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM orders WHERE batch_id = ? AND status IN ('confirmed','delivered')");
        $st->execute([$b['id']]);
        $r = $st->fetch();
        $b['orders'] = (int)$r['c']; $b['value'] = (int)$r['t'];
    }
    return $bs;
}

function order_detail(string $code, bool $admin = false): array {
    $st = db()->prepare("SELECT * FROM orders WHERE code = ?");
    $st->execute([$code]);
    $o = $st->fetch();
    if (!$o) fail('Order not found', 404);
    $items = db()->prepare("SELECT oi.*, p.name product, p.emoji, v.label FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN variants v ON v.id=oi.variant_id WHERE oi.order_id = ?");
    $items->execute([$o['id']]);
    $o['items'] = $items->fetchAll();
    $b = db()->prepare("SELECT code,status,eta,closes_at FROM batches WHERE id = ?");
    $b->execute([$o['batch_id']]);
    $o['batch'] = $b->fetch() ?: null;
    $o['has_receipt'] = !empty($o['receipt']);
    $o['public_name'] = public_name($o['customer_name']);
    unset($o['receipt']);
    if (!$admin) unset($o['phone'], $o['address'], $o['customer_name']);
    return $o;
}

function tally_text(array $items, array $batch, int $total): string {
    $lines = ['*' . settings()['brand'] . ' — ' . ($batch['code'] ?? 'Order') . '*'];
    foreach ($items as $i => $it) {
        $lines[] = ($i + 1) . '. ' . $it['product'] . ' — ' . $it['label'] . ' · ' . money((int)$it['price']) . ' × ' . $it['qty'] . ' = ' . money((int)$it['price'] * (int)$it['qty']);
    }
    $lines[] = 'TOTAL: ' . money($total);
    return implode("\n", $lines);
}

try {
    switch ($route) {
        case 'bootstrap':
            out([
                'settings' => array_diff_key(settings(), ['admin_pass' => 1]),
                'products' => array_values(array_filter(product_list(), fn($p) => (int)$p['active'] === 1)),
                'batch' => current_batch(),
                'batches' => batch_list(),
                'group' => group_list(),
                'admin' => is_admin(),
            ]);

        case 'order.create':
            $name = trim((string)($in['name'] ?? ''));
            $phone = trim((string)($in['phone'] ?? ''));
            $city = trim((string)($in['city'] ?? ''));
            $items = $in['items'] ?? [];
            if (mb_strlen($name) < 2) fail('Please enter your full name');
            if (!preg_match('/^[0-9+ ]{7,16}$/', $phone)) fail('Please enter a valid phone number');
            if (!$city) fail('Please enter your delivery city');
            if (!is_array($items) || !$items) fail('Your cart is empty');
            $batch = current_batch();
            if (!$batch || $batch['status'] !== 'open') fail('No batch is currently open for orders');
            $rows = []; $total = 0;
            foreach ($items as $it) {
                $vid = (int)($it['variant_id'] ?? 0);
                $qty = max(1, min(99, (int)($it['qty'] ?? 1)));
                $v = db()->prepare("SELECT v.*, p.name product, p.emoji FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id = ? AND p.active = 1");
                $v->execute([$vid]);
                $v = $v->fetch();
                if (!$v) continue;
                $rows[] = ['product_id'=>(int)$v['product_id'], 'variant_id'=>$vid, 'qty'=>$qty, 'price'=>(int)$v['price'], 'product'=>$v['product'], 'label'=>$v['label'], 'emoji'=>$v['emoji']];
                $total += (int)$v['price'] * $qty;
            }
            if (!$rows) fail('None of the selected items are available');
            $alpha = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
            do { $code = 'BZ-'; for ($i = 0; $i < 5; $i++) $code .= $alpha[random_int(0, strlen($alpha) - 1)]; }
            while (db()->query("SELECT COUNT(*) FROM orders WHERE code='$code'")->fetchColumn() > 0);
            $now = date('c');
            db()->prepare("INSERT INTO orders (code,customer_name,phone,city,address,note,total,status,batch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?,?)")
                ->execute([$code, $name, $phone, $city, trim((string)($in['address'] ?? '')), trim((string)($in['note'] ?? '')), $total, $batch['id'], $now, $now]);
            $oid = (int)db()->lastInsertId();
            $ins = db()->prepare("INSERT INTO order_items (order_id,product_id,variant_id,qty,price) VALUES (?,?,?,?,?)");
            foreach ($rows as $r) $ins->execute([$oid, $r['product_id'], $r['variant_id'], $r['qty'], $r['price']]);
            $detail = order_detail($code);
            out([
                'order' => $detail,
                'items' => array_map(fn($r) => ['product'=>$r['product'],'label'=>$r['label'],'price'=>$r['price'],'qty'=>$r['qty']], $rows),
                'tally' => tally_text($rows, $batch, $total),
                'bank' => ['name'=>settings()['bank_name'],'account'=>settings()['bank_account'],'holder'=>settings()['account_name']],
            ]);

        case 'order.get':
            $o = order_detail((string)($_GET['code'] ?? ''));
            out(['order' => $o, 'settings' => array_diff_key(settings(), ['admin_pass' => 1])]);

        case 'order.receipt':
            $code = (string)($in['code'] ?? '');
            $img = (string)($in['receipt'] ?? '');
            if (!preg_match('#^data:image/(png|jpe?g|webp);base64,#', $img)) fail('Please upload a PNG or JPG image');
            if (strlen($img) > 3_000_000) fail('Image is too large — try a smaller screenshot');
            $st = db()->prepare("UPDATE orders SET receipt = ?, updated_at = ? WHERE code = ?");
            $st->execute([$img, date('c'), $code]);
            if (!$st->rowCount()) fail('Order not found', 404);
            out(['ok' => true]);

        case 'receipt.file':
            require_admin();
            $st = db()->prepare("SELECT receipt FROM orders WHERE id = ?");
            $st->execute([(int)($_GET['id'] ?? 0)]);
            $receipt = (string)$st->fetchColumn();
            if (!preg_match('#^data:(image/[\w.+-]+);base64,(.+)$#s', $receipt, $m)) fail('No receipt', 404);
            header('Content-Type: ' . $m[1]);
            header('Cache-Control: private, max-age=300');
            echo base64_decode($m[2]);
            exit;

        case 'admin.login':
            $pass = (string)($in['pass'] ?? '');
            if (!password_verify($pass, (string)settings()['admin_pass'])) fail('Wrong passcode', 401);
            $_SESSION['admin'] = true;
            out(['ok' => true]);

        case 'admin.logout':
            $_SESSION = [];
            out(['ok' => true]);

        case 'admin.data':
            require_admin();
            $orders = db()->query("SELECT * FROM orders ORDER BY id DESC LIMIT 200")->fetchAll();
            $items = db()->query("SELECT oi.*, COALESCE(p.name,'Removed item') product, COALESCE(v.label,'—') label
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
                LEFT JOIN variants v ON v.id = oi.variant_id")->fetchAll();
            foreach ($orders as &$o) {
                $o['items'] = array_values(array_filter($items, fn($i) => (int)$i['order_id'] === (int)$o['id']));
                $o['has_receipt'] = !empty($o['receipt']);
                $o['public_name'] = public_name($o['customer_name']);
                unset($o['receipt']);
            }
            $stats = db()->query("SELECT
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
                SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) confirmed,
                SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) delivered,
                SUM(CASE WHEN status IN ('confirmed','delivered') THEN total ELSE 0 END) revenue
                FROM orders")->fetch();
            out([
                'settings' => array_diff_key(settings(), ['admin_pass' => 1]),
                'orders' => $orders,
                'products' => product_list(),
                'batches' => batch_list(),
                'group' => group_list(),
                'stats' => $stats,
            ]);

        case 'admin.order':
            require_admin();
            $id = (int)($in['id'] ?? 0);
            $action = (string)($in['action'] ?? '');
            $map = ['confirm' => 'confirmed', 'cancel' => 'cancelled', 'deliver' => 'delivered', 'pending' => 'pending'];
            if (!isset($map[$action])) fail('Unknown action');
            db()->prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")->execute([$map[$action], date('c'), $id]);
            out(['ok' => true]);

        case 'admin.product':
            require_admin();
            $id = (int)($in['id'] ?? 0);
            $name = trim((string)($in['name'] ?? ''));
            $variants = $in['variants'] ?? [];
            if (!$name) fail('Product name is required');
            if (!is_array($variants) || !$variants) fail('Add at least one size or option');
            $now = date('c');
            if ($id) {
                db()->prepare("UPDATE products SET name=?, category=?, emoji=?, description=?, active=? WHERE id=?")
                    ->execute([$name, (string)($in['category'] ?? 'General'), (string)($in['emoji'] ?? '📦'), (string)($in['description'] ?? ''), empty($in['active']) ? 0 : 1, $id]);
                $keep = [];
                foreach ($variants as $i => $v) {
                    $vid = (int)($v['id'] ?? 0);
                    $price = max(0, (int)($v['price'] ?? 0));
                    $label = trim((string)($v['label'] ?? ''));
                    if (!$label) continue;
                    if ($vid) { db()->prepare("UPDATE variants SET label=?, price=?, sort=? WHERE id=? AND product_id=?")->execute([$label, $price, $i, $vid, $id]); $keep[] = $vid; }
                    else { db()->prepare("INSERT INTO variants (product_id,label,price,sort) VALUES (?,?,?,?)")->execute([$id, $label, $price, $i]); $keep[] = (int)db()->lastInsertId(); }
                }
                if ($keep) db()->prepare("DELETE FROM variants WHERE product_id=? AND id NOT IN (" . implode(',', array_map('intval', $keep)) . ")")->execute([$id]);
            } else {
                db()->prepare("INSERT INTO products (name,category,emoji,description,active,sort,created_at) VALUES (?,?,?,?,1,?,?)")
                    ->execute([$name, (string)($in['category'] ?? 'General'), (string)($in['emoji'] ?? '📦'), (string)($in['description'] ?? ''), 999, $now]);
                $id = (int)db()->lastInsertId();
                foreach ($variants as $i => $v) {
                    $label = trim((string)($v['label'] ?? ''));
                    if (!$label) continue;
                    db()->prepare("INSERT INTO variants (product_id,label,price,sort) VALUES (?,?,?,?)")->execute([$id, $label, max(0, (int)($v['price'] ?? 0)), $i]);
                }
            }
            out(['ok' => true, 'id' => $id]);

        case 'admin.toggle':
            require_admin();
            db()->prepare("UPDATE products SET active = 1 - active WHERE id = ?")->execute([(int)($in['id'] ?? 0)]);
            out(['ok' => true]);

        case 'admin.batch':
            require_admin();
            $id = (int)($in['id'] ?? 0);
            $status = (string)($in['status'] ?? 'open');
            if (!in_array($status, ['open', 'closed', 'ordered', 'shipped', 'arrived'], true)) fail('Unknown batch status');
            if ($status === 'open') db()->exec("UPDATE batches SET status = CASE WHEN status = 'open' THEN 'closed' ELSE status END WHERE status = 'open'");
            if ($id) {
                db()->prepare("UPDATE batches SET code=?, title=?, origin=?, status=?, closes_at=?, eta=? WHERE id=?")
                    ->execute([(string)($in['code'] ?? ''), (string)($in['title'] ?? ''), (string)($in['origin'] ?? ''), $status, (string)($in['closes_at'] ?? ''), (string)($in['eta'] ?? ''), $id]);
            } else {
                db()->prepare("INSERT INTO batches (code,title,origin,status,closes_at,eta,created_at) VALUES (?,?,?,?,?,?,?)")
                    ->execute([(string)($in['code'] ?? 'Batch'), (string)($in['title'] ?? ''), (string)($in['origin'] ?? ''), $status, (string)($in['closes_at'] ?? ''), (string)($in['eta'] ?? ''), date('c')]);
            }
            out(['ok' => true]);

        case 'admin.update':
            require_admin();
            $title = trim((string)($in['title'] ?? ''));
            if (!$title) fail('Update title is required');
            db()->prepare("INSERT INTO updates (batch_id,title,body,created_at) VALUES (?,?,?,?)")
                ->execute([(int)($in['batch_id'] ?? 0), $title, trim((string)($in['body'] ?? '')), date('c')]);
            out(['ok' => true]);

        case 'admin.settings':
            require_admin();
            foreach (['brand','tagline','whatsapp','bank_name','bank_account','account_name','support_note'] as $k) {
                if (isset($in[$k])) set_setting($k, trim((string)$in[$k]));
            }
            if (!empty($in['new_pass'])) {
                if (strlen((string)$in['new_pass']) < 5) fail('Passcode must be at least 5 characters');
                set_setting('admin_pass', password_hash((string)$in['new_pass'], PASSWORD_DEFAULT));
            }
            out(['ok' => true]);

        default:
            fail('Unknown route', 404);
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
