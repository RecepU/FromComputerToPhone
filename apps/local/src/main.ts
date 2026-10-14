import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createLocalServer } from './server';
import { lanAddresses, selectLan } from './network';
function numeric(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`${name} must be between ${min} and ${max}.`);
  return Math.floor(n);
}
try {
  const port = numeric('PORT', 3000, 1024, 65535),
    lanIp = selectLan(process.env.LAN_IP),
    dist = resolve('apps/web/dist-local');
  if (!existsSync(resolve(dist, 'index.html')))
    throw new Error(
      'Local frontend is missing. Run npm run build:local first.',
    );
  const app = createLocalServer({
    port,
    lanIp,
    dist,
    ttlMs: numeric('SESSION_TTL_SECONDS', 86400, 1, 86400) * 1000,
    graceMs: numeric('HOST_GRACE_SECONDS', 15, 1, 300) * 1000,
    maxFileSize: numeric('MAX_IMAGE_BYTES', 10485760, 1, 10485760),
  });
  app.server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(
      e.code === 'EADDRINUSE'
        ? `Port ${port} is occupied. Stop the other server or set PORT to another number.`
        : `Server error: ${e.message}`,
    );
    process.exitCode = 1;
    void app.close();
  });
  app.server.listen(port, '0.0.0.0', () => {
    console.log(
      `\nFromComputerToPhone LOCAL POC\nDesktop: http://localhost:${port}\nPhone / QR: http://${lanIp}:${port}\nSame trusted Wi-Fi only; HTTP/WS is unencrypted. No public port forwarding.\nPress Ctrl+C to stop.\n`,
    );
    for (const a of lanAddresses())
      console.log(`  Adapter: ${a.name} — ${a.address}`);
    console.log('Use LAN_IP to override the QR address if needed.');
    if (process.argv.includes('--open')) {
      const url = `http://localhost:${port}`;
      const child =
        process.platform === 'win32'
          ? spawn('cmd.exe', ['/c', 'start', '', url], {
              windowsHide: true,
              stdio: 'ignore',
            })
          : null;
      child?.on('error', () =>
        console.log('Open the desktop URL in your browser.'),
      );
    }
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
