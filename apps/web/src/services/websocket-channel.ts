import type { TransferChannel } from './transfer';
export class WebSocketChannel extends EventTarget implements TransferChannel {
  binaryType = 'arraybuffer';
  bufferedAmountLowThreshold = 65536;
  onmessage: TransferChannel['onmessage'] = null;
  private timer: ReturnType<typeof setInterval>;
  constructor(private socket: WebSocket) {
    super();
    this.timer = setInterval(() => {
      if (socket.bufferedAmount <= this.bufferedAmountLowThreshold)
        this.dispatchEvent(new Event('bufferedamountlow'));
    }, 25);
  }
  get bufferedAmount() {
    return this.socket.bufferedAmount;
  }
  get readyState() {
    return this.socket.readyState === WebSocket.OPEN ? 'open' : 'closed';
  }
  send(data: string | ArrayBuffer) {
    if (this.readyState !== 'open') throw new Error('Device disconnected.');
    this.socket.send(
      typeof data === 'string'
        ? JSON.stringify({ type: 'data', payload: JSON.parse(data) })
        : data,
    );
  }
  receive(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  dispose() {
    clearInterval(this.timer);
    this.dispatchEvent(new Event('close'));
    this.onmessage = null;
  }
}
