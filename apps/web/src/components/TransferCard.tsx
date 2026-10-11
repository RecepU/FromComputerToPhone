import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';
import { safeUrl } from '../../../../packages/shared/protocol';
import type { Item } from '../services/transfer';
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) => {
        const url = safeUrl(part);
        return url ? (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}
export function TransferCard({
  item,
  onError,
}: {
  item: Item;
  onError: (s: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(item.text!);
      setCopied(true);
    } catch {
      onError('Copy is unavailable. Select the text and copy it manually.');
    }
  }
  return (
    <article className="transfer-card">
      <div className="item-meta">
        {item.direction === 'sent' ? (
          <ArrowUpRight size={16} />
        ) : (
          <ArrowDownLeft size={16} />
        )}
        <span>{item.direction === 'sent' ? 'Sent' : 'Received'}</span>
        <time dateTime={new Date(item.timestamp).toISOString()}>
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
      {item.text !== undefined ? (
        <>
          <p className="shared-text">
            <LinkedText text={item.text} />
          </p>
          <button className="small-button" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
            {copied ? 'Copied!' : 'Copy text'}
          </button>
        </>
      ) : (
        <>
          <img
            className="image-preview"
            src={item.url}
            alt={item.name || 'Transferred image'}
            onError={() =>
              onError(
                'This image cannot be previewed. You can still download the original file.',
              )
            }
          />
          <div className="image-caption">
            <span>
              {item.name}
              <small>{((item.size ?? 0) / 1024).toFixed(0)} KB</small>
            </span>
            <a className="small-button" href={item.url} download={item.name}>
              <Download size={16} /> Download
            </a>
          </div>
        </>
      )}
    </article>
  );
}
