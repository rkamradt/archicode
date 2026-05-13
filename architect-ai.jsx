import { useState, useRef, useEffect } from "react";
import { useAuth0 } from '@auth0/auth0-react';

// ── Color tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:         '#07101f',
  surface:    '#0d1928',
  card:       '#111f35',
  border:     '#1b3252',
  accent:     '#2563eb',
  accentBr:   '#3b82f6',
  accentGlow: '#60a5fa',
  amber:      '#f59e0b',
  green:      '#10b981',
  red:        '#ef4444',
  purple:     '#a78bfa',
  text:       '#e2e8f0',
  muted:      '#64748b',
  dim:        '#2d4a6a',
};

const TECH_COLORS = {
  spring: '#6db33f', java: '#6db33f',
  node: '#68a063', express: '#68a063',
  python: '#3572a5', django: '#3572a5', fastapi: '#3572a5',
  go: '#00acd7', golang: '#00acd7',
  rust: '#dea584',
  kafka: '#e3932a',
  react: '#61dafb', typescript: '#3178c6',
  redis: '#ff4438', postgres: '#336791', mysql: '#4479a1',
  grpc: '#00bcd4',
};

function techColor(tech = '') {
  const lo = tech.toLowerCase();
  for (const [k, v] of Object.entries(TECH_COLORS)) if (lo.includes(k)) return v;
  return C.accentBr;
}

// ── Archetype helpers ─────────────────────────────────────────────────────────
const ARCHETYPE_COLORS = {
  http:      C.accentBr,
  messaging: C.amber,
  provider:  C.green,
  adaptor:   C.purple,
};

function archetypeLabel(archetype) {
  return { http: 'HTTP', messaging: 'MSG', provider: 'PRVD', adaptor: 'ADPT' }[archetype] || 'HTTP';
}

function applyArchetypeSuffix(id, name, archetype) {
  if (archetype === 'provider') {
    const newId   = id.endsWith('-provider')   ? id   : id.replace(/-provider$|-adaptor$/, '') + '-provider';
    const newName = name.endsWith('Provider')  ? name : name.replace(/Provider$|Adaptor$/, '') + 'Provider';
    return { id: newId, name: newName };
  }
  if (archetype === 'adaptor') {
    const newId   = id.endsWith('-adaptor')    ? id   : id.replace(/-provider$|-adaptor$/, '') + '-adaptor';
    const newName = name.endsWith('Adaptor')   ? name : name.replace(/Provider$|Adaptor$/, '') + 'Adaptor';
    return { id: newId, name: newName };
  }
  return { id, name };
}

// ── System prompt, update parsing, and strip logic live in server.js ──────────

