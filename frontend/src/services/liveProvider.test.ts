import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';

// The real Tauri modules are replaced so the base64 path can be tested too.
const tauriMock = vi.hoisted(() => ({
  invoked: [] as Array<{ cmd: string; args: unknown }>,
  handlers: {} as Record<string, (e: { payload: string }) => void>,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: unknown) => {
    tauriMock.invoked.push({ cmd, args });
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, cb: (e: { payload: string }) => void) => {
    tauriMock.handlers[name] = cb;
    return () => {
      delete tauriMock.handlers[name];
    };
  },
}));

import { LiveProvider, tauriBridge, type LiveBridge, type LiveUser } from './liveProvider';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** Two bridges wired back to back, delivering asynchronously like real events. */
function linkedBridges() {
  const mk = () => {
    const state = {
      msg: null as null | ((d: Uint8Array) => void),
      closed: null as null | ((r: string) => void),
      peer: null as any,
      pending: [] as Uint8Array[],
      sent: 0,
    };
    const bridge: LiveBridge = {
      async send(d) {
        state.sent++;
        const copy = d.slice();
        setTimeout(() => state.peer.deliver(copy), 0);
      },
      async onMessage(cb) {
        state.msg = cb;
        return () => {
          state.msg = null;
        };
      },
      async onClosed(cb) {
        state.closed = cb;
        return () => {
          state.closed = null;
        };
      },
      async close() {
        setTimeout(() => state.peer.closed?.('The other person left.'), 0);
      },
    };
    return { bridge, state, deliver: (d: Uint8Array) => state.msg?.(d) };
  };
  const a = mk();
  const b = mk();
  (a.state as any).peer = { deliver: b.deliver, get closed() { return b.state.closed; } };
  (b.state as any).peer = { deliver: a.deliver, get closed() { return a.state.closed; } };
  return { a, b };
}

function setup() {
  const { a, b } = linkedBridges();
  const hostDoc = new Y.Doc();
  const guestDoc = new Y.Doc();
  const hostStatus: string[] = [];
  const guestStatus: string[] = [];
  const hostPeers: LiveUser[][] = [];
  const guestClosed: string[] = [];
  const host = new LiveProvider(hostDoc, {
    bridge: a.bridge,
    onStatus: (s) => hostStatus.push(s),
    onPeers: (u) => hostPeers.push(u),
  });
  const guest = new LiveProvider(guestDoc, {
    bridge: b.bridge,
    onStatus: (s) => guestStatus.push(s),
    onClosed: (r) => guestClosed.push(r),
  });
  return { host, guest, hostDoc, guestDoc, hostStatus, guestStatus, hostPeers, guestClosed, a, b };
}

