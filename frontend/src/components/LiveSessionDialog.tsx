import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LiveProvider } from '../services/liveProvider';
import { showToast } from './Toast';

type Role = 'host' | 'join';
type Step = 'name' | 'code' | 'connecting';

interface LiveSessionDialogProps {
  role: Role;
  /** Creates the provider (and, for the host, puts the script into the shared document). */
  begin: (role: Role, name: string) => LiveProvider;
  /** Called once the connection is up and the script has arrived. */
  onConnected: (role: Role) => void;
  /** Closes the dialog and abandons any half-finished handshake. */
  onCancel: () => void;
}

const NAME_KEY = 'writea-live-name';

/** Failed connection attempts since the app started; a success resets it. */
let failedAttempts = 0;
let relayArmed = false;
const MAX_ATTEMPTS = 3;

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode or blocked storage: the name just is not remembered */
  }
}

function plainMessage(err: unknown): string {
  if (typeof err === 'string' && err) return err;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

const codeBoxStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 12,
  padding: '8px 10px',
  minHeight: 76,
  resize: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: 14, color: 'var(--fd-text-muted)' };

const LiveSessionDialog: React.FC<LiveSessionDialogProps> = ({ role, begin, onConnected, onCancel }) => {
  const isHost = role === 'host';
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(loadName);
  // Host: the partner's code (step 2). Guest: the host's code (step 1).
  const [theirCode, setTheirCode] = useState('');
  const [myCode, setMyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // True when this attempt goes through the relay (host: chosen after a direct failure; guest: read off the host's code).
  const [relay, setRelay] = useState(relayArmed);
  const providerRef = useRef<LiveProvider | null>(null);
  const cancelledRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const myCodeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Development builds run this setup, then the cleanup below, then the setup
    // again. Without resetting the flag here, that first cleanup would leave the
    // dialog believing it had been closed, and it would ignore every answer.
    cancelledRef.current = false;
    nameRef.current?.focus();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleFirstStep = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter the name your partner will see on your cursor.');
      return;
    }
    if (!isHost && !theirCode.trim()) {
      setError("Paste your partner's code first.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      saveName(trimmed);
      const provider = begin(role, trimmed);
      providerRef.current = provider;
      if (!isHost) setRelay(theirCode.replace(/\s+/g, '').startsWith('wt1r/'));
      const code = isHost
        ? await invoke<string>('live_host_prepare', { relay })
        : await invoke<string>('live_join_prepare', { hostCode: theirCode.trim() });
      if (cancelledRef.current) return;
      setMyCode(code);
      setTheirCode('');
      setStep('code');
    } catch (err) {
      if (!cancelledRef.current) setError(plainMessage(err));
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  };

  const handleConnect = async () => {
    const provider = providerRef.current;
    if (!provider) return;
    if (isHost && !theirCode.trim()) {
      setError("Paste your partner's code first.");
      return;
    }
    setBusy(true);
    setError('');
    setStep('connecting');
    try {
      await provider.connect(() =>
        isHost
          ? invoke<void>('live_host_accept', { guestCode: theirCode.trim() })
          : invoke<void>('live_join_connect'),
      );
      await provider.whenSynced();
      if (cancelledRef.current) return;
      failedAttempts = 0; relayArmed = false;
      onConnected(role);
    } catch (err) {
      if (cancelledRef.current) return;
      // A failed attempt cannot be resumed: the codes are single use.
      void provider.close();
      providerRef.current = null;
      setMyCode('');
      setTheirCode('');
      setStep('name');
      failedAttempts += 1;
      if (isHost && !relay) { relayArmed = true; setRelay(true); }
      if (failedAttempts >= MAX_ATTEMPTS) {
        setError('Still unable to connect, please try again at another time.');
      } else if (relay) {
        setError(`${plainMessage(err)} Start again to get fresh codes.`);
      } else if (isHost) {
        setError(`${plainMessage(err)} Start again and the codes will go through a relay instead.`);
      } else {
        setError(`${plainMessage(err)} Ask the host to start again; they will send you a relay code.`);
      }
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(myCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      myCodeRef.current?.focus();
      myCodeRef.current?.select();
      showToast('Press Ctrl+C to copy the code', 'info');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  const title = isHost ? 'Start a Live Session' : 'Join a Live Session';

  return (
    <div className="dialog-overlay">
      <div className="dialog-box" style={{ maxWidth: 520 }} onKeyDown={handleKeyDown}>
        <div className="dialog-header">{title}</div>

        <div className="dialog-body">
          {step === 'name' && (
            <>
              <p style={hintStyle}>
                {isHost
                  ? 'Your script goes straight to your partner’s computer. No server, no account. You will swap two codes to connect.'
                  : 'You will swap two codes with the host to connect. Your editor will show their script until the session ends.'}
              </p>
              <div className="settings-field">
                <label>Your name (shown on your cursor)</label>
                <input
                  ref={nameRef}
                  className="dialog-input"
                  style={{ fontSize: 14, height: 40, padding: '0 12px' }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </div>
              {!isHost && (
                <div className="settings-field" style={{ marginTop: 12 }}>
                  <label>Your partner{'’'}s code</label>
                  <textarea
                    className="dialog-input"
                    style={codeBoxStyle}
                    value={theirCode}
                    onChange={(e) => setTheirCode(e.target.value)}
                    placeholder="Paste the code they sent you"
                    disabled={busy}
                  />
                </div>
              )}
            </>
          )}

          {step === 'code' && (
            <>
              <p style={hintStyle}>
                {isHost
                  ? '1. Send this code to your partner (message, email, anything).'
                  : '1. Send this code back to the host (message, email, anything).'}
              </p>
              <textarea
                ref={myCodeRef}
                className="dialog-input"
                style={codeBoxStyle}
                value={myCode}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <div style={{ margin: '6px 0 14px' }}>
                <button className="dialog-btn" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy Code'}
                </button>
              </div>
              {isHost ? (
                <>
                  <p style={hintStyle}>
                    2. They open Tools {'▸'} Live Co-editing {'▸'} Join a Live Session, paste your code, and send you
                    theirs. Paste their code here, then press Connect.
                  </p>
                  <textarea
                    className="dialog-input"
                    style={codeBoxStyle}
                    value={theirCode}
                    onChange={(e) => setTheirCode(e.target.value)}
                    placeholder="Paste your partner's code"
                    disabled={busy}
                  />
                </>
              ) : (
                <p style={hintStyle}>
                  2. Once the host says they have pasted your code, press Connect.
                </p>
              )}
            </>
          )}

          {step === 'connecting' && (
            <p style={hintStyle}>
              {isHost
                ? 'Waiting for your partner to press Connect…'
                : 'Connecting…'}
              <br />
              This can take a few seconds.
            </p>
          )}

          {relay && step !== 'connecting' && (
            <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--fd-text-muted)' }}>
              Using a relay: while your IP address is shared with it, your document is not. The work itself is
              end-to-end encrypted.
            </p>
          )}

          {error && (
            <p style={{ margin: '12px 0 0', fontSize: 14, color: '#dc2626' }} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          {step === 'name' && (
            <button
              className="dialog-btn dialog-btn-primary"
              style={{ background: 'var(--fd-accent)', color: '#fff', border: 'none', fontWeight: 600 }}
              onClick={handleFirstStep}
              disabled={busy || !name.trim() || (!isHost && !theirCode.trim())}
            >
              {busy ? 'Working…' : isHost ? 'Create My Code' : 'Continue'}
            </button>
          )}
          {step === 'code' && (
            <button
              className="dialog-btn dialog-btn-primary"
              style={{ background: 'var(--fd-accent)', color: '#fff', border: 'none', fontWeight: 600 }}
              onClick={handleConnect}
              disabled={busy || (isHost && !theirCode.trim())}
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveSessionDialog;