// ── Topology SVG ──────────────────────────────────────────────────────────────
function Topology({ services, onSelect }) {
  if (!services.length) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: C.dim, fontFamily: 'IBM Plex Mono, monospace' }}>
        <div style={{ fontSize: '48px', opacity: 0.2 }}>◈</div>
        <div style={{ fontSize: '12px' }}>No services yet — architect in the chat</div>
      </div>
    );
  }

  const W = 720, H = 500;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.33;
  const NODE_R = 32;

  const positions = services.map((s, i) => {
    const angle = (2 * Math.PI * i / services.length) - Math.PI / 2;
    return { id: s.id, x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
  });
  const posMap = Object.fromEntries(positions.map(p => [p.id, p]));

  const edges = [];
  services.forEach(s => {
    (s.dependencies || []).forEach(dep => {
      const from = posMap[s.id], to = posMap[dep];
      if (from && to) edges.push({ from, to, key: `${s.id}→${dep}` });
    });
  });

  function edgePath({ from, to }) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / d, ny = dy / d;
    const x1 = from.x + nx * NODE_R, y1 = from.y + ny * NODE_R;
    const x2 = to.x - nx * (NODE_R + 10), y2 = to.y - ny * (NODE_R + 10);
    const mx = (x1 + x2) / 2 - ny * 25, my = (y1 + y2) / 2 + nx * 25;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  }

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <marker id="tip" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={C.accentBr} opacity="0.75" />
        </marker>
      </defs>

      {/* Blueprint grid */}
      {Array.from({ length: 22 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 24} x2={W} y2={i * 24}
          stroke={C.border} strokeWidth="0.3" opacity="0.35" />
      ))}
      {Array.from({ length: 32 }, (_, i) => (
        <line key={`v${i}`} x1={i * 24} y1="0" x2={i * 24} y2={H}
          stroke={C.border} strokeWidth="0.3" opacity="0.35" />
      ))}

      {/* Edges */}
      {edges.map(e => (
        <path key={e.key} d={edgePath(e)} fill="none"
          stroke={C.accentBr} strokeWidth="1.2" opacity="0.45"
          strokeDasharray="5 3" markerEnd="url(#tip)" />
      ))}

      {/* Nodes */}
      {services.map(s => {
        const p = posMap[s.id];
        if (!p) return null;
        const col = techColor(s.tech);
        const label = s.name.length > 12 ? s.name.slice(0, 11) + '…' : s.name;
        const techLabel = (s.tech || '').split(' ')[0].slice(0, 10);
        return (
          <g key={s.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(s)}>
            <circle cx={p.x} cy={p.y} r={NODE_R + 6} fill="none" stroke={col} strokeWidth="0.5" opacity="0.15" />
            <circle cx={p.x} cy={p.y} r={NODE_R} fill={C.card} stroke={col} strokeWidth="1.5" />
            <text x={p.x} y={p.y - 3} textAnchor="middle" dominantBaseline="central"
              fill={C.text} fontSize="10" fontWeight="600"
              style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
              {label}
            </text>
            {techLabel && (
              <text x={p.x} y={p.y + 12} textAnchor="middle" dominantBaseline="central"
                fill={col} fontSize="8" opacity="0.85"
                style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
                {techLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Service detail panel ──────────────────────────────────────────────────────
function DetailPanel({ service, onClose, onUpdate }) {
  const [editArch, setEditArch]         = useState(service.archetype || 'http');
  const [editForeignApi, setEditForeignApi] = useState(
    service.foreignApi || { name: '', baseUrl: '', authMethod: 'apiKey', generateMock: false }
  );
  const [editAccepts, setEditAccepts]   = useState(
    service.accepts || { protocol: '', format: '', foreignEntity: '', generateMock: false, mockBehavior: '' }
  );
  const [editing, setEditing]           = useState(false);

  if (!service) return null;
  const col = techColor(service.tech);
  const arch = service.archetype || 'http';
  const archCol = ARCHETYPE_COLORS[arch] || C.accentBr;

  const Block = ({ label, children }) => (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ color: C.dim, fontSize: '10px', fontWeight: '700', letterSpacing: '0.15em', fontFamily: 'IBM Plex Mono', marginBottom: '8px' }}>
        {label}
      </div>
      {children}
    </div>
  );

  function applyEdit() {
    const { id: newId, name: newName } = applyArchetypeSuffix(service.id, service.name, editArch);
    const updated = {
      ...service,
      id: newId,
      name: newName,
      archetype: editArch,
      ...(editArch === 'provider' ? { foreignApi: editForeignApi, accepts: undefined } : {}),
      ...(editArch === 'adaptor'  ? { accepts: editAccepts, foreignApi: undefined }    : {}),
      ...(editArch === 'http' || editArch === 'messaging' ? { foreignApi: undefined, accepts: undefined } : {}),
    };
    onUpdate(updated);
    setEditing(false);
  }

  const fieldStyle = {
    width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: '4px',
    color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '11px', padding: '4px 8px', outline: 'none',
  };
  const labelStyle = {
    color: C.dim, fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em',
    fontFamily: 'IBM Plex Mono', display: 'block', marginBottom: '3px',
  };

  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: '310px',
      background: C.surface, borderLeft: `1px solid ${C.border}`,
      overflow: 'auto', zIndex: 20,
    }}>
      <div style={{ padding: '18px 18px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ color: col, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.14em' }}>
                {service.tech || 'SERVICE'}
              </span>
              <span style={{
                background: archCol + '22', border: `1px solid ${archCol}55`,
                borderRadius: '3px', padding: '1px 5px',
                color: archCol, fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: '700', letterSpacing: '0.1em',
              }}>
                {archetypeLabel(arch)}
              </span>
            </div>
            <div style={{ color: C.text, fontSize: '17px', fontWeight: '700' }}>{service.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>

        <p style={{ color: C.muted, fontSize: '13px', lineHeight: '1.65', marginBottom: '18px', paddingBottom: '16px', borderBottom: `1px solid ${C.border}` }}>
          {service.purpose}
        </p>

        {/* Foreign API (provider) */}
        {arch === 'provider' && service.foreignApi && (
          <Block label="FOREIGN API">
            {[
              ['Name',        service.foreignApi.name],
              ['Base URL',    service.foreignApi.baseUrl],
              ['Auth',        service.foreignApi.authMethod],
              ['Generate mock', service.foreignApi.generateMock ? 'yes' : 'no'],
            ].map(([k, v]) => v && (
              <div key={k} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', minWidth: '80px' }}>{k}</span>
                <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>{v}</span>
              </div>
            ))}
          </Block>
        )}

        {/* Accepts (adaptor) */}
        {arch === 'adaptor' && service.accepts && (
          <Block label="ACCEPTS">
            {[
              ['Protocol',      service.accepts.protocol],
              ['Format',        service.accepts.format],
              ['Foreign entity',service.accepts.foreignEntity],
              ['Generate mock', service.accepts.generateMock ? 'yes' : 'no'],
              ['Mock behavior', service.accepts.mockBehavior],
            ].map(([k, v]) => v && (
              <div key={k} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', minWidth: '80px' }}>{k}</span>
                <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>{v}</span>
              </div>
            ))}
          </Block>
        )}

        {/* APIs */}
        {service.apis?.length > 0 && (
          <Block label="API SURFACE">
            {service.apis.map((a, i) => (
              <div key={i} style={{ background: C.card, borderRadius: '5px', padding: '8px 10px', marginBottom: '5px', display: 'flex', gap: '8px' }}>
                <span style={{ color: C.amber, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', minWidth: '44px', paddingTop: '1px' }}>{a.method}</span>
                <div>
                  <div style={{ color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '11px', marginBottom: '2px' }}>{a.path}</div>
                  <div style={{ color: C.muted, fontSize: '11px' }}>{a.description}</div>
                </div>
              </div>
            ))}
          </Block>
        )}

        {/* Events */}
        {service.events?.length > 0 && (
          <Block label="EVENT STREAMS">
            {service.events.map((e, i) => (
              <div key={i} style={{ background: C.card, borderRadius: '5px', padding: '8px 10px', marginBottom: '5px' }}>
                <span style={{ color: e.direction === 'produces' ? C.green : C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700' }}>
                  {e.direction === 'produces' ? '▶ PRODUCES' : '◀ CONSUMES'}
                </span>
                <div style={{ color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '11px', marginTop: '4px' }}>{e.topic}</div>
                <div style={{ color: C.muted, fontSize: '11px', marginTop: '2px' }}>{e.description}</div>
              </div>
            ))}
          </Block>
        )}

        {/* Dependencies */}
        {service.dependencies?.length > 0 && (
          <Block label="DEPENDS ON">
            {service.dependencies.map((dep, i) => (
              <div key={i} style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '6px 0', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: '6px' }}>
                <span style={{ color: C.accentBr }}>→</span> {dep}
              </div>
            ))}
          </Block>
        )}

        {/* Archetype edit section */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '14px', marginTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ color: C.dim, fontSize: '10px', fontWeight: '700', letterSpacing: '0.15em', fontFamily: 'IBM Plex Mono' }}>ARCHETYPE</span>
            {!editing && (
              <button onClick={() => setEditing(true)}
                style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '3px', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '10px', padding: '2px 8px' }}>
                edit
              </button>
            )}
          </div>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={labelStyle}>ARCHETYPE</label>
                <select value={editArch} onChange={e => setEditArch(e.target.value)}
                  style={{ ...fieldStyle, cursor: 'pointer' }}>
                  <option value="http">http — REST/gRPC service</option>
                  <option value="messaging">messaging — event-driven</option>
                  <option value="provider">provider — wraps external API</option>
                  <option value="adaptor">adaptor — bridges foreign protocol</option>
                </select>
                {(editArch === 'provider' || editArch === 'adaptor') && (
                  <div style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', marginTop: '4px' }}>
                    id/name will get -{editArch} / {editArch === 'provider' ? 'Provider' : 'Adaptor'} suffix
                  </div>
                )}
              </div>

              {editArch === 'provider' && (
                <>
                  {[
                    { key: 'name',      label: 'API NAME',    placeholder: 'Stripe' },
                    { key: 'baseUrl',   label: 'BASE URL',    placeholder: 'https://api.stripe.com' },
                    { key: 'authMethod',label: 'AUTH METHOD', placeholder: 'apiKey | oauth2 | basic' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={labelStyle}>{f.label}</label>
                      <input value={editForeignApi[f.key] || ''} placeholder={f.placeholder}
                        onChange={e => setEditForeignApi(prev => ({ ...prev, [f.key]: e.target.value }))}
                        style={fieldStyle} />
                    </div>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!editForeignApi.generateMock}
                      onChange={e => setEditForeignApi(prev => ({ ...prev, generateMock: e.target.checked }))} />
                    <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>Generate mock</span>
                  </label>
                </>
              )}

              {editArch === 'adaptor' && (
                <>
                  {[
                    { key: 'protocol',      label: 'PROTOCOL',       placeholder: 'SFTP | AMQP | FTP | SOAP' },
                    { key: 'format',        label: 'FORMAT',          placeholder: 'CSV | XML | EDI | FixedWidth' },
                    { key: 'foreignEntity', label: 'FOREIGN ENTITY',  placeholder: 'OrderExport' },
                    { key: 'mockBehavior',  label: 'MOCK BEHAVIOR',   placeholder: 'Emit one event per row' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={labelStyle}>{f.label}</label>
                      <input value={editAccepts[f.key] || ''} placeholder={f.placeholder}
                        onChange={e => setEditAccepts(prev => ({ ...prev, [f.key]: e.target.value }))}
                        style={fieldStyle} />
                    </div>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!editAccepts.generateMock}
                      onChange={e => setEditAccepts(prev => ({ ...prev, generateMock: e.target.checked }))} />
                    <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>Generate mock</span>
                  </label>
                </>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={applyEdit}
                  style={{ flex: 1, background: C.accentBr, border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '6px 0' }}>
                  APPLY
                </button>
                <button onClick={() => { setEditing(false); setEditArch(service.archetype || 'http'); setEditForeignApi(service.foreignApi || { name: '', baseUrl: '', authMethod: 'apiKey', generateMock: false }); setEditAccepts(service.accepts || { protocol: '', format: '', foreignEntity: '', generateMock: false, mockBehavior: '' }); }}
                  style={{ flex: 1, background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', padding: '6px 0' }}>
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>
              <span style={{ color: archCol }}>{arch}</span>
              {arch === 'provider' && service.foreignApi?.name && ` — ${service.foreignApi.name}`}
              {arch === 'adaptor' && service.accepts?.protocol && ` — ${service.accepts.protocol}/${service.accepts.format}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Artifacts panel ───────────────────────────────────────────────────────────
// Shows the services designed so far. All generated files (spec.md, CLAUDE.md,
// ecosystem.json, per-service CLAUDE.md) are built server-side on ↑ push.
function ExportPanel({ services, projectName }) {
  if (!services.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '12px' }}>
        <div style={{ fontSize: '36px', opacity: 0.2 }}>⬡</div>
        <div>No services yet — architect in the chat</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', background: C.card, borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>
          {projectName} — {services.length} service{services.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Service list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {services.map(s => (
          <div key={s.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: ARCHETYPE_COLORS[s.archetype] || C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>
                {archetypeLabel(s.archetype)}
              </span>
              <span style={{ color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '13px', fontWeight: '700' }}>{s.name}</span>
              <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px' }}>{s.id}</span>
              {s.tech && <span style={{ color: techColor(s.tech), fontFamily: 'IBM Plex Mono', fontSize: '10px', marginLeft: 'auto' }}>{s.tech}</span>}
            </div>
            <div style={{ color: C.muted, fontFamily: 'IBM Plex Sans, sans-serif', fontSize: '12px', lineHeight: '1.5' }}>{s.purpose}</div>
            {(s.apis?.length > 0 || s.events?.length > 0) && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                {s.apis?.map((a, i) => (
                  <span key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '3px', padding: '1px 6px', fontFamily: 'IBM Plex Mono', fontSize: '10px', color: C.accentGlow }}>
                    {a.method} {a.path}
                  </span>
                ))}
                {s.events?.map((e, i) => (
                  <span key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '3px', padding: '1px 6px', fontFamily: 'IBM Plex Mono', fontSize: '10px', color: e.direction === 'produces' ? C.green : C.amber }}>
                    {e.direction === 'produces' ? '▶' : '◀'} {e.topic}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Generated artifacts footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '14px 16px', background: C.surface, flexShrink: 0 }}>
        <div style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.14em', marginBottom: '10px' }}>GENERATED ON ↑ PUSH</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            ['spec.md',        'Human-readable living specification'],
            ['CLAUDE.md',      'Ecosystem context file for Claude Code'],
            ['ecosystem.json', 'Machine-readable service registry'],
            ['<id>/CLAUDE.md', 'Per-service context file for Claude Code'],
          ].map(([name, desc]) => (
            <div key={name} style={{ display: 'flex', gap: '7px', alignItems: 'center', background: C.card, borderRadius: '5px', padding: '5px 10px', flex: '1 1 45%', minWidth: '180px' }}>
              <span style={{ color: C.accentBr, fontFamily: 'IBM Plex Mono', fontWeight: '700', fontSize: '11px', minWidth: '100px', flexShrink: 0 }}>{name}</span>
              <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function ArchitectAI() {
  const { isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0();

  const api = async (path, method = 'GET', body = null) => {
    const token = await getAccessTokenSilently();
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.json();
  };

  // ── User profile / API key ────────────────────────────────────────────────
  const [profileChecked, setProfileChecked] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');

  // GitHub user-level credentials (stored server-side)
  const [ghHasToken, setGhHasToken] = useState(false);
  const [ghOwner, setGhOwner]       = useState('');

  const [anthropicModel, setAnthropicModel] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    api('/api/user/profile').then(data => {
      setHasApiKey(!!data.hasApiKey);
      setGhHasToken(!!data.hasGithubToken);
      setGhOwner(data.githubOwner || '');
      if (data.anthropicModel) setAnthropicModel(data.anthropicModel);
      setProfileChecked(true);
    }).catch(() => setProfileChecked(true));
  }, [isAuthenticated]);

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return;
    setApiKeySaving(true);
    setApiKeyError('');
    try {
      const result = await api('/api/user/profile', 'PUT', { anthropicApiKey: apiKeyInput.trim() });
      if (result.error) throw new Error(result.error);
      setHasApiKey(true);
      setApiKeyInput('');
      setShowKeyPanel(false);
    } catch (e) {
      setApiKeyError(e.message);
    }
    setApiKeySaving(false);
  }

  const [services, setServices] = useState([]);
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: "Welcome to **ArchitectAI**.\n\nI help you design and evolve ecosystems of services — decomposing domains, defining service boundaries and APIs, mapping event contracts, and reasoning about how things should communicate.\n\nDescribe what you're building: a new system from scratch, an existing ecosystem you want to expand, or a specific architectural problem. What's the domain?",
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('chat');
  const [selected, setSelected] = useState(null);
  const [projectName, setProjectName] = useState('New Ecosystem');
  const [editingName, setEditingName] = useState(false);
  const chatEndRef = useRef(null);
  const nameRef = useRef(null);

  useEffect(() => {
    if (view === 'chat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, view]);

  useEffect(() => {
    if (editingName) { nameRef.current?.focus(); nameRef.current?.select(); }
  }, [editingName]);

  // ── Ecosystem scratch-pad (server-side) ──────────────────────────────────────
  // Loaded from the API on login; saved back on every change (debounced).
  // GitHub push/pull also update the scratch-pad on the server.
  const [hydrated, setHydrated] = useState(false);
  const [repoName, setRepoName] = useState('');
  const saveEcosystemTimer = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !profileChecked || !hasApiKey) return;
    api('/api/ecosystem').then(data => {
      if (data.services?.length) setServices(data.services);
      if (data.projectName)      setProjectName(data.projectName);
      if (data.repoName)         setRepoName(data.repoName);
      if (data.services?.length) {
        setMessages([{ role: 'assistant', content:
          `Welcome back to **ArchitectAI**.\n\n**${data.projectName || 'Your ecosystem'}** has ${data.services.length} service${data.services.length === 1 ? '' : 's'} defined.\n\nNext steps:\n- **▶ implement** — scaffold all services and push code to GitHub\n- **↑ push** — commit the spec, CLAUDE.md, and ecosystem.json to your repo\n- Ask me to add or refine services, adjust APIs, or rethink boundaries`,
        }]);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
  }, [isAuthenticated, profileChecked, hasApiKey]);

  // Debounced save to server whenever ecosystem state changes
  useEffect(() => {
    if (!hydrated) return;
    clearTimeout(saveEcosystemTimer.current);
    saveEcosystemTimer.current = setTimeout(() => {
      api('/api/ecosystem', 'PUT', { projectName, services, repoName }).catch(() => {});
    }, 800);
  }, [services, projectName, repoName, hydrated]);

  // ── GitHub integration ────────────────────────────────────────────────────────
  // Token + owner are user-level (server-side). Repo is ecosystem-level (server-side).
  // ⎔ panel inputs (local form state, not auto-saved)
  const [ghTokenInput, setGhTokenInput] = useState('');
  const [ghOwnerInput, setGhOwnerInput] = useState('');
  const [ghRepoInput,  setGhRepoInput]  = useState('');
  const [ghSaving,     setGhSaving]     = useState(false);
  const [ghStatus, setGhStatus] = useState(null); // null | 'pulling' | 'pushing' | 'ok' | 'error'
  const [ghMsg, setGhMsg]       = useState('');
  const [showGhPanel, setShowGhPanel] = useState(false);

  // Sync panel inputs when profile or repoName loads
  useEffect(() => { setGhOwnerInput(ghOwner); }, [ghOwner]);
  useEffect(() => { setGhRepoInput(repoName); }, [repoName]);

  // ── Implement ─────────────────────────────────────────────────────────────────
  const [implRunning, setImplRunning] = useState(false);
  const [implLog, setImplLog] = useState([]);
  const [showImplPanel, setShowImplPanel] = useState(false);
  const implLogEndRef = useRef(null);
  const implJobIdRef  = useRef(null); // current background job ID for cancellation
  const [implConfirm, setImplConfirm] = useState(null); // { repoName } | null

  // ── Build status tracking ─────────────────────────────────────────────────────
  // Keyed by service ID. Status: 'designing'|'implementing'|'building'|'built'|'build_failed'
  const [svcStatuses, setSvcStatuses] = useState({});
  const buildPollRef = useRef(null);

  const STATUS_META = {
    designing:    { color: C.muted,   symbol: '○', label: null },
    implementing: { color: C.amber,   symbol: '◎', label: 'IMPL' },
    building:     { color: C.accentBr,symbol: '◎', label: 'BUILD' },
    built:        { color: C.green,   symbol: '✓', label: 'BUILT' },
    build_failed: { color: C.red,     symbol: '✗', label: 'FAILED' },
  };

  useEffect(() => {
    if (showImplPanel) implLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [implLog, showImplPanel]);

  // Auto-start build polling when the app loads with an existing repo
  // Must be declared before early returns to satisfy Rules of Hooks
  useEffect(() => {
    if (!hydrated || !repoName || !services.length || implRunning) return;
    startBuildPolling(repoName, { immediate: true });
    return () => { if (buildPollRef.current) clearInterval(buildPollRef.current); };
  }, [hydrated, repoName]);

  if (isLoading) return (
    <div style={{ color: '#64748b', padding: '40px', fontFamily: 'IBM Plex Mono' }}>Loading…</div>
  );
  if (!isAuthenticated) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#07101f', gap: '16px' }}>
      <div style={{ color: '#3b82f6', fontFamily: 'IBM Plex Mono', fontSize: '24px', fontWeight: 700 }}>◈ ARCHITECTAI</div>
      <button onClick={() => loginWithRedirect()} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 28px', fontFamily: 'IBM Plex Mono', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
        SIGN IN
      </button>
    </div>
  );
  if (!profileChecked) return (
    <div style={{ color: '#64748b', padding: '40px', fontFamily: 'IBM Plex Mono' }}>Loading…</div>
  );
  if (!hasApiKey) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, gap: '20px' }}>
      <div style={{ color: C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '24px', fontWeight: 700 }}>◈ ARCHITECTAI</div>
      <div style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '13px', textAlign: 'center', maxWidth: '360px', lineHeight: '1.6' }}>
        To get started, enter your Anthropic API key.<br />
        It will be stored securely and used only for your account.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '320px' }}>
        <input
          type="password"
          placeholder="sk-ant-…"
          value={apiKeyInput}
          onChange={e => setApiKeyInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveApiKey()}
          style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '13px', padding: '10px 14px', outline: 'none' }}
        />
        {apiKeyError && <div style={{ color: C.red, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>{apiKeyError}</div>}
        <button onClick={saveApiKey} disabled={apiKeySaving || !apiKeyInput.trim()}
          style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontFamily: 'IBM Plex Mono', fontSize: '13px', fontWeight: 700, cursor: apiKeySaving ? 'not-allowed' : 'pointer', opacity: apiKeyInput.trim() ? 1 : 0.5 }}>
          {apiKeySaving ? 'SAVING…' : 'SAVE & CONTINUE'}
        </button>
        <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
          style={{ background: 'none', border: 'none', color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px', cursor: 'pointer', padding: '4px' }}>
          sign out
        </button>
      </div>
    </div>
  );

  async function saveGhCredentials() {
    setGhSaving(true);
    try {
      const result = await api('/api/user/github', 'PUT', { githubToken: ghTokenInput, githubOwner: ghOwnerInput });
      if (result.error) throw new Error(result.error);
      if (ghOwnerInput) setGhOwner(ghOwnerInput);
      if (ghTokenInput && ghTokenInput !== '••••••••') setGhHasToken(true);
      setGhTokenInput('');
      setGhMsg('GitHub credentials saved.');
      setGhStatus('ok');
    } catch (e) {
      setGhStatus('error'); setGhMsg(e.message);
    }
    setGhSaving(false);
  }

  async function ghPull(targetRepo) {
    const repo = targetRepo || repoName;
    if (!repo) { setGhStatus('error'); setGhMsg('Enter a repo name to load.'); return; }
    setGhStatus('pulling'); setGhMsg('');
    try {
      const data = await api('/api/github/pull', 'POST', { repoName: repo });
      if (data.error) throw new Error(data.error);
      setServices(data.services || []);
      if (data.projectName) setProjectName(data.projectName);
      setRepoName(repo);
      setGhStatus('ok'); setGhMsg(`Loaded ${data.services?.length ?? 0} services from ${repo}`);
    } catch (e) {
      setGhStatus('error'); setGhMsg(e.message);
    }
  }

  async function ghPush() {
    setGhStatus('pushing'); setGhMsg('');
    try {
      const data = await api('/api/github/push', 'POST');
      if (data.error) throw new Error(data.error);
      setGhStatus('ok');
      setGhMsg(`Pushed ${data.results?.length ?? 0} files to ${ghOwner}/${data.repoName || repoName}`);
    } catch (e) {
      setGhStatus('error'); setGhMsg(e.message);
    }
  }

  const ghConnected = ghHasToken && !!ghOwner && !!repoName;

  function toRepoName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-services';
  }

  async function implement() {
    if (!services.length || implRunning) return;
    if (!ghHasToken || !ghOwner) {
      setImplLog([{ type: 'error', message: 'GitHub not configured — open ⎔ and save your token and owner.' }]);
      setShowImplPanel(true);
      setShowGhPanel(true);
      return;
    }
    const implRepoName = toRepoName(projectName);

    // Check whether the repo already exists before starting
    const createRes = await api('/api/github/create-repo', 'POST', {
      repoName: implRepoName,
      description: `${projectName} — generated by ArchitectAI`,
      private: false,
    });

    if (createRes.error && createRes.error.includes('already exists')) {
      setImplConfirm({ repoName: implRepoName });
      return;
    }
    if (createRes.error) {
      setImplLog(prev => [...prev, { type: 'error', message: createRes.error }]);
      setShowImplPanel(true);
      return;
    }

    setRepoName(implRepoName);
    // Persist the new repoName to the server scratch-pad before the agent reads it
    await api('/api/ecosystem', 'PUT', { projectName, services, repoName: implRepoName }).catch(() => {});
    setImplLog([{ type: 'start', message: `Repo created: ${createRes.repoUrl}` }]);
    await runImplStream();
  }

  async function runImplStream() {
    setImplRunning(true);
    setShowImplPanel(true);

    // Mark all non-mock services as 'implementing'
    setSvcStatuses(prev => {
      const next = { ...prev };
      services.forEach(s => { next[s.id] = 'implementing'; });
      return next;
    });

    let succeeded = false;
    try {
      const startRes = await api('/api/implement/start', 'POST');
      if (startRes.error) throw new Error(startRes.error);
      const { jobId } = startRes;
      implJobIdRef.current = jobId;

      let since = 0;
      while (true) {
        await new Promise(r => setTimeout(r, 10000));
        const poll = await api(`/api/implement/${jobId}/poll?since=${since}`);
        if (poll.error) throw new Error(poll.error);
        if (poll.events.length > 0) {
          setImplLog(prev => [...prev, ...poll.events]);
          since += poll.events.length;
        }
        if (poll.status === 'done' || poll.status === 'error' || poll.status === 'cancelled') {
          succeeded = poll.status === 'done';
          break;
        }
      }
      implJobIdRef.current = null;
    } catch (e) {
      setImplLog(prev => [...prev, { type: 'error', message: e.message }]);
    }

    setImplRunning(false);

    if (succeeded) {
      // Transition all services to 'building' and start polling GitHub Actions
      setSvcStatuses(prev => {
        const next = { ...prev };
        services.forEach(s => { next[s.id] = 'building'; });
        return next;
      });
      startBuildPolling(repoName, { immediate: false });
    } else {
      setSvcStatuses(prev => {
        const next = { ...prev };
        services.forEach(s => { next[s.id] = 'designing'; });
        return next;
      });
    }
  }

  async function killImpl() {
    const jobId = implJobIdRef.current;
    if (!jobId) return;
    await api(`/api/implement/${jobId}/cancel`, 'POST');
    setImplLog(prev => [...prev, { type: 'info', message: 'Cancellation requested — stopping after current session' }]);
  }

  function startBuildPolling(repo, { immediate = false } = {}) {
    if (buildPollRef.current) clearInterval(buildPollRef.current);

    const poll = async () => {
      try {
        const data = await api(`/api/github/actions-status?repoName=${encodeURIComponent(repo)}`);
        if (data.error || !data.statuses) return;

        setSvcStatuses(prev => {
          const next = { ...prev };
          for (const [sid, info] of Object.entries(data.statuses)) {
            next[sid] = info.status;
          }
          return next;
        });

        const allResolved = services.every(s => {
          const st = data.statuses[s.id]?.status ?? svcStatuses[s.id];
          return st === 'built' || st === 'build_failed';
        });

        if (allResolved && services.length > 0) {
          clearInterval(buildPollRef.current);
          buildPollRef.current = null;

          const failed = services.filter(s => data.statuses[s.id]?.status === 'build_failed');
          const built  = services.filter(s => data.statuses[s.id]?.status === 'built');

          if (failed.length === 0) {
            setMessages(prev => [...prev, { role: 'assistant', content:
              `All ${built.length} service build${built.length === 1 ? '' : 's'} succeeded. The ecosystem is live.\n\nYou can now refine the spec, add services, or ask me about the architecture.`,
            }]);
          } else {
            const failList = failed.map(s => `- **${s.name}** — [view run](${data.statuses[s.id]?.url})`).join('\n');
            setMessages(prev => [...prev, { role: 'assistant', content:
              `${failed.length} build${failed.length === 1 ? '' : 's'} failed:\n\n${failList}\n\nDescribe what you'd like to fix and I can update the spec, or paste the error logs and I'll diagnose the issue.`,
            }]);
          }
          setView('chat');
        }
      } catch {}
    };

    if (immediate) poll();
    buildPollRef.current = setInterval(poll, 30000);
  }


  // Simple markdown renderer: fenced code blocks, **bold**, `code`, newlines
  function renderMd(text) {
    // Split on triple-backtick fenced blocks first
    return text.split(/(```[\s\S]*?```)/g).flatMap((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const inner = part.slice(3, -3).replace(/^[a-z]*\n/, ''); // strip language tag
        return [<pre key={i} style={{ fontFamily: 'IBM Plex Mono, monospace', background: C.bg, border: `1px solid ${C.border}`, borderRadius: '5px', padding: '10px 12px', fontSize: '11px', lineHeight: '1.6', color: C.accentGlow, overflowX: 'auto', margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{inner}</pre>];
      }
      // Inline: **bold** and `code`
      return part.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((p, j) => {
        if (p.startsWith('**') && p.endsWith('**'))
          return <strong key={`${i}-${j}`} style={{ color: C.text }}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`'))
          return <code key={`${i}-${j}`} style={{ fontFamily: 'IBM Plex Mono, monospace', background: C.bg, padding: '1px 5px', borderRadius: '3px', fontSize: '12px', color: C.accentGlow }}>{p.slice(1, -1)}</code>;
        return p.split('\n').flatMap((line, k, arr) =>
          k < arr.length - 1 ? [line, <br key={`${i}-${j}-${k}`} />] : [line]
        );
      });
    });
  }

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');

    const userMsg = { role: 'user', content: text };
    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setLoading(true);

    // Build API history: skip the initial assistant greeting, start from first user msg
    const apiHistory = [];
    let started = false;
    for (const m of allMsgs) {
      if (!started && m.role === 'user') started = true;
      if (started) apiHistory.push({ role: m.role, content: m.content });
    }

    try {
      const data = await api('/api/messages', 'POST', { messages: apiHistory });
      if (data.error) throw new Error(data.error.message || data.error);

      if (data.updates?.length) {
        setServices(prev => {
          let next = [...prev];
          for (const u of data.updates) {
            if (!u.service) continue;
            const idx = next.findIndex(s => s.id === u.service.id);
            if (u.action === 'remove') {
              next = next.filter(s => s.id !== u.service.id);
            } else {
              if (idx >= 0) next[idx] = u.service;
              else next.push(u.service);
            }
          }
          return next;
        });
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content || '',
        added: data.updates?.length ? data.updates.map(u => u.service?.name).filter(Boolean) : null,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    }
    setLoading(false);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function updateService(updated) {
    setServices(prev => {
      const idx = prev.findIndex(s => s.id === selected?.id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    setSelected(updated);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, color: C.text, fontFamily: "'IBM Plex Sans', sans-serif", overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${C.dim};border-radius:2px;}
        .svc:hover{background:${C.card} !important;}
        textarea:focus{border-color:${C.accentBr} !important;}
        textarea::placeholder{color:${C.dim};}
        @keyframes blink{0%,100%{opacity:.25}50%{opacity:1}}
        .dot{width:5px;height:5px;border-radius:50%;background:${C.accentBr};animation:blink 1.2s ease-in-out infinite;}
        .dot:nth-child(2){animation-delay:.2s}
        .dot:nth-child(3){animation-delay:.4s}
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '48px', padding: '0 16px', background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', border: `1.5px solid ${C.accentBr}`, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '14px', fontWeight: '700' }}>◈</div>
          <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: '700', fontSize: '13px', letterSpacing: '0.15em' }}>
            ARCHITECT<span style={{ color: C.accentBr }}>AI</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {editingName
            ? <input ref={nameRef} value={projectName} onChange={e => setProjectName(e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false); }}
                style={{ background: C.card, border: `1px solid ${C.accentBr}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '3px 9px', outline: 'none', minWidth: '150px' }} />
            : <span onClick={() => setEditingName(true)} title="Click to rename"
                style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '12px', cursor: 'pointer', padding: '3px 9px', borderRadius: '4px', border: `1px solid transparent` }}>
                {projectName}
              </span>
          }
          {/* GitHub pull/push */}
          {ghConnected && <>
            <button onClick={() => ghPull(repoName)} disabled={ghStatus === 'pulling' || ghStatus === 'pushing'}
              title={`Pull ecosystem.json from ${ghOwner}/${repoName}`}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: ghStatus === 'pulling' ? C.amber : C.accentBr, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 9px' }}>
              {ghStatus === 'pulling' ? '…' : '↓ pull'}
            </button>
            <button onClick={ghPush} disabled={ghStatus === 'pulling' || ghStatus === 'pushing' || !services.length}
              title={`Push ecosystem.json to ${ghOwner}/${repoName}`}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: ghStatus === 'pushing' ? C.amber : C.green, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 9px' }}>
              {ghStatus === 'pushing' ? '…' : '↑ push'}
            </button>
          </>}
          {/* Implement — shown whenever services exist; reports missing config on click */}
          {!!services.length && (
            <button onClick={implement} disabled={implRunning}
              title={ghConnected ? `Scaffold ${toRepoName(projectName)} and push to GitHub` : 'Configure GitHub (⎔) to use implement'}
              style={{ background: implRunning ? C.card : C.purple + '22', border: `1px solid ${implRunning ? C.border : C.purple + '88'}`, borderRadius: '4px', color: implRunning ? C.muted : C.purple, cursor: implRunning ? 'not-allowed' : 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 9px', fontWeight: '700' }}>
              {implRunning ? '⟳ building…' : '▶ implement'}
            </button>
          )}
          <button title="Anthropic API key" onClick={() => { setShowKeyPanel(p => !p); setApiKeyInput(''); setApiKeyError(''); }}
            style={{ background: showKeyPanel ? C.card : 'none', border: `1px solid ${showKeyPanel ? C.accentBr : C.border}`, borderRadius: '4px', color: C.accentBr, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px', lineHeight: 1 }}>
            ⚿
          </button>
          <button title="GitHub settings" onClick={() => setShowGhPanel(p => !p)}
            style={{ background: showGhPanel ? C.card : 'none', border: `1px solid ${showGhPanel ? C.accentBr : C.border}`, borderRadius: '4px', color: ghHasToken ? C.accentBr : C.dim, cursor: 'pointer', fontSize: '13px', fontFamily: 'IBM Plex Mono', padding: '2px 8px', lineHeight: 1 }}>
            ⎔
          </button>
          <button title="Reset ecosystem" onClick={() => {
            if (window.confirm('Clear all services and start over?')) {
              setServices([]); setSelected(null); setRepoName('');
            }
          }} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.dim, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px' }}>
            ↺
          </button>
          {repoName && !!services.length && !implRunning && (
            <button onClick={() => startBuildPolling(repoName, { immediate: true })}
              title={`Check build status for ${repoName}`}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.accentBr, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px' }}>
              ⟳ builds
            </button>
          )}
          <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.dim, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px' }}>
            sign out
          </button>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: loading ? C.amber : C.green, transition: 'background .3s' }} title={loading ? 'Thinking...' : 'Ready'} />
        </div>
      </div>

      {/* ── API key update panel ── */}
      {showKeyPanel && (
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '14px 16px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexShrink: 0 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>ANTHROPIC API KEY</span>
            <input type="password" value={apiKeyInput} placeholder="sk-ant-… (leave blank to keep existing)"
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey()}
              style={{ width: '300px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '5px 9px', outline: 'none' }} />
          </label>
          {apiKeyError && <span style={{ color: C.red, fontFamily: 'IBM Plex Mono', fontSize: '11px', alignSelf: 'center' }}>{apiKeyError}</span>}
          <button onClick={saveApiKey} disabled={apiKeySaving || !apiKeyInput.trim()}
            style={{ background: C.accentBr, border: 'none', borderRadius: '4px', color: '#fff', cursor: apiKeyInput.trim() ? 'pointer' : 'not-allowed', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '7px 16px', alignSelf: 'flex-end', opacity: apiKeyInput.trim() ? 1 : 0.45 }}>
            {apiKeySaving ? 'SAVING…' : 'UPDATE KEY'}
          </button>
        </div>
      )}

      {/* ── GitHub settings panel ── */}
      {showGhPanel && (
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
          {/* Row 1: user-level credentials */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: !ghHasToken ? C.amber : C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>
                PAT (TOKEN){!ghHasToken ? ' ⚠' : ' ✓'}
              </span>
              <input type="password" value={ghTokenInput} placeholder={ghHasToken ? '(stored — enter new to replace)' : 'ghp_…'}
                onChange={e => setGhTokenInput(e.target.value)}
                style={{ width: '220px', background: C.surface, border: `1px solid ${!ghHasToken ? C.amber + '88' : C.border}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '5px 9px', outline: 'none' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: !ghOwnerInput ? C.amber : C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>
                OWNER{!ghOwnerInput ? ' ⚠' : ''}
              </span>
              <input type="text" value={ghOwnerInput} placeholder="rkamradt"
                onChange={e => setGhOwnerInput(e.target.value)}
                style={{ width: '130px', background: C.surface, border: `1px solid ${!ghOwnerInput ? C.amber + '88' : C.border}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '5px 9px', outline: 'none' }} />
            </label>
            <button onClick={saveGhCredentials} disabled={ghSaving || (!ghTokenInput && !ghOwnerInput)}
              style={{ background: C.accentBr, border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '7px 16px', alignSelf: 'flex-end', opacity: (ghTokenInput || ghOwnerInput) ? 1 : 0.45 }}>
              {ghSaving ? 'SAVING…' : 'SAVE CREDENTIALS'}
            </button>
          </div>
          {/* Row 2: ecosystem repo */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>REPO</span>
              <input type="text" value={ghRepoInput} placeholder="my-project-services"
                onChange={e => setGhRepoInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && ghPull(ghRepoInput)}
                style={{ width: '200px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '5px 9px', outline: 'none' }} />
            </label>
            <button onClick={() => { ghPull(ghRepoInput); setShowGhPanel(false); }}
              disabled={!ghHasToken || !ghOwner || !ghRepoInput || ghStatus === 'pulling'}
              style={{ background: C.accentBr, border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '7px 16px', alignSelf: 'flex-end', opacity: (ghHasToken && ghOwner && ghRepoInput) ? 1 : 0.45 }}>
              {ghStatus === 'pulling' ? 'LOADING…' : 'LOAD ECOSYSTEM'}
            </button>
            <button onClick={() => {
              if (services.length && !window.confirm('Clear the current ecosystem and start fresh?')) return;
              setServices([]); setProjectName('New Ecosystem'); setRepoName(''); setGhRepoInput(''); setSelected(null);
              setMessages([{ role: 'assistant', content: "Welcome to **ArchitectAI**.\n\nDescribe what you're building and I'll help you design the services." }]);
              setShowGhPanel(false);
            }} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', padding: '7px 14px', alignSelf: 'flex-end' }}>
              NEW
            </button>
          </div>
          <div style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px' }}>
            ⚠ PAT requires scopes: <strong style={{ color: C.muted }}>repo</strong> + <strong style={{ color: C.muted }}>workflow</strong>
          </div>
        </div>
      )}

      {/* ── GitHub status bar ── */}
      {ghMsg && (
        <div style={{ background: ghStatus === 'error' ? C.red + '18' : C.green + '14', borderBottom: `1px solid ${ghStatus === 'error' ? C.red + '44' : C.green + '44'}`, padding: '5px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: ghStatus === 'error' ? C.red : C.green, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>{ghMsg}</span>
          <button onClick={() => setGhMsg('')} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '12px' }}>×</button>
        </div>
      )}

      {/* ── Implement progress panel ── */}
      {showImplPanel && (
        <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px', background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.14em' }}>
              IMPLEMENTATION LOG — {toRepoName(projectName)}
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {implRunning && (
                <button onClick={killImpl}
                  style={{ background: C.red + '18', border: `1px solid ${C.red + '55'}`, borderRadius: '4px', color: C.red, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', padding: '2px 10px', letterSpacing: '0.08em' }}>
                  ✕ KILL
                </button>
              )}
              <button onClick={() => setShowImplPanel(false)}
                style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '13px' }}>×</button>
            </div>
          </div>
          <div style={{ maxHeight: '220px', overflow: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {implLog.map((entry, i) => {
              if (entry.type === 'start') return (
                <div key={i} style={{ color: C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', paddingTop: i > 0 ? '6px' : 0 }}>
                  ◈ {entry.message}
                </div>
              );
              if (entry.type === 'mock') return (
                <div key={i} style={{ color: C.green, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', paddingTop: '6px' }}>
                  ⬡ {entry.message}
                </div>
              );
              if (entry.type === 'service') return (
                <div key={i} style={{ color: C.purple, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', paddingTop: '6px' }}>
                  ── {entry.message} ──
                </div>
              );
              if (entry.type === 'thinking') return (
                <div key={i} style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-flex', gap: '2px' }}>
                    <span className="dot" /><span className="dot" /><span className="dot" />
                  </span>
                  {entry.message}
                </div>
              );
              if (entry.type === 'file') return (
                <div key={i} style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '10px' }}>
                  <span style={{ color: C.green }}>✎</span> {entry.path || entry.message}
                </div>
              );
              if (entry.type === 'push') return (
                <div key={i} style={{ color: C.amber, fontFamily: 'IBM Plex Mono', fontSize: '10px' }}>
                  ↑ {entry.message}
                </div>
              );
              if (entry.type === 'done') return (
                <div key={i} style={{ paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ color: C.green, fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700' }}>
                    ✓ {entry.message}{' '}
                    {entry.repoUrl && (
                      <a href={entry.repoUrl} target="_blank" rel="noreferrer"
                        style={{ color: C.accentBr, textDecoration: 'underline', fontWeight: '400' }}>
                        {entry.repoUrl}
                      </a>
                    )}
                  </div>
                  {entry.errors?.map((e, j) => (
                    <div key={j} style={{ color: C.amber, fontFamily: 'IBM Plex Mono', fontSize: '10px', paddingLeft: '12px' }}>
                      ↑ failed: {e.path} — {e.error}
                    </div>
                  ))}
                </div>
              );
              if (entry.type === 'info') return (
                <div key={i} style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontStyle: 'italic' }}>
                  ℹ {entry.message}
                </div>
              );
              if (entry.type === 'error') return (
                <div key={i} style={{ color: C.red, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>
                  ✗ {entry.message}
                </div>
              );
              return null;
            })}
            {implRunning && implLog.length === 0 && (
              <div style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', gap: '2px' }}><span className="dot" /><span className="dot" /><span className="dot" /></span>
                Starting…
              </div>
            )}
            <div ref={implLogEndRef} />
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{ width: '218px', flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: C.surface }}>
          <div style={{ padding: '10px 14px 6px', color: C.dim, fontSize: '10px', fontWeight: '700', letterSpacing: '0.15em', fontFamily: 'IBM Plex Mono' }}>
            SERVICES{services.length ? ` · ${services.length}` : ''}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
            {!services.length
              ? <div style={{ padding: '10px 8px', color: C.dim, fontSize: '12px', lineHeight: '1.7', fontFamily: 'IBM Plex Mono' }}>Services appear<br />here as you build.</div>
              : services.map(s => {
                  const col = techColor(s.tech);
                  const isSel = selected?.id === s.id;
                  return (
                    <div key={s.id} className="svc"
                      onClick={() => setSelected(isSel ? null : s)}
                      style={{ padding: '8px 10px', marginBottom: '3px', borderRadius: '6px', cursor: 'pointer', background: isSel ? C.card : 'transparent', border: `1px solid ${isSel ? col + '55' : 'transparent'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: col, flexShrink: 0 }} />
                        <div style={{ color: C.text, fontSize: '12px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.name}</div>
                        {s.archetype && s.archetype !== 'http' && (
                          <span style={{
                            background: (ARCHETYPE_COLORS[s.archetype] || C.accentBr) + '22',
                            border: `1px solid ${(ARCHETYPE_COLORS[s.archetype] || C.accentBr)}44`,
                            borderRadius: '3px', padding: '0 4px',
                            color: ARCHETYPE_COLORS[s.archetype] || C.accentBr,
                            fontFamily: 'IBM Plex Mono', fontSize: '8px', fontWeight: '700', flexShrink: 0,
                          }}>
                            {archetypeLabel(s.archetype)}
                          </span>
                        )}
                        {(() => {
                          const st = svcStatuses[s.id];
                          const meta = STATUS_META[st];
                          if (!meta?.label) return null;
                          return (
                            <span style={{ color: meta.color, fontFamily: 'IBM Plex Mono', fontSize: '8px', fontWeight: '700', flexShrink: 0 }}>
                              {meta.symbol} {meta.label}
                            </span>
                          );
                        })()}
                      </div>
                      <div style={{ color: C.muted, fontSize: '11px', paddingLeft: '13px', fontFamily: 'IBM Plex Mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tech || '—'}</div>
                      <div style={{ paddingLeft: '13px', marginTop: '3px', display: 'flex', gap: '6px' }}>
                        {s.apis?.length > 0 && <span style={{ color: C.amber, fontSize: '10px', fontFamily: 'IBM Plex Mono' }}>{s.apis.length} api</span>}
                        {s.events?.length > 0 && <span style={{ color: C.green, fontSize: '10px', fontFamily: 'IBM Plex Mono' }}>{s.events.length} evt</span>}
                        {s.dependencies?.length > 0 && <span style={{ color: C.accentBr, fontSize: '10px', fontFamily: 'IBM Plex Mono' }}>{s.dependencies.length} dep</span>}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>

        {/* ── Main ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, padding: '0 16px', background: C.surface, flexShrink: 0 }}>
            {[['chat', 'chat'], ['topology', 'topology'], ['export', 'artifacts']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px',
                color: view === v ? C.accentBr : C.muted,
                borderBottom: `2px solid ${view === v ? C.accentBr : 'transparent'}`,
                fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '-1px',
                transition: 'color 0.15s',
              }}>{label}</button>
            ))}
          </div>

          {view === 'chat' ? (
            <>
              {/* Chat messages */}
              <div style={{ flex: 1, overflow: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {messages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: '4px' }}>
                    {m.role === 'assistant' && (
                      <div style={{ color: C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>ARCHITECT</div>
                    )}
                    <div style={{
                      maxWidth: '80%', padding: '11px 15px', fontSize: '14px', lineHeight: '1.65', color: C.text,
                      borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '2px 12px 12px 12px',
                      background: m.role === 'user' ? C.accentBr + '18' : C.card,
                      border: `1px solid ${m.role === 'user' ? C.accentBr + '38' : C.border}`,
                    }}>
                      {renderMd(m.content)}
                    </div>
                    {m.added?.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {m.added.map((name, j) => (
                          <div key={j} style={{ background: C.green + '14', border: `1px solid ${C.green}45`, borderRadius: '4px', padding: '3px 9px', fontSize: '11px', color: C.green, fontFamily: 'IBM Plex Mono' }}>
                            ✓ {name} added
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ color: C.accentBr, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>ARCHITECT</div>
                    <div style={{ display: 'flex', gap: '3px', padding: '10px 14px', background: C.card, borderRadius: '2px 12px 12px 12px', border: `1px solid ${C.border}` }}>
                      <div className="dot" /><div className="dot" /><div className="dot" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Implementation-in-progress banner */}
              {implRunning && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 16px', background: C.amber + '14', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <span style={{ color: C.amber, fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700' }}>⬡ IMPLEMENTATION IN PROGRESS</span>
                  <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>Watch the log above · chat is paused</span>
                  <button onClick={() => setShowImplPanel(true)} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${C.amber + '66'}`, borderRadius: '4px', color: C.amber, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', padding: '3px 10px' }}>SHOW LOG</button>
                </div>
              )}

              {/* Input */}
              {!implRunning && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 16px', display: 'flex', gap: '10px', alignItems: 'flex-end', background: C.surface, flexShrink: 0 }}>
                <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
                  placeholder="Describe your system, ask about service design, API contracts, event flows…" rows={2}
                  style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', color: C.text, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '14px', padding: '10px 14px', resize: 'none', outline: 'none', lineHeight: '1.5' }} />
                <button onClick={() => {
                  setInput("I have an existing codebase I want to reverse-engineer into this ecosystem. I'll describe the services I found — please reconstruct the architecture and add each service using ecosystem_update blocks. Start by asking me to describe the first service.");
                }} disabled={loading} title="Reverse-engineer existing code into the ecosystem"
                  style={{ padding: '10px 12px', flexShrink: 0, background: 'none', border: `1px solid ${C.border}`, borderRadius: '8px', color: C.purple, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  ↺ REVERSE
                </button>
                <button onClick={send} disabled={loading || !input.trim()}
                  style={{
                    padding: '10px 18px', flexShrink: 0,
                    background: loading || !input.trim() ? C.card : C.accentBr,
                    border: `1px solid ${loading || !input.trim() ? C.border : C.accentBr}`,
                    borderRadius: '8px',
                    color: loading || !input.trim() ? C.muted : '#fff',
                    cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                    fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700',
                    letterSpacing: '0.06em', transition: 'all 0.15s',
                  }}>SEND ▶</button>
              </div>
              )}
            </>
          ) : view === 'topology' ? (
            // Topology view
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <Topology services={services} onSelect={s => setSelected(prev => prev?.id === s.id ? null : s)} />
              {services.length > 0 && (
                <div style={{ position: 'absolute', bottom: '14px', left: '14px', color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '10px', background: C.surface + 'dd', padding: '4px 9px', borderRadius: '4px', border: `1px solid ${C.border}` }}>
                  {services.length} service{services.length !== 1 ? 's' : ''} · click to inspect
                </div>
              )}
            </div>
          ) : (
            // Export view
            <ExportPanel services={services} projectName={projectName} />
          )}

          {/* Service detail overlay (not shown in export view) */}
          {selected && view !== 'export' && <DetailPanel service={selected} onClose={() => setSelected(null)} onUpdate={updateService} />}
        </div>
      </div>

      {/* ── Repo-exists confirmation modal ── */}
      {implConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '28px 32px', maxWidth: '420px', width: '90%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ color: C.amber, fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', letterSpacing: '0.14em' }}>⚠ REPO ALREADY EXISTS</div>
            <div style={{ color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', lineHeight: '1.7' }}>
              <strong style={{ color: C.accentBr }}>{implConfirm.repoName}</strong> already exists on GitHub.
              Continuing will overwrite files in that repository.
            </div>
            <div style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px', lineHeight: '1.6' }}>
              If this is a previous implementation run you want to regenerate, click Continue. Otherwise Cancel and check your GitHub settings.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setImplConfirm(null)}
                style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '7px 18px' }}>
                CANCEL
              </button>
              <button onClick={async () => {
                const { repoName: confirmedRepo } = implConfirm;
                setImplConfirm(null);
                setRepoName(confirmedRepo);
                await api('/api/ecosystem', 'PUT', { projectName, services, repoName: confirmedRepo }).catch(() => {});
                setImplLog([{ type: 'info', message: `Repo ${confirmedRepo} already exists — overwriting` }]);
                runImplStream();
              }}
                style={{ background: C.amber + '22', border: `1px solid ${C.amber + '66'}`, borderRadius: '4px', color: C.amber, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '7px 18px' }}>
                CONTINUE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
