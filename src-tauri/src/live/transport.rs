//! Serverless live-session transport for WriTea Draft.
//!
//! Two people trade short "handshake codes". Each code carries the sender's
//! public address (learned from a public STUN lookup) so both computers can
//! send packets at each other at the same moment ("hole punching"). The
//! connection itself is QUIC through iroh with relays disabled: encrypted,
//! mutually authenticated by public key, and carrying no data through anyone
//! else's server.
//!
//! This file has no Tauri dependency so it can be tested on its own.

use iroh::endpoint::{RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, SecretKey, endpoint::presets};
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::Duration;
use tokio::sync::mpsc;

const ALPN: &[u8] = b"writea-draft/live/1";
const PREFERRED_PORT: u16 = 42200;
const MAX_FRAME: usize = 32 * 1024 * 1024;
const HELLO_OK: &[u8] = b"wt1-ok";
const CODE_PREFIX: &str = "wt1";
pub const DEFAULT_STUN: &[&str] = &[
    "stun.l.google.com:19302",
    "stun.cloudflare.com:3478",
    "stun1.l.google.com:19302",
];

/// Everything that can go wrong, already worded for a person.
#[derive(Debug, Clone)]
pub struct LiveError(pub String);
impl std::fmt::Display for LiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for LiveError {}
fn err<T>(msg: impl Into<String>) -> Result<T, LiveError> {
    Err(LiveError(msg.into()))
}
fn e<E: std::fmt::Display>(ctx: &str) -> impl FnOnce(E) -> LiveError + '_ {
    move |x| LiveError(format!("{ctx} ({x})"))
}

#[derive(Clone, Debug)]
pub struct Config {
    pub stun_servers: Vec<String>,
    /// Port to try first; falls back to any free port if taken.
    pub preferred_port: u16,
    pub connect_timeout: Duration,
}
impl Default for Config {
    fn default() -> Self {
        Config {
            stun_servers: DEFAULT_STUN.iter().map(|s| s.to_string()).collect(),
            preferred_port: PREFERRED_PORT,
            connect_timeout: Duration::from_secs(30),
        }
    }
}

// ── STUN ────────────────────────────────────────────────────────────────

fn stun_lookup(sock: &UdpSocket, servers: &[String]) -> Result<SocketAddr, LiveError> {
    sock.set_read_timeout(Some(Duration::from_secs(2))).map_err(e("socket"))?;
    for s in servers {
        let Some(server) = s.to_socket_addrs().ok().and_then(|mut i| i.find(|a| a.is_ipv4())) else {
            continue;
        };
        let mut req = [0u8; 20];
        req[1] = 0x01; // Binding Request
        req[4..8].copy_from_slice(&0x2112A442u32.to_be_bytes());
        for b in req[8..20].iter_mut() {
            *b = SecretKey::generate().to_bytes()[0];
        }
        for _ in 0..2 {
            if sock.send_to(&req, server).is_err() {
                break;
            }
            let mut buf = [0u8; 512];
            if let Ok((n, from)) = sock.recv_from(&mut buf) {
                if from != server || n < 20 || buf[8..20] != req[8..20] {
                    continue;
                }
                if let Some(a) = parse_xor_mapped(&buf[..n]) {
                    return Ok(a);
                }
            }
        }
    }
    err("Couldn't work out how to be reached from the internet. This network may be blocking the lookup (it uses UDP). Try a different network, or turn on \"Use relay if direct fails\" in Settings.")
}

fn parse_xor_mapped(buf: &[u8]) -> Option<SocketAddr> {
    let mut i = 20;
    while i + 4 <= buf.len() {
        let t = u16::from_be_bytes([buf[i], buf[i + 1]]);
        let l = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        if t == 0x0020 && l >= 8 && i + 12 <= buf.len() && buf[i + 5] == 0x01 {
            let port = u16::from_be_bytes([buf[i + 6], buf[i + 7]]) ^ 0x2112;
            let m = 0x2112A442u32.to_be_bytes();
            let ip = [buf[i + 8] ^ m[0], buf[i + 9] ^ m[1], buf[i + 10] ^ m[2], buf[i + 11] ^ m[3]];
            return Some(SocketAddr::from((ip, port)));
        }
        i += 4 + ((l + 3) & !3);
    }
    None
}

