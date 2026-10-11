import { describe, it, expect, vi } from 'vitest';
import {
  Transfer,
  type Item,
  type Progress,
} from '../../apps/web/src/services/transfer';
class Channel extends EventTarget {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType = 'arraybuffer';
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: Channel | null = null;
  send(data: unknown) {
    queueMicrotask(() => this.other?.onmessage?.({ data }));
  }
}
function pair() {
  const a = new Channel(),
    b = new Channel();
  a.other = b;
  b.other = a;
  const left: Item[] = [],
    right: Item[] = [];
  const err = vi.fn();
  const leftProgress = new Map<string, Progress>(),
    rightProgress = new Map<string, Progress>(),
    progressSizes: number[] = [];
  const track =
    (values: Map<string, Progress>) => (p: Progress | null, id?: string) => {
      if (p) values.set(p.id, p);
      else if (id) values.delete(id);
      progressSizes.push(values.size);
    };
  return {
    a,
    b,
    left,
    right,
    err,
    leftProgress,
    rightProgress,
    progressSizes,
    sender: new Transfer(
      a as unknown as RTCDataChannel,
      (i) => left.push(i),
      track(leftProgress),
      err,
    ),
    receiver: new Transfer(
      b as unknown as RTCDataChannel,
      (i) => right.push(i),
      track(rightProgress),
      err,
    ),
  };
}
describe('data channel transfers', () => {
  function image() {
    const bytes = new Uint8Array(70000);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    return new File([bytes], 'image.png', { type: 'image/png' });
  }
  function cleanup(p: ReturnType<typeof pair>) {
    for (const i of [...p.left, ...p.right])
      if (i.url) URL.revokeObjectURL(i.url);
    p.sender.dispose();
    p.receiver.dispose();
  }
  it('tracks simultaneous bidirectional images independently', async () => {
    const p = pair();
    p.a.bufferedAmount = 500000;
    p.b.bufferedAmount = 500000;
    const promise = Promise.all([
      p.sender.sendFile(image()),
      p.receiver.sendFile(image()),
    ]);
    await vi.waitFor(() => {
      expect(p.leftProgress.size).toBe(2);
      expect(p.rightProgress.size).toBe(2);
    });
    p.a.bufferedAmount = 0;
    p.b.bufferedAmount = 0;
    p.a.dispatchEvent(new Event('bufferedamountlow'));
    p.b.dispatchEvent(new Event('bufferedamountlow'));
    await promise;
    expect(p.left).toHaveLength(2);
    expect(p.right).toHaveLength(2);
    expect(p.progressSizes).toContain(2);
    expect(p.leftProgress.size).toBe(0);
    expect(p.rightProgress.size).toBe(0);
    expect(p.err).not.toHaveBeenCalled();
    cleanup(p);
  });
  it('rejects a tampered hash without accepting the image', async () => {
    const p = pair(),
      send = p.a.send.bind(p.a);
    vi.spyOn(p.a, 'send').mockImplementation((raw) => {
      if (typeof raw === 'string') {
        const message = JSON.parse(raw);
        if (message.type === 'file') {
          send(JSON.stringify({ ...message, sha256: '0'.repeat(64) }));
          return;
        }
      }
      send(raw);
    });
    await expect(p.sender.sendFile(image())).rejects.toThrow('cancelled');
    expect(p.right).toHaveLength(0);
    expect(p.leftProgress.size).toBe(0);
    expect(p.rightProgress.size).toBe(0);
    cleanup(p);
  });
  it('pauses under backpressure and resumes on low-buffer notification', async () => {
    const p = pair();
    p.a.bufferedAmount = 500000;
    const send = vi.spyOn(p.a, 'send');
    const promise = p.sender.sendFile(image());
    await vi.waitFor(() => expect(p.rightProgress.size).toBe(1));
    expect(send.mock.calls.some(([data]) => data instanceof ArrayBuffer)).toBe(
      false,
    );
    p.a.bufferedAmount = 0;
    p.a.dispatchEvent(new Event('bufferedamountlow'));
    await promise;
    expect(p.right).toHaveLength(1);
    cleanup(p);
  });
  it('cancels a stalled transfer and clears buffers, pending listeners and progress', async () => {
    const p = pair();
    p.a.bufferedAmount = 500000;
    const promise = p.sender.sendFile(image());
    const rejected = expect(promise).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(p.rightProgress.size).toBe(1));
    p.receiver.cancel([...p.rightProgress.keys()][0]);
    await rejected;
    expect(p.leftProgress.size).toBe(0);
    expect(p.rightProgress.size).toBe(0);
    expect(p.right).toHaveLength(0);
    cleanup(p);
  });
  it('disposal immediately rejects pending receipt confirmations', async () => {
    const p = pair();
    p.a.other = null;
    const promise = p.sender.sendText('pending');
    const rejected = expect(promise).rejects.toThrow('disconnected');
    p.sender.dispose();
    await rejected;
    expect(p.left).toHaveLength(0);
    cleanup(p);
  });
  it('preserves Unicode, line breaks and both directions', async () => {
    const p = pair();
    await p.sender.sendText('Merhaba 🌍\nhttps://example.com');
    await p.receiver.sendText('你好');
    expect(p.right[0].text).toBe('Merhaba 🌍\nhttps://example.com');
    expect(p.left[1].text).toBe('你好');
    p.sender.dispose();
    p.receiver.dispose();
  });
  it('reconstructs a multi-chunk image and waits for integrity confirmation', async () => {
    const p = pair();
    const bytes = new Uint8Array(70000);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const file = new File([bytes], 'image.png', { type: 'image/png' });
    await p.sender.sendFile(file);
    expect(p.right[0].size).toBe(bytes.length);
    expect(p.left[0].direction).toBe('sent');
    const received = await (await fetch(p.right[0].url!)).arrayBuffer();
    expect(new Uint8Array(received)).toEqual(bytes);
    expect(p.err).not.toHaveBeenCalled();
    URL.revokeObjectURL(p.left[0].url!);
    URL.revokeObjectURL(p.right[0].url!);
    p.sender.dispose();
    p.receiver.dispose();
  });
  it('rejects spoofed image content and oversized files before sending', async () => {
    const p = pair();
    await expect(
      p.sender.sendFile(
        new File(['<html>'], 'evil.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('valid PNG');
    await expect(
      p.sender.sendFile(
        new File([new Uint8Array(10485761)], 'big.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('10 MB');
    expect(p.right).toHaveLength(0);
    p.sender.dispose();
    p.receiver.dispose();
  });
  it('rejects out-of-order chunks and clears partial state', async () => {
    const p = pair();
    const id = crypto.randomUUID();
    p.a.send(
      JSON.stringify({
        type: 'file',
        id,
        name: 'image.png',
        mime: 'image/png',
        size: 100,
        sha256: 'a'.repeat(64),
      }),
    );
    const frame = new Uint8Array(41);
    frame.set(new TextEncoder().encode(id));
    new DataView(frame.buffer).setUint32(36, 2);
    p.a.send(frame.buffer);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(p.err).toHaveBeenCalled();
    expect(p.right).toHaveLength(0);
    p.sender.dispose();
    p.receiver.dispose();
  });
  it('deduplicates retried text messages', async () => {
    const p = pair();
    const message = JSON.stringify({
      type: 'text',
      id: crypto.randomUUID(),
      text: 'once',
      timestamp: 1,
    });
    p.a.send(message);
    p.a.send(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(p.right).toHaveLength(1);
    p.sender.dispose();
    p.receiver.dispose();
  });
});
