import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
export function privateAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/, '');
  if (ip === '::1') return true;
  if (isIP(ip) !== 4) return false;
  const p = ip.split('.').map(Number);
  return (
    p[0] === 127 ||
    p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168)
  );
}
export function lanAddresses(): { name: string; address: string }[] {
  return Object.entries(networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter(
          (e) =>
            e.family === 'IPv4' && !e.internal && privateAddress(e.address),
        )
        .map((e) => ({ name, address: e.address })),
    )
    .sort(
      (a, b) =>
        Number(/virtual|vethernet|wsl|vpn|ethernet 2|docker/i.test(a.name)) -
        Number(/virtual|vethernet|wsl|vpn|ethernet 2|docker/i.test(b.name)),
    );
}
export function selectLan(override?: string): string {
  const addresses = lanAddresses();
  if (override) {
    if (
      isIP(override) !== 4 ||
      !privateAddress(override) ||
      (!override.startsWith('127.') &&
        !addresses.some((a) => a.address === override))
    )
      throw new Error(
        'LAN_IP must be a private IPv4 address assigned to this computer. See ipconfig.',
      );
    return override;
  }
  if (!addresses.length)
    throw new Error(
      'No private LAN IPv4 found. Connect to Wi-Fi, or use LAN_IP=127.0.0.1 for computer-only testing.',
    );
  return addresses[0].address;
}
