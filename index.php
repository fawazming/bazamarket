<?php require __DIR__ . '/lib/db.php'; $s = settings(); ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= htmlspecialchars($s['brand']) ?> — Group buying, made simple</title>
<meta name="description" content="<?= htmlspecialchars($s['tagline']) ?>">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='26' fill='%230f9d76'/><text x='50' y='70' font-size='58' font-family='sans-serif' font-weight='700' fill='white' text-anchor='middle'>B</text></svg>">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div id="app" class="app">
  <div class="boot"><span class="spinner"></span><p>Loading <?= htmlspecialchars($s['brand']) ?>…</p></div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>window.__BRAND__ = <?= json_encode($s['brand']) ?>;</script>
<script src="assets/app.js"></script>
</body>
</html>
