/*
  app.js - Snip URL workspace
  Compiled in-browser by @babel/standalone
*/

const { useState, useEffect, useCallback, useRef, useMemo } = React;

const STORAGE_KEY = 'snip_links_v2';
const BASE = 'snip.ly/';
const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

const genCode = (length = 6) =>
  Array.from({ length }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

const sanitizeCode = (value = '') =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const normalizeUrlInput = (value = '') => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const isValidUrl = (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const timeAgo = (ts) => {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const isExpired = (link) => Boolean(link.expiresAt && Date.now() > link.expiresAt);
const isExpiringSoon = (link) =>
  Boolean(link.expiresAt && !isExpired(link) && link.expiresAt - Date.now() < 86_400_000);

const toDateInputValue = (ts) => {
  if (!ts) return '';
  const date = new Date(ts);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().split('T')[0];
};

const getDayStart = (ts) => {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getLastClickedAt = (link) =>
  Array.isArray(link.clickLog) && link.clickLog.length > 0 ? link.clickLog[link.clickLog.length - 1] : null;

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const buildUniqueCode = (desiredCode, usedCodes) => {
  const base = sanitizeCode(desiredCode) || genCode();
  if (!usedCodes.has(base)) return base;

  let suffix = 1;
  while (usedCodes.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

const normalizeLink = (raw, index = 0) => {
  if (!raw || typeof raw !== 'object') return null;

  const originalUrl = normalizeUrlInput(String(raw.originalUrl || ''));
  const code = sanitizeCode(String(raw.code || ''));
  if (!originalUrl || !code || !isValidUrl(originalUrl)) return null;

  const clickLog = Array.isArray(raw.clickLog)
    ? raw.clickLog.map(Number).filter((ts) => Number.isFinite(ts)).sort((a, b) => a - b)
    : [];

  const parsedClicks = Number(raw.clicks);
  const clicks = Number.isFinite(parsedClicks) ? Math.max(Math.max(0, parsedClicks), clickLog.length) : clickLog.length;
  const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now() + index;
  const expiresAt = Number.isFinite(Number(raw.expiresAt)) ? Number(raw.expiresAt) : null;
  const id = Number.isFinite(Number(raw.id)) ? Number(raw.id) : Date.now() + index + Math.floor(Math.random() * 1000);

  return {
    id,
    code,
    originalUrl,
    clicks,
    clickLog,
    createdAt,
    expiresAt,
  };
};

const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
};

const parseImportedLinks = (text, filename = '') => {
  const trimmed = text.trim();
  const lowerName = filename.toLowerCase();

  if (!trimmed) return [];

  if (lowerName.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.links)) return parsed.links;
    throw new Error('JSON import must be an array or an object with a links array.');
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length === 0) return [];

  const [headerRow, ...bodyRows] = rows;
  const headers = headerRow.map((cell) => cell.trim());

  const findIndex = (names) => headers.findIndex((header) => names.includes(header));
  const codeIndex = findIndex(['code', 'alias', 'slug']);
  const urlIndex = findIndex(['originalUrl', 'url', 'destination']);
  const clicksIndex = findIndex(['clicks']);
  const createdAtIndex = findIndex(['createdAt']);
  const expiresAtIndex = findIndex(['expiresAt']);
  const lastClickedAtIndex = findIndex(['lastClickedAt']);

  if (codeIndex === -1 || urlIndex === -1) {
    throw new Error('CSV import needs at least code and originalUrl columns.');
  }

  return bodyRows.map((row, index) => {
    const clicks = Math.max(0, Math.floor(Number(row[clicksIndex] || 0)));
    const lastClickedAt = Number(row[lastClickedAtIndex] || 0);
    const clickLog =
      Number.isFinite(clicks) && clicks > 0
        ? Array.from(
            { length: Math.max(1, clicks) },
            () => (Number.isFinite(lastClickedAt) && lastClickedAt > 0 ? lastClickedAt : Date.now())
          )
        : [];

    return {
      id: Date.now() + index,
      code: row[codeIndex] || '',
      originalUrl: row[urlIndex] || '',
      clicks: Number.isFinite(clicks) ? clicks : 0,
      createdAt: Number(row[createdAtIndex] || 0) || Date.now() + index,
      expiresAt: Number(row[expiresAtIndex] || 0) || null,
      clickLog,
    };
  });
};

const escapeCsv = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const linksToCsv = (links) => {
  const rows = [
    ['code', 'originalUrl', 'clicks', 'createdAt', 'expiresAt', 'lastClickedAt'],
    ...links.map((link) => [
      link.code,
      link.originalUrl,
      link.clicks,
      link.createdAt,
      link.expiresAt || '',
      getLastClickedAt(link) || '',
    ]),
  ];

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
};

const downloadTextFile = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const mergeImportedLinks = (existingLinks, rawLinks) => {
  const usedCodes = new Set(existingLinks.map((link) => link.code));
  const usedIds = new Set(existingLinks.map((link) => link.id));
  const imported = [];
  let renamed = 0;
  let skipped = 0;

  rawLinks.forEach((rawLink, index) => {
    const normalized = normalizeLink(rawLink, index);
    if (!normalized) {
      skipped += 1;
      return;
    }

    const duplicate = existingLinks.find(
      (link) => link.code === normalized.code && link.originalUrl === normalized.originalUrl
    );
    if (duplicate) {
      skipped += 1;
      return;
    }

    const nextCode = buildUniqueCode(normalized.code, usedCodes);
    if (nextCode !== normalized.code) renamed += 1;

    let nextId = normalized.id;
    while (usedIds.has(nextId)) nextId += 1;

    usedCodes.add(nextCode);
    usedIds.add(nextId);
    imported.push({ ...normalized, code: nextCode, id: nextId });
  });

  return {
    links: [...imported, ...existingLinks].sort((a, b) => b.createdAt - a.createdAt),
    summary: {
      imported: imported.length,
      renamed,
      skipped,
    },
  };
};

function useLinks() {
  const [links, setLinks] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return mergeImportedLinks([], Array.isArray(parsed) ? parsed : []).links;
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  }, [links]);

  const addLink = useCallback(
    (originalUrl, alias, expiresAt) => {
      const code = sanitizeCode(alias) || genCode();
      if (links.find((link) => link.code === code)) {
        return { error: `Alias "${code}" is already taken.` };
      }

      const link = {
        id: Date.now(),
        code,
        originalUrl,
        clicks: 0,
        clickLog: [],
        createdAt: Date.now(),
        expiresAt: expiresAt || null,
      };

      setLinks((prev) => [link, ...prev]);
      return { link };
    },
    [links]
  );

  const updateLink = useCallback(
    (id, updates) => {
      const currentLink = links.find((link) => link.id === id);
      if (!currentLink) return { error: 'Link not found.' };

      const code = sanitizeCode(updates.code || '');
      const originalUrl = normalizeUrlInput(updates.originalUrl || '');
      const expiresAt = updates.expiresAt || null;

      if (!code) return { error: 'Alias cannot be empty.' };
      if (!originalUrl || !isValidUrl(originalUrl)) return { error: 'Please enter a valid destination URL.' };
      if (expiresAt && expiresAt <= Date.now()) return { error: 'Expiry date must be in the future.' };
      if (links.some((link) => link.id !== id && link.code === code)) {
        return { error: `Alias "${code}" is already taken.` };
      }

      const updatedLink = {
        ...currentLink,
        code,
        originalUrl,
        expiresAt,
      };

      setLinks((prev) =>
        prev.map((link) => (link.id === id ? updatedLink : link))
      );

      return { link: updatedLink };
    },
    [links]
  );

  const deleteLink = useCallback((id) => {
    setLinks((prev) => prev.filter((link) => link.id !== id));
  }, []);

  const recordClick = useCallback((id) => {
    setLinks((prev) =>
      prev.map((link) =>
        link.id === id
          ? { ...link, clicks: link.clicks + 1, clickLog: [...link.clickLog, Date.now()] }
          : link
      )
    );
  }, []);

  const importLinks = useCallback(
    (rawLinks) => {
      const result = mergeImportedLinks(links, rawLinks);
      setLinks(result.links);
      return result.summary;
    },
    [links]
  );

  return { links, addLink, updateLink, deleteLink, recordClick, importLinks };
}

function QRModal({ link, onClose }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    try {
      new QRCode(containerRef.current, {
        text: link.originalUrl,
        width: 200,
        height: 200,
        colorDark: '#0d0f12',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (err) {
      console.error('QRCode error:', err);
    }
  }, [link]);

  const downloadQR = () => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;

    const anchor = document.createElement('a');
    anchor.download = `qr-snip-${link.code}.png`;
    anchor.href = canvas.toDataURL('image/png');
    anchor.click();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>QR Code</h3>
            <p>Scan to open the destination URL.</p>
          </div>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        <div className="qr-wrap">
          <div className="qr-canvas-box" ref={containerRef} />
          <div className="qr-url-label">{BASE}{link.code}</div>
          <button className="modal-go secondary" onClick={downloadQR}>Download PNG</button>
        </div>

        <div className="dest-url">{link.originalUrl}</div>
      </div>
    </div>
  );
}

function AnalyticsModal({ link, onClose }) {
  const days = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 7 }, (_, index) => {
      const offset = 6 - index;
      const dayStart = getDayStart(now - offset * 86_400_000);
      const dayEnd = dayStart + 86_400_000;
      const count = link.clickLog.filter((ts) => ts >= dayStart && ts < dayEnd).length;
      return {
        label: new Date(dayStart).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
        count,
        isToday: offset === 0,
      };
    });
  }, [link]);

  const recentClicks = [...link.clickLog].sort((a, b) => b - a).slice(0, 8);
  const lastClickedAt = recentClicks[0] || null;
  const clicksToday = days[days.length - 1]?.count || 0;
  const ageInDays = Math.max(1, Math.ceil((Date.now() - link.createdAt) / 86_400_000));
  const avgPerDay = link.clicks > 0 ? (link.clicks / ageInDays).toFixed(1) : '0.0';
  const maxCount = Math.max(...days.map((day) => day.count), 1);
  const peakDay = days.reduce((best, day) => (day.count > best.count ? day : best), days[0]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Click Analytics</h3>
            <p>Deeper stats for <code>{BASE}{link.code}</code>.</p>
          </div>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        <div className="analytics-grid">
          <div className="a-stat">
            <div className="a-stat-num">{link.clicks}</div>
            <div className="a-stat-lbl">Total clicks</div>
          </div>
          <div className="a-stat">
            <div className="a-stat-num">{clicksToday}</div>
            <div className="a-stat-lbl">Today</div>
          </div>
          <div className="a-stat">
            <div className="a-stat-num">{avgPerDay}</div>
            <div className="a-stat-lbl">Avg per day</div>
          </div>
          <div className="a-stat">
            <div className="a-stat-num">{lastClickedAt ? timeAgo(lastClickedAt) : 'Never'}</div>
            <div className="a-stat-lbl">Last click</div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <div className="chart-label">Last 7 days</div>
              <div className="chart-subtle">
                Peak day: {peakDay.count > 0 ? `${peakDay.label} (${peakDay.count})` : 'No activity yet'}
              </div>
            </div>
          </div>

          <div className="bar-chart">
            {days.map((day) => (
              <div key={day.label} className="bar-col">
                <div className="bar-num">{day.count || ''}</div>
                <div
                  className={`bar${day.isToday ? ' active' : ''}`}
                  style={{ height: `${Math.round((day.count / maxCount) * 78) + 6}px` }}
                />
                <div className="bar-day">{day.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-card">
            <div className="detail-title">Link info</div>
            <div className="detail-row"><span>Created</span><strong>{fmtDate(link.createdAt)}</strong></div>
            <div className="detail-row"><span>Status</span><strong>{isExpired(link) ? 'Expired' : 'Active'}</strong></div>
            <div className="detail-row">
              <span>Expires</span>
              <strong>{link.expiresAt ? fmtDate(link.expiresAt) : 'No expiry'}</strong>
            </div>
          </div>

          <div className="detail-card">
            <div className="detail-title">Recent activity</div>
            {recentClicks.length === 0 ? (
              <div className="activity-empty">No clicks recorded yet.</div>
            ) : (
              <div className="activity-list">
                {recentClicks.map((ts, index) => (
                  <div key={`${ts}-${index}`} className="activity-item">
                    <span>{index === 0 ? 'Latest click' : `Earlier click ${index}`}</span>
                    <strong>{fmtDateTime(ts)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dest-url">{link.originalUrl}</div>
      </div>
    </div>
  );
}

function RedirectModal({ link, onConfirm, onCancel }) {
  if (isExpired(link)) {
    return (
      <div className="overlay" onClick={onCancel}>
        <div className="modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h3>Link Expired</h3>
              <p>This link is no longer active.</p>
            </div>
            <button className="modal-close" onClick={onCancel}>Close</button>
          </div>

          <div className="detail-card inline-card danger-card">
            <div className="detail-row">
              <span>Expired on</span>
              <strong>{fmtDate(link.expiresAt)}</strong>
            </div>
          </div>

          <div className="dest-url">{link.originalUrl}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Redirect Preview</h3>
            <p>You are about to open <code>{BASE}{link.code}</code>.</p>
          </div>
          <button className="modal-close" onClick={onCancel}>Close</button>
        </div>

        <div className="dest-url">{link.originalUrl}</div>

        {isExpiringSoon(link) && (
          <div className="notice-banner warn">
            This link expires soon, so update it if you still want it active.
          </div>
        )}

        <div className="modal-actions">
          <button className="modal-go" onClick={onConfirm}>Open link</button>
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ link, minDate, onSave, onClose }) {
  const [url, setUrl] = useState(link.originalUrl);
  const [code, setCode] = useState(link.code);
  const [expiry, setExpiry] = useState(toDateInputValue(link.expiresAt));
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const originalUrl = normalizeUrlInput(url);
    if (!originalUrl || !isValidUrl(originalUrl)) {
      setError('Please enter a valid destination URL.');
      return;
    }

    const nextCode = sanitizeCode(code);
    if (!nextCode) {
      setError('Alias cannot be empty.');
      return;
    }

    const expiresAt = expiry ? new Date(expiry).getTime() : null;
    const result = onSave({
      originalUrl,
      code: nextCode,
      expiresAt,
    });

    if (result?.error) {
      setError(result.error);
      return;
    }

    onClose();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') handleSubmit();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Edit Link</h3>
            <p>Update the alias, destination, or expiry date.</p>
          </div>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        <div className="field-stack">
          <label className="field">
            <span className="field-label">Destination URL</span>
            <input
              className="url-input"
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              spellCheck="false"
            />
          </label>

          <div className="dual-fields">
            <label className="field">
              <span className="field-label">Alias</span>
              <input
                className="opt-input large"
                type="text"
                value={code}
                onChange={(event) => {
                  setCode(sanitizeCode(event.target.value));
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                spellCheck="false"
              />
            </label>

            <label className="field">
              <span className="field-label">Expiry</span>
              <input
                className="opt-input large"
                type="date"
                min={minDate}
                value={expiry}
                onChange={(event) => {
                  setExpiry(event.target.value);
                  setError('');
                }}
              />
            </label>
          </div>
        </div>

        {error && <div className="notice-banner error">{error}</div>}

        <div className="modal-actions">
          <button className="modal-go" onClick={handleSubmit}>Save changes</button>
          <button className="modal-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function LinkCard({ link, onDelete, onEdit, onVisit, onQR, onAnalytics }) {
  const [copied, setCopied] = useState(false);
  const expired = isExpired(link);
  const expiringSoon = isExpiringSoon(link);
  const lastClickedAt = getLastClickedAt(link);

  const copyToClipboard = async () => {
    const text = `${BASE}${link.code}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
      <div className={`link-icon${expired ? ' exp' : ''}`}>{expired ? 'X' : 'GO'}</div>

      <div className="link-info">
        <div className="badges">
          {expired && <span className="badge badge-expired">expired</span>}
          {expiringSoon && <span className="badge badge-expiring">expires soon</span>}
          {!expired && link.clicks > 0 && <span className="badge badge-live">active</span>}
        </div>

        <button
          className={`short-url${expired ? ' expired-url' : ''}`}
          onClick={() => !expired && onVisit(link.id)}
        >
          {BASE}{link.code}
        </button>

        <div className="original-url" title={link.originalUrl}>
          {link.originalUrl}
        </div>

        <div className="link-submeta">
          <span>Created {fmtDate(link.createdAt)}</span>
          <span>{lastClickedAt ? `Last click ${timeAgo(lastClickedAt)}` : 'No clicks yet'}</span>
          <span>{link.expiresAt ? `Expires ${fmtDate(link.expiresAt)}` : 'No expiry'}</span>
        </div>
      </div>

      <div className="link-meta">
        <div className="click-badge"><strong>{link.clicks}</strong> clicks</div>
        <div className="time-label">{timeAgo(link.createdAt)}</div>

        <div className="actions">
          <button className={`action-btn${copied ? ' copied' : ''}`} onClick={copyToClipboard}>
            {copied ? 'copied' : 'copy'}
          </button>
          <button className="action-btn" onClick={() => onVisit(link.id)}>open</button>
          <button className="action-btn qr-btn" onClick={() => onQR(link.id)}>qr</button>
          <button className="action-btn edit-btn" onClick={() => onEdit(link.id)}>edit</button>
          <button className="action-btn analytics-btn" onClick={() => onAnalytics(link.id)}>stats</button>
          <button className="action-btn delete" onClick={() => onDelete(link.id)}>del</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { links, addLink, updateLink, deleteLink, recordClick, importLinks } = useLinks();

  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(null);
  const [redirectId, setRedirectId] = useState(null);
  const [qrId, setQrId] = useState(null);
  const [statsId, setStatsId] = useState(null);
  const [editId, setEditId] = useState(null);

  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  useEffect(() => {
    if (!status) return undefined;
    const timer = window.setTimeout(() => setStatus(null), 3200);
    return () => window.clearTimeout(timer);
  }, [status]);

  const redirectLink = links.find((link) => link.id === redirectId) || null;
  const qrLink = links.find((link) => link.id === qrId) || null;
  const statsLink = links.find((link) => link.id === statsId) || null;
  const editLink = links.find((link) => link.id === editId) || null;

  const filteredLinks = links.filter((link) => {
    const needle = search.toLowerCase();
    return link.originalUrl.toLowerCase().includes(needle) || link.code.toLowerCase().includes(needle);
  });

  const totalClicks = links.reduce((sum, link) => sum + link.clicks, 0);
  const activeLinks = links.filter((link) => !isExpired(link)).length;
  const expiringSoonCount = links.filter((link) => isExpiringSoon(link)).length;
  const topLink = links.reduce((best, link) => (link.clicks > (best?.clicks || -1) ? link : best), null);

  const handleShorten = () => {
    const originalUrl = normalizeUrlInput(url);
    if (!originalUrl) {
      setError('Please enter a URL.');
      return;
    }

    if (!isValidUrl(originalUrl)) {
      setError("That doesn't look like a valid URL.");
      return;
    }

    const expiresAt = expiry ? new Date(expiry).getTime() : null;
    if (expiresAt && expiresAt <= Date.now()) {
      setError('Expiry date must be in the future.');
      return;
    }

    const result = addLink(originalUrl, alias, expiresAt);
    if (result.error) {
      setError(result.error);
      return;
    }

    setUrl('');
    setAlias('');
    setExpiry('');
    setError('');
    setStatus({ type: 'success', message: 'Short link created and ready to use.' });
    inputRef.current?.focus();
  };

  const handleExport = (format) => {
    if (links.length === 0) {
      setStatus({ type: 'error', message: 'Create or import a link before exporting.' });
      return;
    }

    if (format === 'json') {
      downloadTextFile('snip-links.json', JSON.stringify(links, null, 2), 'application/json');
    } else {
      downloadTextFile('snip-links.csv', linksToCsv(links), 'text/csv;charset=utf-8');
    }

    setStatus({ type: 'success', message: `Exported ${pluralize(links.length, 'link')} as ${format.toUpperCase()}.` });
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = parseImportedLinks(text, file.name);
      const summary = importLinks(imported);

      if (summary.imported === 0) {
        setStatus({ type: 'error', message: 'No valid new links were imported.' });
      } else {
        const parts = [`Imported ${pluralize(summary.imported, 'link')}`];
        if (summary.renamed) parts.push(`${summary.renamed} alias renamed`);
        if (summary.skipped) parts.push(`${summary.skipped} skipped`);
        setStatus({ type: 'success', message: `${parts.join(' • ')}.` });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Import failed. Check the file format and try again.' });
    } finally {
      event.target.value = '';
    }
  };

  const handleUpdateLink = (updates) => {
    const result = updateLink(editId, updates);
    if (!result.error) {
      setStatus({ type: 'success', message: 'Link updated successfully.' });
    }
    return result;
  };

  return (
    <div className="app">
      <div className="hero-card">
        <div className="hero-main">
          <div className="eyebrow">Local link workspace</div>
          <div className="hero-title-row">
            <div className="logo">snip.</div>
            <div className="hero-chip">offline first</div>
          </div>
          <p className="tagline">
            Shorten, edit, track, import, and export links without leaving the browser.
          </p>
        </div>

        <div className="hero-panel">
          <div className="panel-label">Workspace status</div>
          <div className="panel-metric">{pluralize(links.length, 'link')}</div>
          <div className="panel-copy">
            {topLink ? `Top alias: ${BASE}${topLink.code}` : 'Ready for your first short link.'}
          </div>
        </div>
      </div>

      <div className="input-card">
        <div className="card-head">
          <div>
            <div className="card-title">Create a short link</div>
            <div className="card-copy">Paste a destination, choose an alias if you want, and keep expiry optional.</div>
          </div>
          <div className="card-actions">
            <button className="utility-btn" onClick={() => fileInputRef.current?.click()}>Import</button>
            <button className="utility-btn" onClick={() => handleExport('json')}>Export JSON</button>
            <button className="utility-btn" onClick={() => handleExport('csv')}>Export CSV</button>
          </div>
        </div>

        <div className="input-row">
          <input
            ref={inputRef}
            className="url-input"
            type="text"
            placeholder="Paste a long URL to shorten..."
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => event.key === 'Enter' && handleShorten()}
            spellCheck="false"
          />
          <button className="shorten-btn" onClick={handleShorten} disabled={!url.trim()}>
            Shorten
          </button>
        </div>

        <div className="options-row">
          <div className="opt-group">
            <span className="opt-label">Alias</span>
            <input
              className="opt-input"
              style={{ width: 160 }}
              type="text"
              placeholder="custom-slug"
              value={alias}
              onChange={(event) => {
                setAlias(sanitizeCode(event.target.value));
                setError('');
              }}
              onKeyDown={(event) => event.key === 'Enter' && handleShorten()}
              spellCheck="false"
            />
          </div>

          <div className="opt-group">
            <span className="opt-label">Expiry</span>
            <input
              className="opt-input"
              style={{ width: 170 }}
              type="date"
              min={minDate}
              value={expiry}
              onChange={(event) => {
                setExpiry(event.target.value);
                setError('');
              }}
            />
          </div>

          {expiry && (
            <button className="clear-btn" onClick={() => setExpiry('')}>
              Clear expiry
            </button>
          )}
        </div>

        {error && <div className="notice-banner error">{error}</div>}
        {status && <div className={`notice-banner ${status.type}`}>{status.message}</div>}

        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept=".json,.csv"
          onChange={handleImport}
        />
      </div>

      {links.length > 0 && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Total links</div>
              <div className="stat-value">{links.length}</div>
              <div className="stat-copy">Saved in this browser</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Active now</div>
              <div className="stat-value">{activeLinks}</div>
              <div className="stat-copy">{expiringSoonCount} expiring soon</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Total clicks</div>
              <div className="stat-value">{totalClicks}</div>
              <div className="stat-copy">{topLink ? `Top link has ${topLink.clicks}` : 'No clicks yet'}</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Best alias</div>
              <div className="stat-value small">{topLink ? topLink.code : 'none yet'}</div>
              <div className="stat-copy">{topLink ? topLink.originalUrl : 'Create your first link to start.'}</div>
            </div>
          </div>

          <div className="toolbar">
            <input
              className="search-input"
              type="text"
              placeholder="Search links, aliases, or destinations..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              spellCheck="false"
            />
            <div className="toolbar-note">Click a short URL to preview before opening it.</div>
          </div>
        </>
      )}

      {links.length > 0 && <div className="section-label">Your links</div>}

      <div className="link-list">
        {filteredLinks.length === 0 && links.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">snip</div>
            <p>Create your first short link or import an existing file.</p>
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="empty">
            <p>No links match your search.</p>
          </div>
        ) : (
          filteredLinks.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              onDelete={deleteLink}
              onEdit={setEditId}
              onVisit={setRedirectId}
              onQR={setQrId}
              onAnalytics={setStatsId}
            />
          ))
        )}
      </div>

      {redirectLink && (
        <RedirectModal
          link={redirectLink}
          onConfirm={() => {
            recordClick(redirectLink.id);
            window.open(redirectLink.originalUrl, '_blank', 'noopener,noreferrer');
            setRedirectId(null);
          }}
          onCancel={() => setRedirectId(null)}
        />
      )}

      {qrLink && <QRModal link={qrLink} onClose={() => setQrId(null)} />}
      {statsLink && <AnalyticsModal link={statsLink} onClose={() => setStatsId(null)} />}
      {editLink && (
        <EditModal
          link={editLink}
          minDate={minDate}
          onSave={handleUpdateLink}
          onClose={() => setEditId(null)}
        />
      )}

      <footer className="footer">
        <span>snip.</span> keeps everything in localStorage, so importing and exporting is the easiest way to move data between browsers.
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
