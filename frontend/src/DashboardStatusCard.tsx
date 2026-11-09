import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import InterfaceIcon from './InterfaceIcon';
import './DashboardStatusCard.css';

type Props = {
  id?: string;
  className?: string;
  title: string;
  actionLabel?: string;
  summary: ReactNode;
  children: ReactNode;
};

export default function DashboardStatusCard({ id, className, title, actionLabel = title, summary, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return <div className="status-card-slot">
    <button id={id} type="button" className={`status-card ${className ?? ''}`} aria-haspopup="dialog"
      onClick={event => {
        // Programmatic activation from the footer preserves the footer button's focus.
        if (event.isTrusted) event.currentTarget.focus({ preventScroll: true });
        dialog.current?.showModal();
      }}>
      {summary}
      <span className="status-card-action">{actionLabel}<InterfaceIcon name="right"/></span>
    </button>
    <dialog ref={dialog} className="ic-dialog status-dialog" aria-labelledby={titleId}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) {
          event.currentTarget.close();
        }
      }}>
      <header className="ic-header status-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button className="ic-close" type="button" onClick={() => dialog.current?.close()}
          aria-label={`Close ${title.toLowerCase()}`}>×</button>
      </header>
      {children}
    </dialog>
  </div>;
}