describe('LiveProvider', () => {
  it("brings the guest up to date with the host's script, in both directions after", async () => {
    const t = setup();
    t.hostDoc.getText('t').insert(0, 'INT. KITCHEN - DAY');
    await Promise.all([t.host.connect(async () => {}), t.guest.connect(async () => {})]);
    await tick();
    expect(t.guestDoc.getText('t').toString()).toBe('INT. KITCHEN - DAY');
    expect(t.guestStatus).toEqual(['connected', 'synced']);
    expect(t.hostStatus).toEqual(['connected', 'synced']);

    // live edits flow both ways
    t.guestDoc.getText('t').insert(0, '>> ');
    t.hostDoc.getText('t').insert(t.hostDoc.getText('t').length, '!');
    await tick();
    expect(t.hostDoc.getText('t').toString()).toBe(t.guestDoc.getText('t').toString());
    expect(t.hostDoc.getText('t').toString()).toBe('>> INT. KITCHEN - DAY!');
  });

  it('merges simultaneous edits without losing either', async () => {
    const t = setup();
    t.hostDoc.getText('t').insert(0, 'ABC');
    await Promise.all([t.host.connect(async () => {}), t.guest.connect(async () => {})]);
    await tick();
    t.hostDoc.getText('t').insert(1, 'h');
    t.guestDoc.getText('t').insert(1, 'g');
    await tick();
    const h = t.hostDoc.getText('t').toString();
    expect(h).toBe(t.guestDoc.getText('t').toString());
    expect(h.length).toBe(5);
    expect(h).toContain('h');
    expect(h).toContain('g');
  });

  it('does not echo remote changes back (no infinite ping-pong)', async () => {
    const t = setup();
    await Promise.all([t.host.connect(async () => {}), t.guest.connect(async () => {})]);
    await tick();
    const before = t.a.state.sent + t.b.state.sent;
    t.hostDoc.getText('t').insert(0, 'x');
    await tick();
    await tick();
    const after = t.a.state.sent + t.b.state.sent;
    expect(after - before).toBe(1); // exactly one UPDATE crossed the link
  });

  it('shares who is present, with names and colours', async () => {
    const t = setup();
    t.host.awareness.setLocalStateField('user', { name: 'Ad', color: '#e11d48' });
    t.guest.awareness.setLocalStateField('user', { name: 'Partner', color: '#0ea5e9' });
    await Promise.all([t.host.connect(async () => {}), t.guest.connect(async () => {})]);
    await tick();
    const last = t.hostPeers[t.hostPeers.length - 1].map((u) => u.name).sort();
    expect(last).toEqual(['Ad', 'Partner']);
    // a user who sets their state after connecting is picked up too
    t.guest.awareness.setLocalStateField('user', { name: 'Partner', color: '#0ea5e9', extra: 1 });
    await tick();
    expect(t.host.awareness.getStates().size).toBe(2);
  });

  it('does not miss messages that arrive while the connection is still being made', async () => {
    const t = setup();
    t.hostDoc.getText('t').insert(0, 'early');
    // guest connects first; the host's hello lands while the guest is still in establish()
    const guestDone = t.guest.connect(async () => {
      await t.host.connect(async () => {});
      await tick();
      await tick();
    });
    await guestDone;
    await tick();
    expect(t.guestDoc.getText('t').toString()).toBe('early');
  });

  it('reports the end of the session and removes the other person', async () => {
    const t = setup();
    t.host.awareness.setLocalStateField('user', { name: 'Ad', color: '#111' });
    t.guest.awareness.setLocalStateField('user', { name: 'Partner', color: '#222' });
    const guestPeers: LiveUser[][] = [];
    (t.guest as any).opts.onPeers = (u: LiveUser[]) => guestPeers.push(u);
    await Promise.all([t.host.connect(async () => {}), t.guest.connect(async () => {})]);
    await tick();
    await t.host.close();
    await tick();
    expect(t.guestClosed).toEqual(['The other person left.']);
    expect(t.guestStatus[t.guestStatus.length - 1]).toBe('disconnected');
    const lastPeers = guestPeers[guestPeers.length - 1].map((u) => u.name);
    expect(lastPeers).toEqual(['Partner']);
    // closing twice, or destroying after, is harmless
    await t.host.close();
    t.host.destroy();
    t.guest.destroy();
  });

  it('cleans up and rethrows when the connection attempt fails', async () => {
    const t = setup();
    await expect(
      t.host.connect(async () => {
        throw new Error('That code did not work.');
      }),
    ).rejects.toThrow('That code did not work.');
    expect(t.a.state.msg).toBeNull();
    expect(t.a.state.closed).toBeNull();
    expect(t.hostStatus).toEqual([]);
  });

  it('ignores junk and unknown message types', async () => {
    const t = setup();
    await Promise.all([t.host.connect(async () => {}), t.guest.connect(async () => {})]);
    t.a.state.msg!(new Uint8Array([]));
    t.a.state.msg!(new Uint8Array([99, 1, 2, 3]));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    t.a.state.msg!(new Uint8Array([1, 255, 255, 255]));
    spy.mockRestore();
    t.hostDoc.getText('t').insert(0, 'still works');
    await tick();
    expect(t.guestDoc.getText('t').toString()).toBe('still works');
  });
});

describe('tauriBridge', () => {
  it('moves a 3 MB message through base64 unchanged', async () => {
    const data = new Uint8Array(3_000_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 255;
    await tauriBridge.send(data);
    const call = tauriMock.invoked.find((c) => c.cmd === 'live_send')!;
    const b64 = (call.args as { data: string }).data;
    let got: Uint8Array | null = null;
    await tauriBridge.onMessage((d) => (got = d));
    tauriMock.handlers['live-message']({ payload: b64 });
    expect(got).not.toBeNull();
    expect(got!.length).toBe(data.length);
    expect(Buffer.from(got!).equals(Buffer.from(data))).toBe(true);
  });

  it('delivers the closed reason as plain text', async () => {
    let reason = '';
    await tauriBridge.onClosed((r) => (reason = r));
    tauriMock.handlers['live-closed']({ payload: 'The other person left.' });
    expect(reason).toBe('The other person left.');
    await tauriBridge.close();
    expect(tauriMock.invoked.some((c) => c.cmd === 'live_close')).toBe(true);
  });
});
