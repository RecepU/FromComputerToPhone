import { test, expect, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
async function roomUrl(host: Page) {
  await expect(host.getByTestId('pairing-qr')).toBeVisible();
}
// The QR payload is decoded from its pixels, never copied to a DOM attribute or logs.
async function decodeQr(host: Page) {
  const pixels = PNG.sync.read(
    await host.getByTestId('pairing-qr').screenshot(),
  );
  return jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
    ?.data;
}
test('pairing, bidirectional transfers, safe links, downloads and termination', async ({
  browser,
}) => {
  const hostContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const host = await hostContext.newPage(),
    phone = await phoneContext.newPage();
  const errors: string[] = [];
  host.on('pageerror', (e) => errors.push(e.message));
  phone.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await roomUrl(host);
  const url = await decodeQr(host);
  await host.screenshot({ path: '.local-preview/desktop.png', fullPage: true });
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:5173\/join\/[^#]+#[^#]+$/);
  await phone.goto(url!);
  await expect(host.getByTestId('pairing-qr')).not.toBeVisible({
    timeout: 30000,
  });
  await expect(host.getByLabel('Text or a link')).toBeEnabled();
  await expect(phone.getByLabel('Text or a link')).toBeEnabled();
  await host.screenshot({
    path: '.local-preview/workspace.png',
    fullPage: true,
  });
  await phone.screenshot({ path: '.local-preview/mobile.png', fullPage: true });
  await phone.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'dark');
  await phone.screenshot({
    path: '.local-preview/mobile-dark.png',
    fullPage: true,
  });
  await host
    .getByLabel('Text or a link')
    .fill('Merhaba 🌍\nhttps://example.com');
  await host.getByRole('button', { name: 'Send text' }).click();
  await expect(phone.locator('.shared-text')).toContainText('Merhaba 🌍');
  await expect(
    phone.getByRole('link', { name: 'https://example.com' }),
  ).toHaveAttribute('href', 'https://example.com/');
  await phone.getByRole('button', { name: 'Copy text' }).click();
  expect(
    (await phone.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      '\n',
    ),
  ).toBe('Merhaba 🌍\nhttps://example.com');
  await phone.getByLabel('Text or a link').fill('Phone → desktop 你好 😀');
  await phone.getByRole('button', { name: 'Send text' }).click();
  await expect(host.locator('.shared-text').first()).toContainText(
    'Phone → desktop',
  );
  const pixel = new PNG({ width: 1, height: 1 });
  pixel.data = Buffer.from([39, 101, 230, 255]);
  const tinyPng = PNG.sync.write(pixel);
  const png = Buffer.concat([tinyPng, Buffer.alloc(70000)]);
  await host.getByLabel('Choose image file').setInputFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(
    phone.getByRole('img', { name: 'screenshot.png' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      phone
        .getByRole('img', { name: 'screenshot.png' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  const downloadEvent = phone.waitForEvent('download');
  await phone.getByRole('link', { name: 'Download' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('screenshot.png');
  expect(await readFile((await download.path())!)).toEqual(png);
  await expect(host.getByRole('img', { name: 'screenshot.png' })).toBeVisible();
  await host.getByLabel('Text or a link').evaluate((input, bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }),
    );
    input.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData }),
    );
  }, Array.from(tinyPng));
  await expect(phone.getByRole('img', { name: 'pasted.png' })).toBeVisible();
  await expect(host.getByRole('img', { name: 'pasted.png' })).toBeVisible();
  const dataTransfer = await host.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], 'dragged.png', { type: 'image/png' }),
    );
    return data;
  }, Array.from(tinyPng));
  await host.locator('.composer').dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
  await expect(phone.getByRole('img', { name: 'dragged.png' })).toBeVisible();
  await phone
    .getByLabel('Choose image file')
    .setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png });
  await expect(host.getByRole('img', { name: 'phone.png' })).toBeVisible();
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  await host
    .getByRole('dialog')
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(
    phone.getByRole('heading', { name: 'Session Ended' }),
  ).toBeVisible();
  await expect(phone.locator('.transfer-card')).toHaveCount(0);
  const old = await phoneContext.newPage();
  await old.goto(url!);
  await expect(old.getByRole('alert')).toBeVisible({ timeout: 15000 });
  await expect(old.getByLabel('Text or a link')).toHaveCount(0);
  expect(errors).toEqual([]);
  await hostContext.close();
  await phoneContext.close();
});

test('guest departure shows a fresh QR and allows a new phone', async ({
  browser,
}) => {
  const hostContext = await browser.newContext(),
    phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  const host = await hostContext.newPage(),
    phone = await phoneContext.newPage();
  await host.goto('/');
  await roomUrl(host);
  const original = await decodeQr(host);
  await phone.goto(original!);
  await expect(phone.getByLabel('Text or a link')).toBeEnabled({
    timeout: 30000,
  });
  await phone
    .getByRole('button', { name: 'Leave session', exact: true })
    .click();
  await phone
    .getByRole('dialog')
    .getByRole('button', { name: 'Leave session', exact: true })
    .click();
  await expect(
    phone.getByRole('heading', { name: 'Session Ended' }),
  ).toBeVisible();
  await expect(host.getByTestId('pairing-qr')).toBeVisible();
  const fresh = await decodeQr(host);
  expect(fresh).not.toBe(original);
  const old = await phoneContext.newPage();
  await old.goto(original!);
  await expect(old.getByRole('alert')).toContainText('Invalid or expired');
  const replacement = await phoneContext.newPage();
  await replacement.goto(fresh!);
  await expect(replacement.getByLabel('Text or a link')).toBeEnabled({
    timeout: 30000,
  });
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  await host
    .getByRole('dialog')
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(
    replacement.getByRole('heading', { name: 'Session Ended' }),
  ).toBeVisible();
  await hostContext.close();
  await phoneContext.close();
});
