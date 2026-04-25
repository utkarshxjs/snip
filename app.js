/* ─────────────────────────────────────────────
   app.js  —  Snip URL Shortener
   Compiled in-browser by @babel/standalone
───────────────────────────────────────────── */

const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ── Constants ──────────────────────────────────
const STORAGE_KEY = 'snip_links_v2';
const BASE        = 'snip.ly/';

// ── Utility helpers ────────────────────────────
const genCode = () =>
  Array.from({ length: 6 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
  ).join('');

const isValidUrl = (u) => {
  try { new URL(u); return true; }
  catch { return false; }
};

const timeAgo = (ts) => {
  const diff = Date.now() - ts;
  const m  = Math.floor(diff / 60_000);
  const h  = Math.floor(diff / 3_600_000);
  const dy = Math.floor(diff / 86_400_000);
  if (m  < 1)  return 'just now';
  if (m  < 60) return `${m}m ago`;
  if (h  < 24) return `${h}h ago`;
  return `${dy}d ago`;
};

const isExpired      = (link) => link.expiresAt && Date.now() > link.expiresAt;
const isExpiringSoon = (link) => link.expiresAt && !isExpired(link) && (link.expiresAt - Date.now()) < 86_400_000;
const fmtDate        = (ts)   => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ── Custom hook: link storage ──────────────────
function useLinks() {
  const [links, setLinks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  });

  // Persist every change to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  }, [links]);

  const addLink = useCallback((originalUrl, alias, expiresAt) => {
    const code = alias?.trim() || genCode();
    if (links.find((l) => l.code === code)) return { error: `Alias "${code}" is already taken.` };
    const link = {
      id: Date.now(),
      code,
      originalUrl,
      clicks:    0,
      clickLog:  [],
      createdAt: Date.now(),
      expiresAt: expiresAt || null,
    };
    setLinks((prev) => [link, ...prev]);
    return { link };
  }, [links]);

  const deleteLink = useCallback((id) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const recordClick = useCallback((id) => {
    setLinks((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, clicks: l.clicks + 1, clickLog: [...(l.clickLog || []), Date.now()] }
          : l
      )
    );
  }, []);

  return { links, addLink, deleteLink, recordClick };
}

