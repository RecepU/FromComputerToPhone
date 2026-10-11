import { useEffect, useRef } from 'react';
export function ConfirmDialog({
  onCancel,
  onConfirm,
  guest,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  guest: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2>{guest ? 'Leave this session?' : 'End this session?'}</h2>
      <p>
        {guest
          ? 'Your temporary content will be cleared from this device.'
          : 'Both devices will disconnect and all temporary content will be cleared.'}
      </p>
      <div className="dialog-actions">
        <button className="secondary" autoFocus onClick={onCancel}>
          Keep sharing
        </button>
        <button className="danger" onClick={onConfirm}>
          {guest ? 'Leave session' : 'End session'}
        </button>
      </div>
    </dialog>
  );
}
