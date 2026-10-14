import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
const url = process.env.LIVE_CLOUD_URL;
if (!url || !url.startsWith('https://'))
  throw new Error('Set LIVE_CLOUD_URL to the deployed HTTPS frontend.');
const browser = await chromium.launch();
const desktop = await browser.newContext();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const host = await desktop.newPage(),
  phone = await mobile.newPage();
const errors = [];
host.on('pageerror', (e) => errors.push(e.message));
phone.on('pageerror', (e) => errors.push(e.message));
try {
  await host.goto(url);
  await host.getByTestId('pairing-qr').waitFor({ timeout: 30000 });
  const p = PNG.sync.read(await host.getByTestId('pairing-qr').screenshot());
  const pair = jsQR(new Uint8ClampedArray(p.data), p.width, p.height).data;
  assert.ok(pair.startsWith(`${url}join/`));
  await phone.goto(pair);
  await host.getByLabel('Text or a link').waitFor({ timeout: 30000 });
  await phone.getByLabel('Text or a link').waitFor({ timeout: 30000 });
  await host
    .getByLabel('Text or a link')
    .fill('Live Pages → phone 🌍\nhttps://example.com');
  await host.getByRole('button', { name: 'Send text' }).click();
  await phone
    .getByText('Live Pages → phone 🌍', { exact: false })
    .waitFor({ timeout: 15000 });
  await phone.getByLabel('Text or a link').fill('Live phone → Pages 你好');
  await phone.getByRole('button', { name: 'Send text' }).click();
  await host
    .getByText('Live phone → Pages 你好', { exact: false })
    .waitFor({ timeout: 15000 });
  const image = new PNG({ width: 1, height: 1 });
  image.data = Buffer.from([36, 110, 225, 255]);
  const png = Buffer.concat([PNG.sync.write(image), Buffer.alloc(70000)]);
  await host
    .getByLabel('Choose image file')
    .setInputFiles({
      name: 'live-check.png',
      mimeType: 'image/png',
      buffer: png,
    });
  await phone
    .getByRole('img', { name: 'live-check.png' })
    .waitFor({ timeout: 15000 });
  const downloadEvent = phone.waitForEvent('download');
  await phone.getByRole('link', { name: 'Download' }).click();
  const download = await downloadEvent;
  assert.deepEqual(await readFile(await download.path()), png);
  await phone
    .getByLabel('Choose image file')
    .setInputFiles({
      name: 'live-phone.png',
      mimeType: 'image/png',
      buffer: png,
    });
  await host
    .getByRole('img', { name: 'live-phone.png' })
    .waitFor({ timeout: 15000 });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  await host
    .getByRole('dialog')
    .getByRole('button', { name: 'End session' })
    .click();
  await phone
    .getByRole('heading', { name: 'Session Ended' })
    .waitFor({ timeout: 15000 });
  const replay = await mobile.newPage();
  await replay.goto(pair);
  await replay.getByRole('alert').waitFor({ timeout: 15000 });
  assert.equal(await replay.getByLabel('Text or a link').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: live Pages QR, WebSocket signaling, WebRTC text/images both directions, original download, mobile layout, termination, old-QR rejection.',
  );
} finally {
  await desktop.close();
  await mobile.close();
  await browser.close();
}
