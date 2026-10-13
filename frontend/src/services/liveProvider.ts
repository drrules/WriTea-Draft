/**
 * Live co-editing provider: connects a Yjs document to the serverless
 * session managed by the Rust side (src-tauri/src/live).
 *
 * It does the job the old server provider did, over a direct connection:
 *   - keeps two (or more) Y.Docs in step,
 *   - carries "awareness" (names, colours, cursors) for the cursor extension,
 *   - reports who is present and when the session ends.
 *
 * Wire format (opaque to Rust): one type byte, then a payload.
 *   0 SYNC_REQUEST  our state vector; the peer answers with SYNC_REPLY
 *   1 UPDATE        a live document change
 *   2 AWARENESS     a presence/cursor update
 *   3 SYNC_REPLY    everything the peer was missing (marks us "synced")
 */
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const SYNC_REQUEST = 0;
const UPDATE = 1;
const AWARENESS = 2;
const SYNC_REPLY = 3;

export type LiveStatus = 'connecting' | 'connected' | 'synced' | 'disconnected';
export interface LiveUser {
  name: string;
  color: string;
}

/** The thin edge to the outside world. Tests replace it with a fake. */
export interface LiveBridge {
  send(data: Uint8Array): Promise<void>;
  onMessage(cb: (data: Uint8Array) => void): Promise<() => void>;
  onClosed(cb: (reason: string) => void): Promise<() => void>;
  close(): Promise<void>;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const tauriBridge: LiveBridge = {
  send: (data) => invoke<void>('live_send', { data: toBase64(data) }),
  onMessage: (cb) => listen<string>('live-message', (e) => cb(fromBase64(e.payload))),
  onClosed: (cb) => listen<string>('live-closed', (e) => cb(e.payload)),
  close: () => invoke<void>('live_close'),
};

export interface LiveProviderOptions {
  bridge?: LiveBridge;
  onStatus?: (status: LiveStatus) => void;
  onPeers?: (users: LiveUser[]) => void;
  onClosed?: (reason: string) => void;
}

function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

export class LiveProvider {
  readonly document: Y.Doc;
  /** Read by the tiptap cursor extension (`provider.awareness`). */
  readonly awareness: Awareness;

  private readonly bridge: LiveBridge;
  private readonly opts: LiveProviderOptions;
  private unlisten: Array<() => void> = [];
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;
  private connected = false;
  private status: LiveStatus = 'connecting';
  private syncWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(document: Y.Doc, opts: LiveProviderOptions = {}) {
    this.document = document;
    this.opts = opts;
    this.bridge = opts.bridge ?? tauriBridge;
    this.awareness = new Awareness(document);

    document.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.awareness.on('change', this.onAwarenessChange);
  }

  /**
   * Listens first, then runs `establish` (the command that actually makes the
   * connection), then says hello. Listening first matters: the other side
   * starts talking the moment the link is up, and nothing may be missed.
   */
  async connect(establish: () => Promise<void>): Promise<void> {
    this.unlisten.push(await this.bridge.onMessage(this.onMessage));
    this.unlisten.push(await this.bridge.onClosed(this.onClosed));
    try {
      await establish();
    } catch (e) {
      this.removeListeners();
      throw e;
    }
    if (this.destroyed) return;
    this.connected = true;
    this.setStatus('connected');
    this.send(SYNC_REQUEST, Y.encodeStateVector(this.document));
    if (this.awareness.getLocalState() !== null) {
      this.send(AWARENESS, encodeAwarenessUpdate(this.awareness, [this.document.clientID]));
    }
  }

  /** Ends the session (the other side is told) and releases everything. */
  async close(): Promise<void> {
    if (this.destroyed) return;
    this.destroy(); // local teardown is immediate, so callers need not await
    try {
      await this.bridge.close();
    } catch {
      /* already closed */
    }
  }

  /**
   * Resolves once the peer's copy of the document has arrived. Rejects if the
   * session ends first, or after `timeoutMs`.
   */
  whenSynced(timeoutMs = 15000): Promise<void> {
    if (this.status === 'synced') return Promise.resolve();
    if (this.destroyed || this.status === 'disconnected') {
      return Promise.reject(new Error('The session ended before the script arrived.'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.syncWaiters = this.syncWaiters.filter((w) => w !== waiter);
        reject(new Error('Connected, but the script did not arrive. Please try again.'));
      }, timeoutMs);
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.syncWaiters.push(waiter);
    });
  }

  /** Releases listeners without touching the connection. Safe to repeat. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.flushWaiters(new Error('The session ended before the script arrived.'));
    this.removeListeners();
    this.document.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.destroy();
  }

  // ── outgoing ──────────────────────────────────────────────────────────

  private send(type: number, payload: Uint8Array): void {
    // Nothing goes out before the link is up (the hello after connecting
    // carries everything that happened earlier) or after it has ended.
    if (this.destroyed || !this.connected) return;
    const data = frame(type, payload);
    // One at a time, in order; a failed send just means the session is
    // ending, which arrives separately as the closed event.
    this.queue = this.queue.then(() => this.bridge.send(data)).catch(() => {});
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // came from the peer; do not echo it back
    this.send(UPDATE, update);
  };

  private onAwarenessUpdate = (
    ch: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this) return;
    const changed = ch.added.concat(ch.updated, ch.removed);
    this.send(AWARENESS, encodeAwarenessUpdate(this.awareness, changed));
  };

  private onAwarenessChange = (): void => {
    const users: LiveUser[] = [];
    this.awareness.getStates().forEach((state) => {
      const u = (state as { user?: LiveUser }).user;
      if (u?.name) users.push({ name: u.name, color: u.color });
    });
    this.opts.onPeers?.(users);
  };

  // ── incoming ──────────────────────────────────────────────────────────

  private onMessage = (data: Uint8Array): void => {
    if (this.destroyed || data.length < 1) return;
    const payload = data.subarray(1);
    try {
      switch (data[0]) {
        case SYNC_REQUEST:
          this.send(SYNC_REPLY, Y.encodeStateAsUpdate(this.document, payload));
          break;
        case SYNC_REPLY:
          Y.applyUpdate(this.document, payload, this);
          this.setStatus('synced');
          break;
        case UPDATE:
          Y.applyUpdate(this.document, payload, this);
          break;
        case AWARENESS:
          applyAwarenessUpdate(this.awareness, payload, this);
          break;
        default:
          break; // unknown type from a newer version: ignore
      }
    } catch (e) {
      console.error('[Live] bad message ignored', e);
    }
  };

  private onClosed = (reason: string): void => {
    if (this.destroyed) return;
    this.connected = false;
    const others = Array.from(this.awareness.getStates().keys()).filter(
      (id) => id !== this.document.clientID,
    );
    if (others.length) removeAwarenessStates(this.awareness, others, this);
    this.setStatus('disconnected');
    this.opts.onClosed?.(reason);
  };

  private setStatus(s: LiveStatus): void {
    if (this.status === s) return;
    this.status = s;
    if (s === 'synced') this.flushWaiters(null);
    if (s === 'disconnected') this.flushWaiters(new Error('The session ended before the script arrived.'));
    this.opts.onStatus?.(s);
  }

  private flushWaiters(err: Error | null): void {
    const waiters = this.syncWaiters;
    this.syncWaiters = [];
    for (const w of waiters) {
      if (err) w.reject(err);
      else w.resolve();
    }
  }

  private removeListeners(): void {
    for (const u of this.unlisten) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.unlisten = [];
  }
}
