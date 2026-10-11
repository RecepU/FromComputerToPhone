import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowRight,
  MonitorSmartphone,
  Moon,
  Sun,
  QrCode,
  ShieldCheck,
  Upload,
  Send,
  X,
  RefreshCw,
  Smartphone,
  Monitor,
  Link2,
  Image,
  Check,
  Wifi,
} from 'lucide-react';
import { Session, type SessionView } from '../services/session';
import type { Item, Progress } from '../services/transfer';
import { TransferCard } from '../components/TransferCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MAX_FILE_SIZE } from '../../../../packages/shared/protocol';
const initial: SessionView = {
  status: 'Starting',
  role: 'host',
  pairUrl: '',
  pairExpires: 0,
  expires: 0,
  error: '',
  ended: false,
};
export function App() {
  const [view, setView] = useState(initial),
    [items, setItems] = useState<Item[]>([]),
    [progress, setProgress] = useState<Progress[]>([]),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [qr, setQr] = useState(''),
    [showQr, setShowQr] = useState(false),
    [confirm, setConfirm] = useState(false),
    [dark, setDark] = useState(
      () => matchMedia('(prefers-color-scheme: dark)').matches,
    ),
    [sending, setSending] = useState(false),
    [drag, setDrag] = useState(false),
    [now, setNow] = useState(Date.now());
  const session = useRef<Session | null>(null),
    feed = useRef<Item[]>([]),
    picker = useRef<HTMLInputElement>(null);
  function clear() {
    for (const item of feed.current)
      if (item.url) URL.revokeObjectURL(item.url);
    feed.current = [];
    setItems([]);
    setText('');
    setProgress([]);
  }
  useEffect(() => {
    const current = new Session({
      view: setView,
      error: setError,
      progress: (p, id) =>
        setProgress((values) =>
          p
            ? [...values.filter((v) => v.id !== p.id), p]
            : id
              ? values.filter((v) => v.id !== id)
              : [],
        ),
      clear,
      item: (item) => {
        const next = [item, ...feed.current];
        let bytes = next.reduce((n, i) => n + (i.size ?? 0), 0);
        while (next.length > 40 || bytes > 60 * 1024 * 1024) {
          const removed = next.pop()!;
          bytes -= removed.size ?? 0;
          if (removed.url) URL.revokeObjectURL(removed.url);
        }
        feed.current = next;
        setItems(next);
      },
    });
    session.current = current;
    void current.start();
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        void current.end();
        current.dispose();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      current.dispose();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    let active = true;
    setQr('');
    if (view.pairUrl && !view.ended)
      void QRCode.toDataURL(view.pairUrl, {
        width: 288,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#142b45', light: '#ffffff' },
      })
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() =>
          setError('QR generation failed. Refresh the pairing code.'),
        );
    return () => {
      active = false;
    };
  }, [view.pairUrl, view.ended]);
  useEffect(() => {
    if (view.status === 'Connected') setShowQr(false);
  }, [view.status]);
  const connected = view.status === 'Connected',
    pairing = view.role === 'host' && !view.ended && (!connected || showQr),
    expired = now >= view.pairExpires;
  async function send() {
    const transfer = session.current?.transfer;
    if (!transfer) return;
    setSending(true);
    setError('');
    try {
      await transfer.sendText(text);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Text transfer failed.');
    } finally {
      setSending(false);
    }
  }
  async function sendImage(file: File | undefined) {
    if (!file) return;
    const transfer = session.current?.transfer;
    if (!transfer) {
      setError('Connect your devices before sending an image.');
      return;
    }
    setError('');
    try {
      await transfer.sendFile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image transfer failed.');
    }
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="FromComputerToPhone home">
          <span className="brand-icon">
            <MonitorSmartphone size={23} />
          </span>
          <span>
            FromComputer<span className="brand-light">ToPhone</span>
          </span>
        </a>
        <div className="header-actions">
          {connected && (
            <span className="connection-pill">
              <span className="status-dot" /> Connected
            </span>
          )}
          {view.role === 'host' && connected && (
            <button
              className="icon-button"
              title="Show pairing QR"
              aria-label="Show pairing QR"
              onClick={() => setShowQr((v) => !v)}
            >
              <QrCode size={20} />
            </button>
          )}
          <button
            className="icon-button"
            title="Toggle theme"
            aria-label="Toggle theme"
            onClick={() => setDark((v) => !v)}
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          {!view.ended && view.status !== 'Starting' && (
            <button className="end-button" onClick={() => setConfirm(true)}>
              {view.role === 'host' ? 'End session' : 'Leave session'}
            </button>
          )}
        </div>
      </header>
      <main>
        {view.ended ? (
          <section className="ended panel">
            <span className="hero-icon">
              <Check />
            </span>
            <h1>Session Ended</h1>
            <p>
              This sharing session has ended. All temporary content has been
              cleared.
            </p>
            {view.error && <p>{view.error}</p>}
            <button className="primary" onClick={() => location.assign('/')}>
              Start New Session <ArrowRight size={18} />
            </button>
          </section>
        ) : (
          <>
            {pairing ? (
              <section className="pairing-layout">
                <div className="intro">
                  <div className="eyebrow">
                    <span /> A little less friction. A lot more flow.
                  </div>
                  <h1>
                    From your screen.
                    <br />
                    <span>To your pocket.</span>
                  </h1>
                  <p className="intro-copy">
                    Share instantly between your devices. Text, links, and
                    images — right where you need them.
                  </p>
                  <div className="steps">
                    <div>
                      <span>01</span>
                      <p>Open on your computer</p>
                    </div>
                    <div>
                      <span>02</span>
                      <p>Scan with your phone</p>
                    </div>
                    <div>
                      <span>03</span>
                      <p>Share in either direction</p>
                    </div>
                  </div>
                  <div className="supported">
                    <Monitor size={18} />
                    <span>Computer</span>
                    <ArrowRight size={16} />
                    <Smartphone size={18} />
                    <span>Phone</span>
                  </div>
                </div>
                <div className="qr-panel panel">
                  <div className="qr-heading">
                    <QrCode size={20} />
                    <span>Your devices, connected.</span>
                  </div>
                  <div className="qr-frame">
                    {qr && !expired ? (
                      <img
                        src={qr}
                        alt="Scan this QR code with your phone to connect"
                        data-testid="pairing-qr"
                      />
                    ) : (
                      <div className="qr-loading">
                        {expired && view.pairUrl
                          ? 'Pairing QR expired'
                          : view.error
                            ? 'Could not create QR'
                            : 'Creating your secure session…'}
                      </div>
                    )}
                  </div>
                  <h2>Scan with your phone to connect</h2>
                  <p>Use your phone’s camera. No app needed.</p>
                  <div className="waiting" role="status">
                    <span className="status-dot" />
                    {view.status}
                  </div>
                  {view.pairUrl && (
                    <>
                      <p className="qr-expiry">
                        QR valid for{' '}
                        {Math.max(
                          0,
                          Math.min(
                            10,
                            Math.ceil((view.pairExpires - now) / 60000),
                          ),
                        )}{' '}
                        minutes
                      </p>
                      <button
                        className="text-button"
                        onClick={() => session.current?.rotate()}
                        disabled={connected}
                      >
                        <RefreshCw size={15} /> Refresh QR
                      </button>
                    </>
                  )}
                  <div className="qr-footnote">
                    <ShieldCheck size={15} /> Only you and your paired device.
                  </div>
                </div>
              </section>
            ) : !connected ? (
              <section className="connecting panel">
                <MonitorSmartphone size={40} />
                <h1>{view.status}</h1>
                <p>Keep both browsers open while your devices connect.</p>
              </section>
            ) : null}
            {(connected || items.length > 0) && (
              <section className="workspace">
                <div className="workspace-title">
                  <div className="eyebrow">YOUR TEMPORARY WORKSPACE</div>
                  <h1>Send it. Have it.</h1>
                  <p>
                    <Monitor size={16} /> Computer <span>↔</span>{' '}
                    <Smartphone size={16} /> Phone
                    <span className="device-status">
                      <span className="status-dot" />
                      {view.status}
                    </span>
                  </p>
                </div>
                <div className="workspace-grid">
                  <section
                    className={`composer panel ${drag ? 'dragging' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      void sendImage(e.dataTransfer.files[0]);
                    }}
                  >
                    <h2>Share something</h2>
                    <label htmlFor="share-text">Text or a link</label>
                    <textarea
                      id="share-text"
                      placeholder="Paste a link, a note, or anything on your mind…"
                      value={text}
                      disabled={!connected}
                      onChange={(e) => setText(e.target.value)}
                      onPaste={(e) => {
                        const image = Array.from(e.clipboardData.items).find(
                          (i) => i.type.startsWith('image/'),
                        );
                        if (image) {
                          e.preventDefault();
                          void sendImage(image.getAsFile() ?? undefined);
                        }
                      }}
                    />
                    <div className="composer-actions">
                      <span>
                        <Link2 size={16} /> Links welcome
                      </span>
                      <button
                        className="primary"
                        disabled={!connected || sending || !text.trim()}
                        onClick={() => void send()}
                      >
                        <Send size={16} />
                        {sending ? 'Sending…' : 'Send text'}
                      </button>
                    </div>
                    <div className="upload-area">
                      <Image size={28} />
                      <p>Drop an image here, or paste a screenshot</p>
                      <button
                        className="secondary"
                        disabled={!connected || progress.length > 0}
                        onClick={() => picker.current?.click()}
                      >
                        <Upload size={17} /> Choose image
                      </button>
                      <small>
                        PNG, JPEG, WebP, GIF · up to{' '}
                        {MAX_FILE_SIZE / 1024 / 1024} MB
                      </small>
                      <input
                        ref={picker}
                        aria-label="Choose image file"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        hidden
                        onChange={(e) => {
                          void sendImage(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </div>
                    {progress.map((progress) => (
                      <div key={progress.id} className="progress" role="status">
                        <div>
                          <span>
                            {progress.direction === 'sent'
                              ? 'Sending'
                              : 'Receiving'}{' '}
                            {progress.name}
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Cancel image transfer"
                            onClick={() =>
                              session.current?.transfer?.cancel(progress.id)
                            }
                          >
                            <X size={17} />
                          </button>
                        </div>
                        <progress value={progress.percent} max={100} />
                        <small>
                          {progress.percent}% · waiting for confirmation at 100%
                        </small>
                      </div>
                    ))}
                  </section>
                  <section className="feed">
                    <div className="feed-heading">
                      <h2>Transfers</h2>
                      <span>{items.length} this session</span>
                    </div>
                    {items.length ? (
                      items.map((item) => (
                        <TransferCard
                          key={item.id}
                          item={item}
                          onError={setError}
                        />
                      ))
                    ) : (
                      <div className="empty-feed">
                        <span className="hero-icon">
                          <Wifi size={28} />
                        </span>
                        <h3>You’re connected!</h3>
                        <p>Send something from either device to get started.</p>
                        <small>Your transfers will appear here.</small>
                      </div>
                    )}
                  </section>
                </div>
              </section>
            )}
            {(error || view.error) && (
              <div className="error-banner" role="alert">
                <span>{error || view.error}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => {
                    setError('');
                    session.current?.clearError();
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {['Connection failed', 'Disconnected'].includes(view.status) && (
              <div className="retry-row">
                <button
                  className="secondary"
                  onClick={() => {
                    setError('');
                    session.current?.retry();
                  }}
                >
                  <RefreshCw size={16} /> Retry Connection
                </button>
                <button
                  className="text-button"
                  onClick={() => location.assign('/')}
                >
                  Start New Session
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <footer>
        <span>
          <ShieldCheck size={16} /> No account required
        </span>
        <span>No permanent storage</span>
        <span>Secure temporary sharing</span>
        <small>Close the session. Leave nothing behind.</small>
      </footer>
      {confirm && (
        <ConfirmDialog
          guest={view.role === 'guest'}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void session.current?.end();
          }}
        />
      )}
      <div className="sr-only" role="status">
        {view.status}
      </div>
    </div>
  );
}
