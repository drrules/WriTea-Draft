import React, { useEffect, useMemo, useState } from 'react';
import type { Asset } from '../stores/assetStore';
import { getScratchObjectUrl, getScratchUrlSync } from '../services/scratchAssets';

interface AssetViewerProps {
  asset: Asset;
  onClose: () => void;
}

const AssetViewer: React.FC<AssetViewerProps> = ({ asset, onClose }) => {
  // On desktop the store hands back a URL straight away; anywhere else the
  // bytes are read and wrapped in an object URL.
  const syncUrl = useMemo(() => getScratchUrlSync(asset.id) ?? '', [asset.id]);
  const [asyncUrl, setAsyncUrl] = useState('');

  useEffect(() => {
    if (syncUrl) return;
    let revoke: (() => void) | null = null;
    let cancelled = false;
    getScratchObjectUrl(asset.id).then((got) => {
      if (!got) return;
      if (cancelled) { got.revoke(); return; }
      revoke = got.revoke;
      setAsyncUrl(got.url);
    });
    return () => {
      cancelled = true;
      if (revoke) revoke();
    };
  }, [asset.id, syncUrl]);

  const assetUrl = syncUrl || asyncUrl;
  const mime = asset.mime_type;

  const renderPreview = () => {
    if (!assetUrl) {
      return <div className="asset-viewer-fallback">Loading...</div>;
    }
    if (mime.startsWith('image/')) {
      return <img src={assetUrl} alt={asset.original_name} className="asset-viewer-image" />;
    }
    if (mime === 'application/pdf') {
      return <embed src={assetUrl} type="application/pdf" className="asset-viewer-iframe" title={asset.original_name} />;
    }
    if (mime.startsWith('audio/')) {
      return (
        <audio controls className="asset-viewer-audio">
          <source src={assetUrl} type={mime} />
          Your browser does not support the audio element.
        </audio>
      );
    }
    if (mime.startsWith('video/')) {
      return (
        <video controls className="asset-viewer-video">
          <source src={assetUrl} type={mime} />
          Your browser does not support the video element.
        </video>
      );
    }
    if (mime.startsWith('text/')) {
      return <TextPreview url={assetUrl} />;
    }
    return (
      <div className="asset-viewer-fallback">
        <div className="asset-viewer-icon">&#128196;</div>
        <div className="asset-viewer-filename">{asset.original_name}</div>
        <div className="asset-viewer-meta">
          {mime} &middot; {formatSize(asset.size_bytes)}
        </div>
      </div>
    );
  };

  return (
    <div className="asset-viewer-overlay" onClick={onClose}>
      <div className="asset-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="asset-viewer-header">
          <span className="asset-viewer-title">{asset.original_name}</span>
          <button
            className="asset-viewer-close"
            onClick={onClose}
            aria-label="Close asset viewer"
          >
            &times;
          </button>
        </div>
        <div className="asset-viewer-content">
          {renderPreview()}
        </div>
      </div>
    </div>
  );
};

const TextPreview: React.FC<{ url: string }> = ({ url }) => {
  const [text, setText] = React.useState<string>('Loading...');

  React.useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Failed to load text content'));
  }, [url]);

  return <pre className="asset-viewer-text">{text}</pre>;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default AssetViewer;
