import { test, expect } from '@playwright/test';
import { lanAddresses } from '../../apps/local/src/network';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
test('real HTTP LAN works without WebRTC, subtle or clipboard', async ({
  browser,
}) => {
  const address = lanAddresses()[0]?.address;
  test.skip(!address, 'No private LAN adapter');
  const computer = await browser.newContext(),
    mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  const host = await computer.newPage(),
    phone = await mobile.newPage();
  const errors: string[] = [];
  phone.on('pageerror', (e) => errors.push(e.message));
  await host.goto('http://localhost:3001');
  await expect(host.getByTestId('pairing-qr')).toBeVisible();
  const p = PNG.sync.read(await host.getByTestId('pairing-qr').screenshot());
  const url = jsQR(new Uint8ClampedArray(p.data), p.width, p.height)!.data;
  expect(url.startsWith(`http://${address}:3001/join/`)).toBe(true);
  await phone.addInitScript(() => {
    Object.defineProperty(window, 'RTCPeerConnection', { value: undefined });
  });
  await phone.goto(url);
  expect(
    await phone.evaluate(() => ({
      secure: isSecureContext,
      subtle: !!crypto.subtle,
      clipboard: !!navigator.clipboard,
    })),
  ).toEqual({ secure: false, subtle: false, clipboard: false });
  await expect(phone.getByLabel('Text or a link')).toBeEnabled();
  await phone.getByLabel('Text or a link').fill('HTTP phone → computer 🌍');
  await phone.getByRole('button', { name: 'Send text' }).click();
  await expect(host.locator('.shared-text')).toContainText('HTTP phone');
  await host.getByLabel('Text or a link').fill('Copy over HTTP');
  await host.getByRole('button', { name: 'Send text' }).click();
  await phone.getByRole('button', { name: 'Copy text' }).first().click();
  await expect(phone.getByLabel('Select text to copy manually')).toHaveValue(
    'Copy over HTTP',
  );
  const img = new PNG({ width: 1, height: 1 });
  img.data = Buffer.from([1, 2, 3, 255]);
  await phone.getByLabel('Choose image file').setInputFiles({
    name: 'lan.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([
      PNG.sync.write(img),
      Buffer.alloc(10 * 1024 * 1024 - PNG.sync.write(img).length),
    ]),
  });
  await expect(host.getByRole('img', { name: 'lan.png' })).toBeVisible();
  await expect(phone.locator('.progress')).toHaveCount(0);
  await phone
    .getByLabel('Choose image file')
    .setInputFiles({
      name: 'too-large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
  await expect(phone.getByRole('alert')).toContainText(
    'Choose an image up to 10 MB',
  );
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  await host
    .getByRole('dialog')
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(
    phone.getByRole('heading', { name: 'Session Ended' }),
  ).toBeVisible();
  await computer.close();
  await mobile.close();
});
