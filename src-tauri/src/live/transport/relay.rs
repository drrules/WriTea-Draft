//! Relay fallback.
//!
//! Used only after a direct connection has failed and the host starts again in
//! relay mode. It is the same two-code swap as the direct path, but nothing
//! knocks: the host's code carries the address of the relay the host is
//! connected to, and the guest dials the host through it. The session is still
//! end-to-end encrypted and authenticated by key. The relay only forwards bytes
//! it cannot read, but it does see both IP addresses.

use super::*;

const RELAY_PREFIX: &str = "wt1r";
const RELAY_ONLINE_WAIT: Duration = Duration::from_secs(10);

/// True for a host code made in relay mode.
pub fn is_relay_code(code: &str) -> bool {
    let compact: String = code.split_whitespace().collect();
    compact.starts_with(&format!("{RELAY_PREFIX}/"))
}

fn plain_host_chars(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
}

/// The relay's address without `https://` and the trailing `/`, so it fits in
/// a code (codes are split on `/`).
fn shorten(url: &str) -> Option<String> {
    let s = url.strip_prefix("https://")?.trim_end_matches('/');
    plain_host_chars(s).then(|| s.to_string())
}

fn lengthen(s: &str) -> Result<String, LiveError> {
    if !plain_host_chars(s) {
        return err("That relay code doesn't look right.");
    }
    Ok(format!("https://{s}/"))
}

fn relay_unreachable() -> LiveError {
    LiveError("Couldn't reach the relay service. Check your internet connection and try again in a few minutes.".into())
}

fn relay_failed(who: &str, detail: &str) -> LiveError {
    LiveError(format!("Couldn't connect through the relay either. (Technical detail, {who}: {detail}.)"))
}

async fn make_relay_endpoint(key: SecretKey) -> Result<Endpoint, LiveError> {
    Endpoint::builder(presets::Minimal)
        .secret_key(key)
        .alpns(vec![ALPN.to_vec()])
        .relay_mode(RelayMode::Default)
        .bind()
        .await
        .map_err(e("Couldn't set up the connection"))
}

/// Host, relay mode: connects to a relay and puts its address in the code.
pub async fn host_prepare(cfg: Config) -> Result<HostPrep, LiveError> {
    let ep = make_relay_endpoint(SecretKey::generate()).await?;
    tokio::time::timeout(RELAY_ONLINE_WAIT, ep.online())
        .await
        .map_err(|_| relay_unreachable())?;
    let addr = ep.addr();
    let Some(relay) = addr.relay_urls().next().and_then(|u| shorten(u.as_str())) else {
        return Err(relay_unreachable());
    };
    trace(format!("host: relay mode, connected to {relay}"));
    let secret: String = (0..8).map(|_| format!("{:02x}", SecretKey::generate().to_bytes()[0])).collect();
    let code = format!("{RELAY_PREFIX}/{}/{relay}/{secret}", ep.id());
    Ok(HostPrep {
        code,
        relay_ep: Some(ep),
        sock: bind_discovery_socket(0)?,
        key: SecretKey::generate(),
        secret,
        port: 0,
        cfg,
    })
}

/// Host, relay mode: waits for the guest to dial in through the relay.
pub async fn host_accept(ep: Endpoint, gid: EndpointId, secret: String, cfg: Config) -> Result<Session, LiveError> {
    trace("host: relay mode, waiting for the guest");
    let wait = async {
        loop {
            let incoming = ep.accept().await.ok_or_else(|| LiveError("Connection closed.".into()))?;
            let accepting = match incoming.accept() {
                Ok(a) => a,
                Err(x) => {
                    trace(format!("host: could not accept the attempt: {x}"));
                    continue;
                }
            };
            let conn = match accepting.await {
                Ok(c) => c,
                Err(x) => {
                    trace(format!("host: the attempt failed: {x}"));
                    continue;
                }
            };
            if conn.remote_id() != gid {
                conn.close(1u32.into(), b"unexpected identity");
                continue;
            }
            return Ok::<_, LiveError>(conn);
        }
    };
    let conn = tokio::time::timeout(cfg.host_wait, wait).await.map_err(|_| {
        trace("host: no one connected through the relay in time");
        relay_failed("host", "no connection arrived in time")
    })??;
    trace("host: connected through the relay");
    let (mut send, mut recv) = conn.accept_bi().await.map_err(e("Connection dropped"))?;
    let hello = read_frame(&mut recv).await?;
    if hello != secret.as_bytes() {
        conn.close(2u32.into(), b"bad secret");
        return err("The other side didn't know the secret in your code.");
    }
    write_frame(&mut send, HELLO_OK).await?;
    Ok(run_session(ep, conn, send, recv))
}

/// Guest, relay mode: reads the host's relay code. Nothing to look up, so the
/// guest's own code is just its key.
pub async fn join_prepare(cfg: Config, host_code: &str) -> Result<JoinPrep, LiveError> {
    let compact: String = host_code.split_whitespace().collect();
    let p: Vec<&str> = compact.split('/').collect();
    let bad = || LiveError("That host code doesn't look right.".into());
    if p.len() != 4 || p[0] != RELAY_PREFIX {
        return Err(bad());
    }
    let hid: EndpointId = p[1].parse().map_err(|_| bad())?;
    let relay = lengthen(p[2])?;
    let secret = p[3].to_string();
    let key = SecretKey::generate();
    let code = format!("{CODE_PREFIX}/{}/relay", key.public());
    Ok(JoinPrep {
        code,
        relay: Some(relay),
        sock: bind_discovery_socket(0)?,
        key,
        hid,
        hcands: Vec::new(),
        secret,
        port: 0,
        cfg,
    })
}

/// Guest, relay mode: dials the host through the relay.
pub async fn join_connect(prep: JoinPrep) -> Result<Session, LiveError> {
    let JoinPrep { key, hid, secret, cfg, relay, .. } = prep;
    let Some(url) = relay else {
        return err("That code doesn't look right.");
    };
    trace(format!("guest: relay mode, dialling through {url}"));
    let ep = make_relay_endpoint(key).await?;
    let dial = EndpointAddr::new(hid).with_relay_url(
        url.parse()
            .map_err(|_| LiveError("That relay code doesn't look right.".into()))?,
    );
    let conn = tokio::time::timeout(cfg.connect_timeout, ep.connect(dial, ALPN))
        .await
        .map_err(|_| {
            trace("guest: the relay connection attempt timed out");
            relay_failed("guest", "the connection attempt timed out")
        })?
        .map_err(|x| {
            trace(format!("guest: the relay connection attempt failed: {x}"));
            relay_failed("guest", &format!("the connection attempt failed: {x}"))
        })?;
    trace("guest: connected through the relay");
    let (mut send, mut recv) = conn.open_bi().await.map_err(e("Connection dropped"))?;
    write_frame(&mut send, secret.as_bytes()).await?;
    let ok = read_frame(&mut recv).await?;
    if ok != HELLO_OK {
        return err("The host didn't accept the connection.");
    }
    Ok(run_session(ep, conn, send, recv))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_address_round_trips() {
        let s = shorten("https://use1-1.relay.n0.iroh.link./").unwrap();
        assert_eq!(s, "use1-1.relay.n0.iroh.link.");
        assert_eq!(lengthen(&s).unwrap(), "https://use1-1.relay.n0.iroh.link./");
        assert!(shorten("https://example.com/path/x").is_none());
        assert!(lengthen("a/b").is_err());
    }
}
