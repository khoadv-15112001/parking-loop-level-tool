import assert from 'node:assert/strict';
import test from 'node:test';
import { call } from './client.mjs';

test('Vỏ chung nạp mẫu giữa CSS core và CSS game; game chưa chọn dùng giao diện mặc định', async () => {
  const [app, template] = await Promise.all([call(null, 'GET', '/app/'), call(null, 'GET', '/core/ui-template.css')]);
  assert.equal(app.status, 200);
  assert.match(app.bytes.toString('utf8'), /href="css\/app\.css"[^]*href="\/core\/ui-template\.css"[^]*href="game\/game\.css"/);
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-type'), /^text\/css\b/);
  assert.ok(template.headers.get('content-security-policy'));
  assert.equal(template.bytes.length, 0);
});

test('Kho mẫu Sand Jam phục vụ bố cục, popup, thành phần UI và trang xem mẫu trên cả hai server', async () => {
  const base = '/core/ui-templates/sand-jam/';
  const files = [
    ['template.css', /^text\/css\b/, /@import[^\n]+layouts\.css/],
    ['layouts.css', /^text\/css\b/, /\.sj-editor-body/],
    ['components.css', /^text\/css\b/, /\.sj-button/],
    ['overlays.css', /^text\/css\b/, /\.sj-popover/],
    ['layouts.mjs', /javascript/, /export function createSandJamLayout/],
    ['popups.mjs', /javascript/, /openSandJamPopup/],
    ['icons.mjs', /javascript/, /export function sandJamObstacleIcon/],
    ['assets/obstacles.webp', /^image\/webp\b/],
    ['preview/index.html', /^text\/html\b/, /preview\.mjs/],
    ['preview/preview.mjs', /javascript/, /createSandJamLayout/],
  ];
  await Promise.all(files.map(async ([file, mime, content]) => {
    const asset = await call(null, 'GET', base + file);
    assert.equal(asset.status, 200, file);
    assert.match(asset.headers.get('content-type'), mime, file);
    assert.ok(asset.bytes.length > 0, file);
    if (content) assert.match(asset.bytes.toString('utf8'), content, file);
  }));
});