fn punch(sock: &UdpSocket, target: SocketAddr) {
    for _ in 0..8 {
        let _ = sock.send_to(b"punch", target);
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn bind_discovery_socket(preferred: u16) -> Result<UdpSocket, LiveError> {
    UdpSocket::bind(("0.0.0.0", preferred))
        .or_else(|_| UdpSocket::bind(("0.0.0.0", 0)))
        .map_err(e("Couldn't open a network port"))
}

async fn make_endpoint(key: SecretKey, port: u16) -> Result<Endpoint, LiveError> {
    Endpoint::builder(presets::Minimal)
        .secret_key(key)
        .alpns(vec![ALPN.to_vec()])
        .relay_mode(RelayMode::Disabled)
        .bind_addr(format!("0.0.0.0:{port}").as_str())
        .map_err(e("Couldn't set up the connection"))?
        .bind()
        .await
        .map_err(e("Couldn't set up the connection"))
}

// ── Codes ───────────────────────────────────────────────────────────────

fn parse_code(code: &str, parts_wanted: usize) -> Result<Vec<String>, LiveError> {
    let p: Vec<String> = code.split_whitespace().collect::<String>().split('/').map(|s| s.to_string()).collect();
    if p.len() != parts_wanted + 1 || p[0] != CODE_PREFIX {
        return err("That code doesn't look right. Copy the whole thing, including the start.");
    }
    Ok(p[1..].to_vec())
}

// ── Framing ─────────────────────────────────────────────────────────────

async fn write_frame(send: &mut SendStream, data: &[u8]) -> Result<(), LiveError> {
    send.write_all(&(data.len() as u32).to_be_bytes()).await.map_err(e("write"))?;
    send.write_all(data).await.map_err(e("write"))?;
    Ok(())
}
async fn read_frame(recv: &mut RecvStream) -> Result<Vec<u8>, LiveError> {
    let mut len = [0u8; 4];
    recv.read_exact(&mut len).await.map_err(e("read"))?;
    let n = u32::from_be_bytes(len) as usize;
    if n > MAX_FRAME {
        return err("The other side sent something too large.");
    }
    let mut buf = vec![0u8; n];
    recv.read_exact(&mut buf).await.map_err(e("read"))?;
    Ok(buf)
}

// ── Session ─────────────────────────────────────────────────────────────

/// A connected live session. Messages are opaque byte blobs.
pub struct Session {
    pub outgoing: mpsc::UnboundedSender<Vec<u8>>,
    pub incoming: mpsc::UnboundedReceiver<Vec<u8>>,
    /// Resolves (once) with the reason the session ended.
    pub closed: tokio::sync::oneshot::Receiver<String>,
    _endpoint: Endpoint,
    conn: iroh::endpoint::Connection,
}
impl Session {
    pub fn close(&self) {
        self.conn.close(0u32.into(), b"bye");
    }
    /// Splits into the parts a caller can hand to different tasks.
    pub fn into_parts(
        self,
    ) -> (
        mpsc::UnboundedSender<Vec<u8>>,
        mpsc::UnboundedReceiver<Vec<u8>>,
        tokio::sync::oneshot::Receiver<String>,
        Closer,
    ) {
        let closer = self.closer();
        (self.outgoing, self.incoming, self.closed, closer)
    }
    /// A cloneable handle that can end the session from anywhere and keeps the
    /// endpoint alive for as long as it exists.
    pub fn closer(&self) -> Closer {
        Closer { conn: self.conn.clone(), _endpoint: self._endpoint.clone() }
    }
}

#[derive(Clone)]
pub struct Closer {
    conn: iroh::endpoint::Connection,
    _endpoint: Endpoint,
}
impl Closer {
    pub fn close(&self) {
        self.conn.close(0u32.into(), b"bye");
    }
}

fn run_session(
    endpoint: Endpoint,
    conn: iroh::endpoint::Connection,
    mut send: SendStream,
    mut recv: RecvStream,
) -> Session {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (in_tx, in_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (closed_tx, closed_rx) = tokio::sync::oneshot::channel::<String>();
    let conn2 = conn.clone();
    tokio::spawn(async move {
        let writer = async {
            while let Some(m) = out_rx.recv().await {
                if write_frame(&mut send, &m).await.is_err() {
                    return;
                }
            }
            let _ = send.finish();
            // Give the peer a moment to read before the connection drops.
            tokio::time::sleep(Duration::from_millis(300)).await;
        };
        let reader = async {
            loop {
                match read_frame(&mut recv).await {
                    Ok(m) => {
                        if in_tx.send(m).is_err() {
                            return;
                        }
                    }
                    Err(_) => return,
                }
            }
        };
        tokio::select! { _ = writer => {}, _ = reader => {} }
        let reason = match conn2.close_reason() {
            Some(r) => format!("{r}"),
            None => "The other side disconnected.".to_string(),
        };
        let _ = closed_tx.send(reason);
    });
    Session { outgoing: out_tx, incoming: in_rx, closed: closed_rx, _endpoint: endpoint, conn }
}

// ── Host ────────────────────────────────────────────────────────────────

pub struct HostPrep {
    pub code: String,
    sock: UdpSocket,
    key: SecretKey,
    secret: String,
    port: u16,
    cfg: Config,
}

pub async fn host_prepare(cfg: Config) -> Result<HostPrep, LiveError> {
    tokio::task::spawn_blocking(move || {
        let sock = bind_discovery_socket(cfg.preferred_port)?;
        let port = sock.local_addr().map_err(e("socket"))?.port();
        let public = stun_lookup(&sock, &cfg.stun_servers)?;
        let key = SecretKey::generate();
        let secret: String = (0..8).map(|_| format!("{:02x}", SecretKey::generate().to_bytes()[0])).collect();
        let code = format!("{CODE_PREFIX}/{}/{}/{}", key.public(), public, secret);
        Ok(HostPrep { code, sock, key, secret, port, cfg })
    })
    .await
    .map_err(e("internal"))?
}

pub async fn host_accept(prep: HostPrep, guest_code: &str) -> Result<Session, LiveError> {
    let p = parse_code(guest_code, 2)?;
    let gid: EndpointId = p[0].parse().map_err(|_| LiveError("That guest code doesn't look right.".into()))?;
    let gaddr: SocketAddr = p[1].parse().map_err(|_| LiveError("That guest code doesn't look right.".into()))?;
    let HostPrep { sock, key, secret, port, cfg, .. } = prep;
    tokio::task::spawn_blocking(move || {
        punch(&sock, gaddr);
        drop(sock);
    })
    .await
    .map_err(e("internal"))?;
    let ep = make_endpoint(key, port).await?;
    let wait = async {
        loop {
            let incoming = ep.accept().await.ok_or_else(|| LiveError("Connection closed.".into()))?;
            let Ok(accepting) = incoming.accept() else { continue };
            let Ok(conn) = accepting.await else { continue };
            if conn.remote_id() != gid {
                conn.close(1u32.into(), b"unexpected identity");
                continue;
            }
            return Ok::<_, LiveError>(conn);
        }
    };
    let conn = tokio::time::timeout(cfg.connect_timeout, wait)
        .await
        .map_err(|_| no_direct_path())??;
    let (mut send, mut recv) = conn.accept_bi().await.map_err(e("Connection dropped"))?;
    let hello = read_frame(&mut recv).await?;
    if hello != secret.as_bytes() {
        conn.close(2u32.into(), b"bad secret");
        return err("The other side didn't know the secret in your code.");
    }
    write_frame(&mut send, HELLO_OK).await?;
    Ok(run_session(ep, conn, send, recv))
}

// ── Guest ───────────────────────────────────────────────────────────────

pub struct JoinPrep {
    pub code: String,
    sock: UdpSocket,
    key: SecretKey,
    hid: EndpointId,
    haddr: SocketAddr,
    secret: String,
    port: u16,
    cfg: Config,
}

pub async fn join_prepare(cfg: Config, host_code: &str) -> Result<JoinPrep, LiveError> {
    let p = parse_code(host_code, 3)?;
    let bad = || LiveError("That host code doesn't look right.".into());
    let hid: EndpointId = p[0].parse().map_err(|_| bad())?;
    let haddr: SocketAddr = p[1].parse().map_err(|_| bad())?;
    let secret = p[2].clone();
    tokio::task::spawn_blocking(move || {
        let sock = bind_discovery_socket(cfg.preferred_port)?;
        let port = sock.local_addr().map_err(e("socket"))?.port();
        let public = stun_lookup(&sock, &cfg.stun_servers)?;
        let key = SecretKey::generate();
        let code = format!("{CODE_PREFIX}/{}/{}", key.public(), public);
        Ok(JoinPrep { code, sock, key, hid, haddr, secret, port, cfg })
    })
    .await
    .map_err(e("internal"))?
}

pub async fn join_connect(prep: JoinPrep) -> Result<Session, LiveError> {
    let JoinPrep { sock, key, hid, haddr, secret, port, cfg, .. } = prep;
    tokio::task::spawn_blocking(move || {
        punch(&sock, haddr);
        drop(sock);
    })
    .await
    .map_err(e("internal"))?;
    let ep = make_endpoint(key, port).await?;
    let dial = EndpointAddr::new(hid).with_ip_addr(haddr);
    let conn = tokio::time::timeout(cfg.connect_timeout, ep.connect(dial, ALPN))
        .await
        .map_err(|_| no_direct_path())?
        .map_err(|_| no_direct_path())?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(e("Connection dropped"))?;
    write_frame(&mut send, secret.as_bytes()).await?;
    let ok = read_frame(&mut recv).await?;
    if ok != HELLO_OK {
        return err("The host didn't accept the connection.");
    }
    Ok(run_session(ep, conn, send, recv))
}

fn no_direct_path() -> LiveError {
    LiveError("Couldn't reach them directly. One of your networks may be blocking direct connections (some work, school and phone networks do). Try again on a different network, or turn on \"Use relay if direct fails\" in Settings.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::UdpSocket as Std;

    /// Minimal STUN responder on loopback that echoes the sender's address.
    fn fake_stun() -> String {
        let s = Std::bind("127.0.0.1:0").unwrap();
        let addr = s.local_addr().unwrap().to_string();
        std::thread::spawn(move || loop {
            let mut buf = [0u8; 512];
            let Ok((_, from)) = s.recv_from(&mut buf) else { return };
            let SocketAddr::V4(f) = from else { continue };
            let m = 0x2112A442u32.to_be_bytes();
            let ip = f.ip().octets();
            let mut attr = vec![0x00, 0x20, 0x00, 0x08, 0x00, 0x01];
            attr.extend((f.port() ^ 0x2112).to_be_bytes());
            attr.extend([ip[0] ^ m[0], ip[1] ^ m[1], ip[2] ^ m[2], ip[3] ^ m[3]]);
            let mut resp = vec![0x01, 0x01];
            resp.extend((attr.len() as u16).to_be_bytes());
            resp.extend(m);
            resp.extend(&buf[8..20]);
            resp.extend(attr);
            let _ = s.send_to(&resp, from);
        });
        addr
    }

    fn cfg(stun: &str, port: u16) -> Config {
        Config { stun_servers: vec![stun.to_string()], preferred_port: port, connect_timeout: Duration::from_secs(10) }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn two_way_session_moves_bytes_both_ways() {
        let stun = fake_stun();
        let hp = host_prepare(cfg(&stun, 0)).await.unwrap();
        let host_code = hp.code.clone();
        let jp = join_prepare(cfg(&stun, 0), &host_code).await.unwrap();
        let guest_code = jp.code.clone();
        let host = tokio::spawn(async move { host_accept(hp, &guest_code).await });
        let mut guest = join_connect(jp).await.unwrap();
        let mut host = host.await.unwrap().unwrap();

        guest.outgoing.send(b"from guest".to_vec()).unwrap();
        host.outgoing.send(b"from host".to_vec()).unwrap();
        host.outgoing.send(vec![7u8; 3_000_000]).unwrap(); // big frame
        assert_eq!(host.incoming.recv().await.unwrap(), b"from guest");
        assert_eq!(guest.incoming.recv().await.unwrap(), b"from host");
        assert_eq!(guest.incoming.recv().await.unwrap().len(), 3_000_000);

        host.close();
        let reason = tokio::time::timeout(Duration::from_secs(5), guest.closed).await.unwrap().unwrap();
        assert!(!reason.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wrong_secret_is_rejected() {
        let stun = fake_stun();
        let hp = host_prepare(cfg(&stun, 0)).await.unwrap();
        let mut bad = hp.code.clone();
        bad.truncate(bad.len() - 4);
        bad.push_str("ffff");
        let jp = join_prepare(cfg(&stun, 0), &bad).await.unwrap();
        let guest_code = jp.code.clone();
        let host = tokio::spawn(async move { host_accept(hp, &guest_code).await });
        let g = join_connect(jp).await;
        assert!(g.is_err());
        assert!(host.await.unwrap().is_err());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn bad_codes_give_plain_messages() {
        let stun = fake_stun();
        let r = join_prepare(cfg(&stun, 0), "nonsense").await;
        assert!(r.err().unwrap().0.contains("doesn't look right"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn no_stun_gives_plain_message() {
        let r = host_prepare(cfg("127.0.0.1:9", 0)).await;
        assert!(r.err().unwrap().0.contains("blocking the lookup"));
    }
}
