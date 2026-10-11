import {
  CHUNK_SIZE,
  dataSchema,
  digest,
  imageMime,
  MAX_FILE_SIZE,
  MAX_TEXT_BYTES,
  validImageSignature,
  safeImageName,
  type DataMessage,
} from '../../../../packages/shared/protocol';
export interface Item {
  id: string;
  direction: 'sent' | 'received';
  timestamp: number;
  text?: string;
  url?: string;
  name?: string;
  size?: number;
}
export interface Progress {
  id: string;
  direction: 'sent' | 'received';
  name: string;
  percent: number;
}
type FileMeta = Extract<DataMessage, { type: 'file' }>;
interface Incoming {
  meta: FileMeta;
  chunks: Uint8Array[];
  received: number;
  sequence: number;
  timer: ReturnType<typeof setTimeout>;
}
export class Transfer {
  private incoming: Incoming | null = null;
  private outgoing: string | null = null;
  private backpressureFailure: ((error: Error) => void) | null = null;
  private seen = new Set<string>();
  private pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private disposed = false;
  constructor(
    private channel: RTCDataChannel,
    private onItem: (i: Item) => void,
    private onProgress: (p: Progress | null, id?: string) => void,
    private onError: (s: string) => void,
  ) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 65536;
    channel.onmessage = (e) => {
      void this.receive(e.data).catch(() => {
        const id = this.incoming?.meta.id;
        this.failIncoming();
        if (id && this.channel.readyState === 'open') {
          try {
            this.control({ type: 'cancel', id });
          } catch {
            /* Connection teardown already clears buffers. */
          }
        }
        this.onError('Transfer interrupted or invalid. Please try again.');
      });
    };
  }
  private control(message: DataMessage): void {
    if (this.channel.readyState !== 'open')
      throw new Error('Your device is disconnected.');
    const encoded = JSON.stringify(message);
    if (new TextEncoder().encode(encoded).length > 65536)
      throw new Error(
        'This text is too long for a single transfer. Send it in smaller parts.',
      );
    this.channel.send(encoded);
  }
  private confirmation(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Transfer confirmation timed out.'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  async sendText(text: string): Promise<void> {
    if (!text.trim() || new TextEncoder().encode(text).length > MAX_TEXT_BYTES)
      throw new Error('Enter text up to 64 KB.');
    const id = crypto.randomUUID(),
      timestamp = Date.now();
    this.control({ type: 'text', id, text, timestamp });
    const confirmation = this.confirmation(id);
    await confirmation;
    if (!this.disposed) this.onItem({ id, direction: 'sent', timestamp, text });
  }
  async sendFile(file: File): Promise<void> {
    if (this.outgoing)
      throw new Error('Finish or cancel the current image first.');
    if (file.size <= 0 || file.size > MAX_FILE_SIZE)
      throw new Error(
        `Choose an image up to ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      );
    if (!imageMime.safeParse(file.type).success)
      throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
    const id = crypto.randomUUID();
    this.outgoing = id;
    try {
      const bytes = await file.arrayBuffer();
      const meta = dataSchema.parse({
        type: 'file',
        id,
        name: safeImageName(file.name, file.type),
        mime: file.type,
        size: file.size,
        sha256: await digest(bytes),
      }) as FileMeta;
      if (!validImageSignature(new Uint8Array(bytes), file.type))
        throw new Error('Choose a valid PNG, JPEG, WebP or GIF image.');
      this.checkActive(id);
      this.control(meta);
      this.onProgress({ id, direction: 'sent', name: meta.name, percent: 0 });
      for (
        let offset = 0, sequence = 0;
        offset < bytes.byteLength;
        offset += CHUNK_SIZE, sequence++
      ) {
        await this.backpressure(id);
        this.checkActive(id);
        const chunk = new Uint8Array(
          40 + Math.min(CHUNK_SIZE, bytes.byteLength - offset),
        );
        chunk.set(new TextEncoder().encode(id));
        new DataView(chunk.buffer).setUint32(36, sequence);
        chunk.set(new Uint8Array(bytes, offset, chunk.length - 40), 40);
        this.channel.send(chunk.buffer);
        this.onProgress({
          id,
          direction: 'sent',
          name: meta.name,
          percent: Math.round(
            ((offset + chunk.length - 40) / bytes.byteLength) * 100,
          ),
        });
      }
      const confirmation = this.confirmation(id);
      this.control({ type: 'complete', id });
      await confirmation;
      if (!this.disposed)
        this.onItem({
          id,
          direction: 'sent',
          timestamp: Date.now(),
          url: URL.createObjectURL(file),
          name: meta.name,
          size: file.size,
        });
    } catch (error) {
      if (this.channel.readyState === 'open')
        this.control({ type: 'cancel', id });
      throw error;
    } finally {
      if (this.outgoing === id) this.outgoing = null;
      this.onProgress(null, id);
    }
  }
  private checkActive(id: string): void {
    if (
      this.disposed ||
      this.outgoing !== id ||
      this.channel.readyState !== 'open'
    )
      throw new Error('Image transfer cancelled or disconnected.');
  }
  private async backpressure(id: string): Promise<void> {
    if (this.channel.bufferedAmount < 262144) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        this.backpressureFailure = null;
        clearTimeout(timer);
        this.channel.removeEventListener('bufferedamountlow', low);
        this.channel.removeEventListener('close', closed);
        if (error) reject(error);
        else resolve();
      };
      const low = () => finish();
      const closed = () => finish(new Error('Device disconnected.'));
      const timer = setTimeout(
        () => finish(new Error('Transfer stalled.')),
        10000,
      );
      this.backpressureFailure = finish;
      this.channel.addEventListener('bufferedamountlow', low, { once: true });
      this.channel.addEventListener('close', closed, { once: true });
    });
    this.checkActive(id);
  }
  cancel(id: string): void {
    if (this.channel.readyState === 'open')
      this.control({ type: 'cancel', id });
    if (this.outgoing === id) {
      this.outgoing = null;
      this.backpressureFailure?.(new Error('Transfer cancelled.'));
    }
    if (this.incoming?.meta.id === id) this.failIncoming();
    const p = this.pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      p.reject(new Error('Transfer cancelled.'));
      this.pending.delete(id);
    }
    this.onProgress(null, id);
  }
  private failIncoming(): void {
    const id = this.incoming?.meta.id;
    if (this.incoming) clearTimeout(this.incoming.timer);
    this.incoming = null;
    if (id) this.onProgress(null, id);
  }
  private incomingTimer(): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const id = this.incoming?.meta.id;
      if (id) this.cancel(id);
      this.onError('Image transfer timed out.');
    }, 30000);
  }
  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > 256)
      this.seen.delete(this.seen.values().next().value!);
  }
  private async receive(raw: unknown): Promise<void> {
    if (this.disposed) return;
    if (raw instanceof ArrayBuffer) {
      const incoming = this.incoming;
      if (!incoming || raw.byteLength <= 40 || raw.byteLength > CHUNK_SIZE + 40)
        throw new Error('Invalid chunk');
      const chunk = new Uint8Array(raw);
      if (
        new TextDecoder().decode(chunk.slice(0, 36)) !== incoming.meta.id ||
        new DataView(raw).getUint32(36) !== incoming.sequence++
      )
        throw new Error('Invalid sequence');
      const payload = chunk.slice(40);
      incoming.received += payload.length;
      if (incoming.received > incoming.meta.size)
        throw new Error('Size mismatch');
      incoming.chunks.push(payload);
      clearTimeout(incoming.timer);
      incoming.timer = this.incomingTimer();
      this.onProgress({
        id: incoming.meta.id,
        name: incoming.meta.name,
        direction: 'received',
        percent: Math.round((incoming.received / incoming.meta.size) * 100),
      });
      return;
    }
    if (typeof raw !== 'string' || raw.length > MAX_TEXT_BYTES * 6 + 1024)
      throw new Error('Invalid payload');
    const m = dataSchema.parse(JSON.parse(raw));
    if (m.type === 'ack') {
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        p.resolve();
        this.pending.delete(m.id);
      }
      return;
    }
    if (m.type === 'cancel') {
      if (this.outgoing === m.id) {
        this.outgoing = null;
        this.backpressureFailure?.(
          new Error('The other device cancelled the transfer.'),
        );
      }
      if (this.incoming?.meta.id === m.id) this.failIncoming();
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        p.reject(new Error('The other device cancelled the transfer.'));
        this.pending.delete(m.id);
      }
      this.onError('Image transfer cancelled.');
      return;
    }
    if (m.type === 'text') {
      if (!this.seen.has(m.id)) {
        this.remember(m.id);
        this.onItem({
          id: m.id,
          direction: 'received',
          timestamp: Date.now(),
          text: m.text,
        });
      }
      this.control({ type: 'ack', id: m.id });
      return;
    }
    if (m.type === 'file') {
      if (this.incoming || this.seen.has(m.id)) {
        this.control({ type: 'cancel', id: m.id });
        return;
      }
      this.incoming = {
        meta: { ...m, name: safeImageName(m.name, m.mime) },
        chunks: [],
        received: 0,
        sequence: 0,
        timer: this.incomingTimer(),
      };
      this.onProgress({
        id: m.id,
        direction: 'received',
        name: m.name,
        percent: 0,
      });
      return;
    }
    if (m.type === 'complete') {
      const incoming = this.incoming;
      if (
        !incoming ||
        incoming.meta.id !== m.id ||
        incoming.received !== incoming.meta.size
      )
        throw new Error('Incomplete image');
      clearTimeout(incoming.timer);
      const bytes = new Uint8Array(incoming.received);
      let offset = 0;
      for (const chunk of incoming.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (
        (await digest(bytes.buffer)) !== incoming.meta.sha256 ||
        !validImageSignature(bytes, incoming.meta.mime)
      )
        throw new Error('Image integrity check failed');
      if (this.disposed || this.incoming !== incoming) return;
      this.remember(m.id);
      this.onItem({
        id: m.id,
        direction: 'received',
        timestamp: Date.now(),
        name: incoming.meta.name,
        size: incoming.meta.size,
        url: URL.createObjectURL(
          new Blob([bytes], { type: incoming.meta.mime }),
        ),
      });
      this.failIncoming();
      this.control({ type: 'ack', id: m.id });
    }
  }
  dispose(): void {
    this.disposed = true;
    this.backpressureFailure?.(new Error('Device disconnected.'));
    this.failIncoming();
    this.channel.onmessage = null;
    if (this.outgoing) this.onProgress(null, this.outgoing);
    this.outgoing = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Device disconnected.'));
    }
    this.pending.clear();
    this.seen.clear();
  }
}