// ── QR Code Modal ──────────────────────────────
function QRModal({ link, onClose }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    try {
      new QRCode(containerRef.current, {
        text:         link.originalUrl,
        width:        200,
        height:       200,
        colorDark:    '#000000',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (err) {
      console.error('QRCode error:', err);
    }
  }, [link]);

  const downloadQR = () => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const anchor    = document.createElement('a');
    anchor.download = `qr-snip-${link.code}.png`;
    anchor.href     = canvas.toDataURL('image/png');
    anchor.click();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>QR Code</h3>
        <p>Scan to open the destination URL</p>

        <div className="qr-wrap">
          <div ref={containerRef} style={{ background: '#fff', padding: 12, borderRadius: 10 }} />
          <div className="qr-url-label">{BASE}{link.code}</div>
          <button className="qr-download-btn" onClick={downloadQR}>⬇ Download PNG</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', wordBreak: 'break-all' }}>
          {link.originalUrl}
        </div>

        <div className="modal-actions">
          <button className="modal-cancel" style={{ flex: 1 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Analytics Modal ────────────────────────────
function AnalyticsModal({ link, onClose }) {
  // Build last-7-days click data from clickLog timestamps
  const days = useMemo(() => {
    const result = [];
    const now    = Date.now();
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - i * 86_400_000 - (now % 86_400_000);
      const dayEnd   = dayStart + 86_400_000;
      const count    = (link.clickLog || []).filter((ts) => ts >= dayStart && ts < dayEnd).length;
      const label    = new Date(dayStart).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
      result.push({ label, count, isToday: i === 0 });
    }
    return result;
  }, [link]);

  const maxCount  = Math.max(...days.map((d) => d.count), 1);
  const peakDay   = days.reduce((a, b) => (b.count > a.count ? b : a), days[0]);
  const ageInDays = Math.max(1, Math.ceil((Date.now() - link.createdAt) / 86_400_000));
  const avgPerDay = link.clicks > 0 ? (link.clicks / ageInDays).toFixed(1) : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Click Analytics</h3>
        <p style={{ marginBottom: 0, wordBreak: 'break-all' }}>
          <code style={{ color: 'var(--accent)', fontSize: 13 }}>{BASE}{link.code}</code>
        </p>

        {/* Summary stats */}
        <div className="analytics-grid">
          <div className="a-stat">
            <div className="a-stat-num">{link.clicks}</div>
            <div className="a-stat-lbl">Total clicks</div>
          </div>
          <div className="a-stat">
            <div className="a-stat-num">{avgPerDay}</div>
            <div className="a-stat-lbl">Avg / day</div>
          </div>
          <div className="a-stat">
            <div className="a-stat-num">{peakDay.count > 0 ? peakDay.label : '—'}</div>
            <div className="a-stat-lbl">Peak day</div>
          </div>
        </div>

        {/* Bar chart */}
        <div className="chart-label">Last 7 days</div>
        <div className="bar-chart">
          {days.map((d, i) => (
            <div key={i} className="bar-col">
              <div className="bar-num">{d.count > 0 ? d.count : ''}</div>
              <div
                className="bar"
                style={{ height: `${Math.round((d.count / maxCount) * 60) + 4}px` }}
              />
              <div className="bar-day" style={{ color: d.isToday ? 'var(--accent)' : 'var(--muted)' }}>
                {d.label}
              </div>
            </div>
          ))}
        </div>

        {/* Expiry info */}
        {link.expiresAt && (
          <div className="expiry-info">
            {isExpired(link)
              ? <span style={{ color: 'var(--danger)' }}>✕ Expired on {fmtDate(link.expiresAt)}</span>
              : <>Expires: <span>{fmtDate(link.expiresAt)}</span></>
            }
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
          Created {fmtDate(link.createdAt)}
        </div>

        <div className="modal-actions">
          <button className="modal-cancel" style={{ flex: 1 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Redirect Modal ─────────────────────────────
function RedirectModal({ link, onConfirm, onCancel }) {
  // Expired link — block redirect
  if (isExpired(link)) {
    return (
      <div className="overlay" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3 style={{ color: 'var(--danger)' }}>Link Expired</h3>
          <p>
            This link expired on{' '}
            <strong style={{ color: 'var(--text)' }}>{fmtDate(link.expiresAt)}</strong>{' '}
            and is no longer active.
          </p>
          <div className="dest-url">{link.originalUrl}</div>
          <div className="modal-actions">
            <button className="modal-cancel" style={{ flex: 1 }} onClick={onCancel}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Redirect Preview</h3>
        <p>
          You're about to open the destination for{' '}
          <code style={{ color: 'var(--accent)' }}>{BASE}{link.code}</code>
        </p>
        <div className="dest-url">{link.originalUrl}</div>

        {isExpiringSoon(link) && (
          <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: -12, marginBottom: 14 }}>
            ⚠ This link expires soon
          </div>
        )}

        <div className="modal-actions">
          <button className="modal-go" onClick={onConfirm}>Open link ↗</button>
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Link Card ──────────────────────────────────
function LinkCard({ link, onDelete, onVisit, onQR, onAnalytics }) {
  const [copied, setCopied] = useState(false);
  const expired      = isExpired(link);
  const expiringSoon = isExpiringSoon(link);

  const copyToClipboard = async () => {
    const text = BASE + link.code;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={`link-card${expired ? ' expired' : ''}`}>
      <div className={`link-icon${expired ? ' exp' : ''}`}>
        {expired ? '✕' : '🔗'}
      </div>

      <div className="link-info">
        <div className="badges">
          {expired      && <span className="badge badge-expired">expired</span>}
          {expiringSoon && <span className="badge badge-expiring">expires soon</span>}
        </div>
        <span
          className={`short-url${expired ? ' expired-url' : ''}`}
          onClick={() => !expired && onVisit(link)}
        >
          {BASE}{link.code}
        </span>
        <div className="original-url" title={link.originalUrl}>
          {link.originalUrl}
        </div>
      </div>

      <div className="link-meta">
        <div className="click-badge"><strong>{link.clicks}</strong> clicks</div>
        <div className="time-label">{timeAgo(link.createdAt)}</div>
        <div className="actions">
          <button className={`action-btn${copied ? ' copied' : ''}`} onClick={copyToClipboard}>
            {copied ? '✓' : 'copy'}
          </button>
          <button className="action-btn qr-btn"        onClick={() => onQR(link)}>QR</button>
          <button className="action-btn analytics-btn" onClick={() => onAnalytics(link)}>stats</button>
          <button className="action-btn delete"        onClick={() => onDelete(link.id)}>del</button>
        </div>
      </div>
    </div>
  );
}

// ── Root App ───────────────────────────────────
function App() {
  const { links, addLink, deleteLink, recordClick } = useLinks();

  const [url,       setUrl]       = useState('');
  const [alias,     setAlias]     = useState('');
  const [expiry,    setExpiry]    = useState('');
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [redirect,  setRedirect]  = useState(null);
  const [qrLink,    setQrLink]    = useState(null);
  const [statsLink, setStatsLink] = useState(null);

  const inputRef = useRef(null);

  // Minimum date for the expiry picker (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  const handleShorten = () => {
    const trimmed = url.trim();
    if (!trimmed) { setError('Please enter a URL.'); return; }

    const full = /^https?:\/\//.test(trimmed) ? trimmed : 'https://' + trimmed;
    if (!isValidUrl(full)) { setError("That doesn't look like a valid URL."); return; }

    const expiresAt = expiry ? new Date(expiry).getTime() : null;
    if (expiresAt && expiresAt <= Date.now()) { setError('Expiry date must be in the future.'); return; }

    const result = addLink(full, alias, expiresAt);
    if (result.error) { setError(result.error); return; }

    setUrl(''); setAlias(''); setExpiry(''); setError('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleShorten(); };

  const filtered     = links.filter((l) =>
    l.originalUrl.toLowerCase().includes(search.toLowerCase()) ||
    l.code.toLowerCase().includes(search.toLowerCase())
  );
  const totalClicks  = links.reduce((sum, l) => sum + l.clicks, 0);
  const activeLinks  = links.filter((l) => !isExpired(l)).length;

  return (
    <div className="app">
      {/* Header */}
      <div className="logo">snip.</div>
      <p className="tagline">Shorten • QR Codes • Analytics • <span>localStorage</span></p>

      {/* Input card */}
      <div className="input-card">
        <div className="input-row">
          <input
            ref={inputRef}
            className="url-input"
            type="text"
            placeholder="Paste a long URL to shorten..."
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            spellCheck="false"
          />
          <button className="shorten-btn" onClick={handleShorten} disabled={!url.trim()}>
            Shorten →
          </button>
        </div>

        <div className="options-row">
          <div className="opt-group">
            <span className="opt-label">Alias:</span>
            <input
              className="opt-input"
              style={{ width: 140 }}
              type="text"
              placeholder="custom-slug"
              value={alias}
              onChange={(e) => { setAlias(e.target.value.replace(/\s/g, '-').toLowerCase()); setError(''); }}
              onKeyDown={handleKeyDown}
              spellCheck="false"
            />
          </div>

          <div className="opt-group">
            <span className="opt-label">Expires:</span>
            <input
              className="opt-input"
              style={{ width: 160 }}
              type="date"
              min={minDate}
              value={expiry}
              onChange={(e) => { setExpiry(e.target.value); setError(''); }}
            />
          </div>

          {expiry && (
            <button className="action-btn" style={{ fontSize: 11 }} onClick={() => setExpiry('')}>
              ✕ clear
            </button>
          )}
        </div>

        {error && (
          <div className="error-msg">
            <span className="dot" style={{ background: 'var(--danger)' }} />
            {error}
          </div>
        )}
      </div>

      {/* Global stats */}
      {links.length > 0 && (
        <div className="stats-row">
          <div className="stat-pill"><strong>{links.length}</strong> total links</div>
          <div className="stat-pill"><strong>{activeLinks}</strong> active</div>
          <div className="stat-pill"><strong>{totalClicks}</strong> clicks</div>
        </div>
      )}

      {/* Search (shown when 4+ links exist) */}
      {links.length > 3 && (
        <input
          className="search-input"
          type="text"
          placeholder="Search links or aliases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck="false"
        />
      )}

      {links.length > 0 && <div className="section-label">Your links</div>}

      {/* Link list */}
      <div className="link-list">
        {filtered.length === 0 && links.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">✂</div>
            <p>Paste a URL above to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty"><p>No links match your search.</p></div>
        ) : (
          filtered.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              onDelete={deleteLink}
              onVisit={setRedirect}
              onQR={setQrLink}
              onAnalytics={setStatsLink}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {redirect && (
        <RedirectModal
          link={redirect}
          onConfirm={() => {
            recordClick(redirect.id);
            window.open(redirect.originalUrl, '_blank', 'noopener,noreferrer');
            setRedirect(null);
          }}
          onCancel={() => setRedirect(null)}
        />
      )}

      {qrLink    && <QRModal        link={qrLink}    onClose={() => setQrLink(null)} />}
      {statsLink && <AnalyticsModal link={statsLink} onClose={() => setStatsLink(null)} />}

      {/* Footer */}
      <footer className="footer">
        <span>snip.</span> — all data stored locally in your browser via localStorage. Nothing sent to any server.
      </footer>
    </div>
  );
}

// ── Mount ──────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
