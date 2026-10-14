//! Live sessions: serverless co-editing transport exposed to the web view.
//!
//! The editor never sees the network. It asks for a code, swaps codes with
//! the other person, and then moves opaque byte messages through
//! `live_send` and the `live-message` event (base64). `live-closed` fires
//! once, with a plain-language reason, when the session ends.
//!
//! The connection logic lives in `transport.rs` and has its own tests.

mod transport;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc::UnboundedSender, Mutex};
use transport::{Closer, Config, HostPrep, JoinPrep, Session};

#[derive(Default)]
pub struct LiveState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    host: Option<HostPrep>,
    join: Option<JoinPrep>,
    outgoing: Option<UnboundedSender<Vec<u8>>>,
    closer: Option<Closer>,
}

impl Inner {
    /// Forgets everything and hands back the live connection (if any), so the
    /// caller can close it properly.
    fn take_all(&mut self) -> Option<Closer> {
        self.host = None;
        self.join = None;
        self.outgoing = None;
        self.closer.take()
    }
}

/// Ends any current session and waits for the goodbye to reach the other side.
/// Without the wait, the other person would see a dead session for ~30 seconds.
async fn end_current(state: &LiveState) {
    let old = state.inner.lock().await.take_all();
    if let Some(c) = old {
        c.close_and_wait().await;
    }
}

/// Wires a connected session to the web view.
async fn attach(app: AppHandle, state: &LiveState, session: Session) {
    let (outgoing, mut incoming, closed, closer) = session.into_parts();
    {
        let mut g = state.inner.lock().await;
        g.outgoing = Some(outgoing);
        g.closer = Some(closer);
    }
    tauri::async_runtime::spawn(async move {
        while let Some(m) = incoming.recv().await {
            let _ = app.emit("live-message", B64.encode(m));
        }
        let reason = closed.await.unwrap_or_else(|_| "The session ended.".to_string());
        let _ = app.emit("live-closed", reason);
    });
}

/// Host, step 1: returns the code to send ("Reach out with this code").
#[tauri::command]
pub async fn live_host_prepare(
    state: State<'_, LiveState>,
    relay: Option<bool>,
) -> Result<String, String> {
    end_current(&state).await;
    eprintln!("[live] host_prepare relay={}", relay.unwrap_or(false));
    let made = if relay.unwrap_or(false) {
        transport::relay::host_prepare(Config::default()).await
    } else {
        transport::host_prepare(Config::default()).await
    };
    let prep = made.map_err(|e| e.0)?;
    let code = prep.code.clone();
    state.inner.lock().await.host = Some(prep);
    Ok(code)
}

/// Host, step 2: takes the guest's code and waits for them to connect.
#[tauri::command]
pub async fn live_host_accept(
    app: AppHandle,
    state: State<'_, LiveState>,
    guest_code: String,
) -> Result<(), String> {
    let prep = state
        .inner
        .lock()
        .await
        .host
        .take()
        .ok_or_else(|| "Start a live session first.".to_string())?;
    let session = transport::host_accept(prep, &guest_code).await.map_err(|e| e.0)?;
    attach(app, &state, session).await;
    Ok(())
}

/// Guest, step 1: takes the host's code, returns our code ("Shake the hand with this code").
#[tauri::command]
pub async fn live_join_prepare(
    state: State<'_, LiveState>,
    host_code: String,
) -> Result<String, String> {
    end_current(&state).await;
    let prep = transport::join_prepare(Config::default(), &host_code)
        .await
        .map_err(|e| e.0)?;
    let code = prep.code.clone();
    state.inner.lock().await.join = Some(prep);
    Ok(code)
}

/// Guest, step 2: call once the host has pasted our code.
#[tauri::command]
pub async fn live_join_connect(app: AppHandle, state: State<'_, LiveState>) -> Result<(), String> {
    let prep = state
        .inner
        .lock()
        .await
        .join
        .take()
        .ok_or_else(|| "Enter the host's code first.".to_string())?;
    let session = transport::join_connect(prep).await.map_err(|e| e.0)?;
    attach(app, &state, session).await;
    Ok(())
}

/// Sends one message (base64 of the bytes) to the other side.
#[tauri::command]
pub async fn live_send(state: State<'_, LiveState>, data: String) -> Result<(), String> {
    let bytes = B64.decode(data).map_err(|_| "Bad message.".to_string())?;
    let g = state.inner.lock().await;
    match &g.outgoing {
        Some(tx) => tx.send(bytes).map_err(|_| "The session has ended.".to_string()),
        None => Err("Not in a live session.".to_string()),
    }
}

/// Ends the session (or cancels a half-finished handshake).
#[tauri::command]
pub async fn live_close(state: State<'_, LiveState>) -> Result<(), String> {
    end_current(&state).await;
    Ok(())
}
