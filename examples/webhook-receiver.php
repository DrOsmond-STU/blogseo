<?php
// Contoh penerima webhook BlogSEO untuk website PHP biasa (shared hosting).
// Simpan file ini, misalnya di https://websiteanda.com/blogseo.php,
// lalu daftarkan URL tersebut sebagai situs tipe "Webhook" dengan secret yang sama.

const BLOGSEO_SECRET = 'ganti-dengan-secret-yang-sama';

$raw = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_BLOGSEO_SIGNATURE'] ?? '';
if (!hash_equals(hash_hmac('sha256', $raw, BLOGSEO_SECRET), $signature)) {
    http_response_code(401);
    exit('signature tidak valid');
}

$data = json_decode($raw, true);
header('Content-Type: application/json');

if (($data['event'] ?? '') === 'ping') {
    echo json_encode(['ok' => true]);
    exit;
}

// Contoh sederhana: simpan artikel sebagai file HTML statis.
// Ganti bagian ini dengan INSERT ke database CMS Anda.
$slug = preg_replace('/[^a-z0-9-]/', '', $data['slug'] ?: uniqid('post-'));
$dir = __DIR__ . '/artikel';
if (!is_dir($dir)) mkdir($dir, 0755, true);

$title = htmlspecialchars($data['title'], ENT_QUOTES, 'UTF-8');
$desc = htmlspecialchars($data['excerpt'] ?? '', ENT_QUOTES, 'UTF-8');
$page = "<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\">"
    . "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
    . "<title>{$title}</title><meta name=\"description\" content=\"{$desc}\"></head>"
    . "<body><article><h1>{$title}</h1>{$data['html']}</article></body></html>";
file_put_contents("{$dir}/{$slug}.html", $page);

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
echo json_encode([
    'id' => $slug,
    'url' => "{$scheme}://{$_SERVER['HTTP_HOST']}" . dirname($_SERVER['SCRIPT_NAME']) . "/artikel/{$slug}.html",
]);
