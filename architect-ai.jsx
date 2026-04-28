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

// ── Ecosystem update parsing ──────────────────────────────────────────────────
function parseUpdates(text) {
  const out = [];
  const re = /<ecosystem_update>([\s\S]*?)<\/ecosystem_update>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try { out.push(JSON.parse(m[1].trim())); } catch {}
  }
  return out;
}

function stripTags(text) {
  return text.replace(/<ecosystem_update>[\s\S]*?<\/ecosystem_update>/g, '').trim();
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildPrompt(services) {
  return `You are ArchitectAI — a senior software architect specializing in microservices, event-driven systems, and distributed architecture.

Your expertise includes: service decomposition and bounded contexts (DDD), REST/gRPC/GraphQL API design, event-driven patterns (Kafka, CQRS, event sourcing, Saga), resilience patterns (circuit breaker, bulkhead, retry with backoff), service mesh, distributed tracing, data ownership and consistency boundaries, Kubernetes, AWS, and GitOps/ArgoCD deployment.

Current ecosystem state:
${services.length === 0
  ? '(empty — no services defined yet)'
  : JSON.stringify(services, null, 2)}

When the user has agreed to add or update a service, emit EXACTLY this JSON block — no prose inside the tags:
<ecosystem_update>
{"action":"add","service":{"id":"kebab-case-id","name":"ServiceName","purpose":"One sentence: what this service owns and is responsible for","tech":"Spring Boot","archetype":"http","apis":[{"method":"POST","path":"/path","description":"what this endpoint does"}],"events":[{"direction":"produces","topic":"domain.event.name","description":"what payload this carries"}],"dependencies":["other-service-id"]}}
</ecosystem_update>

Emit ecosystem_update ONLY when formalizing agreed services — not speculatively during discussion.
Use "action": "add", "update", or "remove" as appropriate.

## Service archetypes

Every service must have one of these archetypes — choose the one that best describes its primary role:

- **http** — Standard REST/gRPC service with its own API surface and data store. No naming suffix required.
- **messaging** — Primarily event-driven; publishes and/or subscribes to topics. No naming suffix required.
- **provider** — Wraps a third-party or external API, exposing it to the ecosystem. The service id MUST end in \`-provider\` and the name MUST end in \`Provider\`. Include a \`foreignApi\` block: \`{"name":"...","baseUrl":"...","authMethod":"apiKey|oauth2|basic","generateMock":true}\`.
- **adaptor** — Bridges a foreign protocol or data format into the ecosystem. The service id MUST end in \`-adaptor\` and the name MUST end in \`Adaptor\`. Include an \`accepts\` block: \`{"protocol":"...","format":"...","foreignEntity":"...","generateMock":true,"mockBehavior":"..."}\`.

Provider example:
<ecosystem_update>
{"action":"add","service":{"id":"stripe-provider","name":"StripeProvider","purpose":"Wraps the Stripe payments API, exposing charge and refund operations to the ecosystem","tech":"Node.js/Express","archetype":"provider","foreignApi":{"name":"Stripe","baseUrl":"https://api.stripe.com","authMethod":"apiKey","generateMock":true},"apis":[{"method":"POST","path":"/charges","description":"Create a charge via Stripe"}],"events":[{"direction":"produces","topic":"payment.charged","description":"Emitted when a charge succeeds"}],"dependencies":[]}}
</ecosystem_update>

Adaptor example:
<ecosystem_update>
{"action":"add","service":{"id":"sftp-adaptor","name":"SftpAdaptor","purpose":"Polls an SFTP server for CSV files and emits structured events","tech":"Node.js/Express","archetype":"adaptor","accepts":{"protocol":"SFTP","format":"CSV","foreignEntity":"OrderExport","generateMock":true,"mockBehavior":"Emit one order.received event per CSV row"},"apis":[],"events":[{"direction":"produces","topic":"order.received","description":"Emitted for each row in an ingested CSV file"}],"dependencies":[]}}
</ecosystem_update>

Architectural principles to uphold:
- Single responsibility: each service owns one bounded context
- No shared databases between services
- Flag circular dependencies, chatty inter-service calls, data ownership violations
- Prefer async event-driven communication for cross-domain concerns
- Recommend specific patterns, not "it depends" hedging
- Call out when a proposed service is too broad or could be split`;
}

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

// ── Export generators ─────────────────────────────────────────────────────────
function genEcosystemJson(services, projectName) {
  return JSON.stringify({ project: projectName, generated: new Date().toISOString(), services }, null, 2);
}


function genSpecMd(services, projectName) {
  const date = new Date().toISOString().slice(0, 10);
  const hash = btoa(JSON.stringify(services)).slice(0, 12);

  const serviceBlocks = services.map(s => {
    const apiTable = s.apis?.length
      ? `| Method | Path | Description |\n|--------|------|-------------|\n` +
        s.apis.map(a => `| \`${a.method}\` | \`${a.path}\` | ${a.description} |`).join('\n')
      : '_No API endpoints defined._';

    const eventTable = s.events?.length
      ? `| Direction | Topic | Description |\n|-----------|-------|-------------|\n` +
        s.events.map(e => `| ${e.direction === 'produces' ? '**Produces**' : '**Consumes**'} | \`${e.topic}\` | ${e.description} |`).join('\n')
      : '_No event contracts defined._';

    const depTable = s.dependencies?.length
      ? `| Service | \n|---------|\n` + s.dependencies.map(d => `| \`${d}\` |`).join('\n')
      : '_No dependencies._';

    const archetypeSection = s.archetype && s.archetype !== 'http'
      ? `\n**Archetype:** ${s.archetype}` +
        (s.archetype === 'provider' && s.foreignApi
          ? `\n**Foreign API:** ${s.foreignApi.name || ''} — ${s.foreignApi.baseUrl || ''} (auth: ${s.foreignApi.authMethod || '?'})`
          : '') +
        (s.archetype === 'adaptor' && s.accepts
          ? `\n**Accepts:** ${s.accepts.protocol || ''}/${s.accepts.format || ''} — ${s.accepts.foreignEntity || ''}`
          : '')
      : '';

    return `<!-- service-start: ${s.id} -->
## Service: ${s.name}

**ID:** \`${s.id}\`
**Tech:** ${s.tech || 'TBD'}
**Purpose:** ${s.purpose}${archetypeSection}

### API Surface

${apiTable}

### Event Contracts

${eventTable}

### Service Dependencies

${depTable}

### Data Ownership

This service is the sole owner of its data store. No other service may read or write its database directly.

### Implementation Notes

_Add service-specific constraints, patterns, and architectural decisions here._

<!-- service-end: ${s.id} -->`;
  }).join('\n\n---\n\n');

  return `# ${projectName} — System Specification
<!-- spec-version: 1.0.0 -->
<!-- generated: ${date} -->
<!-- ecosystem-hash: ${hash} -->
<!-- DO NOT remove the HTML comment markers — they are machine-readable section delimiters -->

## System Overview

**${projectName}** is a platform consisting of ${services.length} microservice${services.length !== 1 ? 's' : ''}.

> _Edit this section to describe the system's overall purpose, the domain it operates in,
> and the key business capabilities it provides._

### Services at a glance

${services.map(s => `- **${s.name}** (\`${s.id}\`) — ${s.purpose}`).join('\n') || '_No services defined yet._'}

### Architecture principles

- Each service owns exactly one bounded context — no shared databases
- Cross-domain communication via Kafka events; same-domain via direct REST/gRPC
- API contracts are the only stable public interface of a service
- Prefer async event-driven patterns for cross-domain side effects

---

${serviceBlocks}

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| ${date} | Initial specification generated by ArchitectAI | ArchitectAI |

---

## AI Operation Protocol

This document is the authoritative specification. Three AI operations are defined:

### 1. Forward — Implement from spec
\`\`\`
claude "Read spec.md. For each service section, scaffold or implement the service
according to its API surface, event contracts, and dependencies. Do not deviate
from the contracts defined here."
\`\`\`

### 2. Reverse — Reconstruct spec from code
\`\`\`
claude "Examine this codebase. Identify all services, their REST/gRPC endpoints,
Kafka producers and consumers, and inter-service dependencies. Produce a
spec.md in the standard format (service-start/service-end markers, API table,
event table, dependency table). Preserve any existing Implementation Notes."
\`\`\`

### 3. Delta — Implement spec changes
\`\`\`bash
# Get the diff of what changed in the spec
git diff HEAD~1 -- spec.md > spec.diff

# Tell Claude Code to implement the delta
claude "Read spec.diff. For each changed service section, determine what code
changes are required (new endpoints, changed event schemas, new dependencies,
removed operations) and implement only those changes. Do not touch code for
unchanged services."
\`\`\`
`;
}

function genSpineClaudeMd(services, projectName) {
  const svcList = services.map(s => `- **${s.name}** (\`${s.id}\`) — ${s.purpose}`).join('\n');
  return `# ${projectName} — Platform Architecture Context

## Authoritative files
- @spec.md — human-readable living specification (source of truth for all AI operations)
- @ecosystem.json — machine-readable service registry (APIs, event contracts, dependencies)

## Services in this platform
${svcList || '(none yet)'}

## Architecture principles
- Each service owns exactly one bounded context — no shared databases
- Cross-domain communication via Kafka events; same-domain via direct API calls
- spec.md is the contract — code must match spec, not the other way around

## Three AI operations (see spec.md §AI Operation Protocol for full prompts)

### Forward — scaffold/implement a service
Read @spec.md, find the service section by its ID, implement exactly what is declared.

### Reverse — reconstruct spec from existing code
Walk the codebase, identify endpoints/events/dependencies, write them back into @spec.md
in the standard format. Preserve Implementation Notes already present.

### Delta — implement spec changes
\`\`\`bash
git diff HEAD~1 -- spec.md > spec.diff
claude "Read spec.diff, implement only the changed service sections."
\`\`\`

## Adding a new service
1. Architect it in ArchitectAI → push updated spec.md + ecosystem.json
2. In the service repo: \`claude "Scaffold this service per @../rkamradt-platform/spec.md#${'{service-id}'}\`
3. Place the generated service CLAUDE.md at the repo root
`;
}

function genServiceClaudeMd(svc, projectName) {
  const apis = svc.apis?.map(a =>
    `- \`${a.method} ${a.path}\` — ${a.description}`
  ).join('\n') || '(none)';

  const events = svc.events?.map(e =>
    `- ${e.direction === 'produces' ? '▶ Produces' : '◀ Consumes'} \`${e.topic}\` — ${e.description}`
  ).join('\n') || '(none)';

  const deps = svc.dependencies?.length
    ? svc.dependencies.map(d => `- \`${d}\``).join('\n')
    : '(none)';

  const arch = svc.archetype || 'http';

  const archetypeBlock = arch === 'provider' && svc.foreignApi
    ? `\n## Foreign API (${svc.foreignApi.name || 'external'})
- Base URL: \`${svc.foreignApi.baseUrl || 'TBD'}\`
- Auth method: ${svc.foreignApi.authMethod || 'TBD'}
- Generate mock: ${svc.foreignApi.generateMock ? 'yes — create a local stub server for testing' : 'no'}
`
    : arch === 'adaptor' && svc.accepts
    ? `\n## Accepts (foreign input)
- Protocol: ${svc.accepts.protocol || 'TBD'}
- Format: ${svc.accepts.format || 'TBD'}
- Foreign entity: ${svc.accepts.foreignEntity || 'TBD'}
- Generate mock: ${svc.accepts.generateMock ? 'yes — create a mock sender for testing' : 'no'}
${svc.accepts.mockBehavior ? `- Mock behavior: ${svc.accepts.mockBehavior}` : ''}
`
    : '';

  return `# ${svc.name}
Part of the **${projectName}** ecosystem.
Archetype: **${arch}**

## This service owns
${svc.purpose}

## Tech stack
${svc.tech || 'TBD'}
${archetypeBlock}
## API contracts — implement exactly as specified
${apis}

## Event contracts — implement exactly as specified
${events}

## Service dependencies
${deps}

## Platform context
See @../rkamradt-platform/ecosystem.json for the full ecosystem registry.
See @../rkamradt-platform/CLAUDE.md for platform-wide architecture rules.

## Build & run
\`\`\`bash
mvn spring-boot:run
mvn test
\`\`\`

## Implementation notes
- Do not share a database with any other service
- All inter-service calls must go through the declared API or event contracts above
- Prefer async (Kafka) for cross-domain side effects; use sync API calls only for same-domain queries
`;
}

// ── Export panel ──────────────────────────────────────────────────────────────
function ExportPanel({ services, projectName }) {
  const [tab, setTab] = useState('spec');
  const [selId, setSelId] = useState(services[0]?.id || null);
  const [copied, setCopied] = useState(null);

  const selSvc = services.find(s => s.id === selId);

  const files = {
    spec:      { name: 'rkamradt-platform/spec.md',       content: genSpecMd(services, projectName) },
    spine:     { name: 'rkamradt-platform/CLAUDE.md',     content: genSpineClaudeMd(services, projectName) },
    ecosystem: { name: 'rkamradt-platform/ecosystem.json', content: genEcosystemJson(services, projectName) },
    service:   selSvc ? { name: `${selId}/CLAUDE.md`, content: genServiceClaudeMd(selSvc, projectName) } : null,
  };

  const cur = files[tab];

  function copy(content, key) {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  if (!services.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '12px' }}>
        <div style={{ fontSize: '36px', opacity: 0.2 }}>⬡</div>
        <div>No services to export yet</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '12px 16px 0', background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {[
          { key: 'spec',      label: 'spec.md ★' },
          { key: 'spine',     label: 'Spine CLAUDE.md' },
          { key: 'ecosystem', label: 'ecosystem.json' },
          { key: 'service',   label: 'Service CLAUDE.md' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: tab === key ? C.card : 'none', border: `1px solid ${tab === key ? C.border : 'transparent'}`,
            borderBottom: tab === key ? `1px solid ${C.card}` : `1px solid ${C.border}`,
            marginBottom: '-1px', padding: '6px 14px', borderRadius: '6px 6px 0 0',
            cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700',
            color: tab === key ? C.accentBr : C.muted, letterSpacing: '0.06em',
          }}>{label}</button>
        ))}
      </div>

      {/* File header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: C.card, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>📄</span>
          <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px' }}>{cur?.name}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {tab === 'service' && services.length > 1 && (
            <select value={selId || ''} onChange={e => setSelId(e.target.value)}
              style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '11px', padding: '3px 8px' }}>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {cur && (
            <button onClick={() => copy(cur.content, tab)} style={{
              background: copied === tab ? C.green + '22' : C.surface,
              border: `1px solid ${copied === tab ? C.green + '55' : C.border}`,
              borderRadius: '4px', padding: '4px 12px', cursor: 'pointer',
              fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700',
              color: copied === tab ? C.green : C.muted, transition: 'all 0.15s',
            }}>
              {copied === tab ? '✓ COPIED' : 'COPY'}
            </button>
          )}
        </div>
      </div>

      {/* File content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {cur ? (
          <pre style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', lineHeight: '1.7', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
            {cur.content}
          </pre>
        ) : (
          <div style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '12px' }}>Select a service above.</div>
        )}
      </div>

      {/* Usage guide */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '14px 16px', background: C.surface, flexShrink: 0 }}>
        <div style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.14em', marginBottom: '10px' }}>GITHUB WORKFLOW</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            ['1', `Configure GitHub (⎔) with owner, repo, branch, and PAT`],
            ['2', `↑ push — commits ecosystem.json, spec.md, and CLAUDE.md files to your repo`],
            ['3', `⬡ implement — creates the repo and scaffolds all service code via Claude`],
            ['4', `↓ pull — restores ecosystem from a previously pushed ecosystem.json`],
          ].map(([n, label]) => (
            <div key={n} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', background: C.card, borderRadius: '5px', padding: '7px 10px', flex: '1 1 45%', minWidth: '200px' }}>
              <span style={{ color: C.accentBr, fontFamily: 'IBM Plex Mono', fontWeight: '700', fontSize: '11px', minWidth: '14px' }}>{n}</span>
              <span style={{ color: C.muted, fontFamily: 'IBM Plex Mono', fontSize: '11px', lineHeight: '1.5' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function ArchitectAI() {
  const { isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();

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

  useEffect(() => {
    if (!isAuthenticated) return;
    api('/api/user/profile').then(data => {
      setHasApiKey(!!data.hasApiKey);
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

  // ── Persist & hydrate ────────────────────────────────────────────────────────
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/ecosystem');
        if (data.services) setServices(data.services);
        if (data.projectName) setProjectName(data.projectName);
      } catch {}
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    api('/api/ecosystem', 'PUT', { services, projectName }).catch(() => {});
  }, [services, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    api('/api/ecosystem', 'PUT', { services, projectName }).catch(() => {});
  }, [projectName, hydrated]);

  // ── GitHub integration ────────────────────────────────────────────────────────
  const [ghConfig, setGhConfig] = useState({ token: '', owner: '', repo: '', branch: 'main', path: 'ecosystem.json' });
  const [ghStatus, setGhStatus] = useState(null); // null | 'pulling' | 'pushing' | 'ok' | 'error'
  const [ghMsg, setGhMsg] = useState('');
  const [showGhPanel, setShowGhPanel] = useState(false);

  // ── Implement ─────────────────────────────────────────────────────────────────
  const [implRunning, setImplRunning] = useState(false);
  const [implLog, setImplLog] = useState([]);
  const [showImplPanel, setShowImplPanel] = useState(false);
  const implLogEndRef = useRef(null);
  const [implConfirm, setImplConfirm] = useState(null); // { repoName } | null

  useEffect(() => {
    if (showImplPanel) implLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [implLog, showImplPanel]);

  // Load gh config from backend on mount
  useEffect(() => {
    api('/api/github/config').then(cfg => {
      if (cfg && !cfg.error) setGhConfig(prev => ({ ...prev, ...cfg }));
    }).catch(() => {});
  }, []);

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

  function saveGhConfig(cfg) {
    setGhConfig(cfg);
    api('/api/github/config', 'PUT', cfg).catch(() => {});
  }

  async function ghPull() {
    setGhStatus('pulling'); setGhMsg('');
    try {
      const data = await api('/api/github/pull', 'POST');
      if (data.error) throw new Error(data.error);
      if (!data.content) {
        setGhMsg('ecosystem.json not found in repo — push will create it.');
        setGhStatus('ok'); return;
      }
      const text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
      const parsed = JSON.parse(text);
      if (parsed.services) {
        setServices(parsed.services);
        if (parsed.project) setProjectName(parsed.project);
      }
      setGhStatus('ok'); setGhMsg(`Pulled ${parsed.services?.length ?? 0} services from repo`);
    } catch (e) {
      setGhStatus('error'); setGhMsg(e.message);
    }
  }

  async function ghPush() {
    setGhStatus('pushing'); setGhMsg('');
    try {
      const base = (ghConfig.path || 'ecosystem.json').replace(/ecosystem\.json$/, '');
      const files = [
        { path: `${base}ecosystem.json`, content: genEcosystemJson(services, projectName) },
        { path: `${base}spec.md`,        content: genSpecMd(services, projectName) },
        { path: `${base}CLAUDE.md`,      content: genSpineClaudeMd(services, projectName) },
        ...services.map(s => ({ path: `${base}${s.id}/CLAUDE.md`, content: genServiceClaudeMd(s, projectName) })),
      ];
      const data = await api('/api/github/push', 'POST', { files });
      if (data.error) throw new Error(data.error);
      setGhStatus('ok');
      setGhMsg(`Pushed ${data.results?.length ?? files.length} files to ${ghConfig.owner}/${ghConfig.repo}`);
    } catch (e) {
      setGhStatus('error'); setGhMsg(e.message);
    }
  }

  const ghConnected = !!(ghConfig.token && ghConfig.owner && ghConfig.repo);

  function toRepoName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-services';
  }

  async function implement() {
    if (!services.length || implRunning) return;
    const repoName = toRepoName(projectName);

    // Check whether the repo already exists before starting
    const createRes = await api('/api/github/create-repo', 'POST', {
      repoName,
      description: `${projectName} — generated by ArchitectAI`,
      private: false,
    });

    if (createRes.error && createRes.error.includes('already exists')) {
      // Pause and ask the user before overwriting
      setImplConfirm({ repoName });
      return;
    }
    if (createRes.error) {
      setImplLog(prev => [...prev, { type: 'error', message: createRes.error }]);
      setShowImplPanel(true);
      return;
    }

    setImplLog([{ type: 'start', message: `Repo created: ${createRes.repoUrl}` }]);
    await runImplStream(repoName);
  }

  async function runImplStream(repoName) {
    setImplRunning(true);
    setShowImplPanel(true);

    try {
      // Start the background job — returns immediately with a jobId
      const startRes = await api('/api/implement/start', 'POST', { repoName });
      if (startRes.error) throw new Error(startRes.error);
      const { jobId } = startRes;

      // Poll for new events every 2 seconds until the job finishes
      let since = 0;
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await api(`/api/implement/${jobId}/poll?since=${since}`);
        if (poll.error) throw new Error(poll.error);
        if (poll.events.length > 0) {
          setImplLog(prev => [...prev, ...poll.events]);
          since += poll.events.length;
        }
        if (poll.status === 'done' || poll.status === 'error') break;
      }
    } catch (e) {
      setImplLog(prev => [...prev, { type: 'error', message: e.message }]);
    }

    setImplRunning(false);
  }

  // Simple markdown renderer: **bold**, `code`, newlines
  function renderMd(text) {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**'))
        return <strong key={i} style={{ color: C.text }}>{p.slice(2, -2)}</strong>;
      if (p.startsWith('`') && p.endsWith('`'))
        return <code key={i} style={{ fontFamily: 'IBM Plex Mono, monospace', background: C.bg, padding: '1px 5px', borderRadius: '3px', fontSize: '12px', color: C.accentGlow }}>{p.slice(1, -1)}</code>;
      return p.split('\n').flatMap((line, j, arr) =>
        j < arr.length - 1 ? [line, <br key={`${i}-${j}`} />] : [line]
      );
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
      const data = await api('/api/messages', 'POST', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: buildPrompt(services),
        messages: apiHistory,
      });
      if (data.error) throw new Error(data.error.message);

      const raw = data.content?.map(b => b.text || '').join('') || '';
      const updates = parseUpdates(raw);

      if (updates.length) {
        setServices(prev => {
          let next = [...prev];
          for (const u of updates) {
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

      const display = stripTags(raw);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: display,
        added: updates.length ? updates.map(u => u.service?.name).filter(Boolean) : null,
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
            <button onClick={ghPull} disabled={ghStatus === 'pulling' || ghStatus === 'pushing'}
              title={`Pull ecosystem.json from ${ghConfig.owner}/${ghConfig.repo}`}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: ghStatus === 'pulling' ? C.amber : C.accentBr, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 9px' }}>
              {ghStatus === 'pulling' ? '…' : '↓ pull'}
            </button>
            <button onClick={ghPush} disabled={ghStatus === 'pulling' || ghStatus === 'pushing' || !services.length}
              title={`Push ecosystem.json to ${ghConfig.owner}/${ghConfig.repo}`}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: ghStatus === 'pushing' ? C.amber : C.green, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 9px' }}>
              {ghStatus === 'pushing' ? '…' : '↑ push'}
            </button>
            <button onClick={implement} disabled={implRunning || !services.length}
              title={`Scaffold ${toRepoName(projectName)} and push to GitHub`}
              style={{ background: implRunning ? C.card : C.purple + '22', border: `1px solid ${implRunning || !services.length ? C.border : C.purple + '88'}`, borderRadius: '4px', color: implRunning ? C.muted : C.purple, cursor: implRunning || !services.length ? 'not-allowed' : 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 9px', fontWeight: '700' }}>
              {implRunning ? '⟳ building…' : '▶ implement'}
            </button>
          </>}
          <button title="Anthropic API key" onClick={() => { setShowKeyPanel(p => !p); setApiKeyInput(''); setApiKeyError(''); }}
            style={{ background: showKeyPanel ? C.card : 'none', border: `1px solid ${showKeyPanel ? C.accentBr : C.border}`, borderRadius: '4px', color: C.accentBr, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px', lineHeight: 1 }}>
            ⚿
          </button>
          <button title="GitHub settings" onClick={() => setShowGhPanel(p => !p)}
            style={{ background: showGhPanel ? C.card : 'none', border: `1px solid ${showGhPanel ? C.accentBr : C.border}`, borderRadius: '4px', color: ghConnected ? C.accentBr : C.dim, cursor: 'pointer', fontSize: '13px', fontFamily: 'IBM Plex Mono', padding: '2px 8px', lineHeight: 1 }}>
            ⎔
          </button>
          <button title="Reset ecosystem" onClick={() => {
            if (window.confirm('Clear all services and start over?')) {
              setServices([]); setSelected(null);
              api('/api/ecosystem', 'PUT', { services: [], projectName }).catch(() => {});
            }
          }} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.dim, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px' }}>
            ↺
          </button>
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
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '14px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', flexShrink: 0 }}>
          {[
            { key: 'token',  label: 'PAT (token)',       type: 'password', placeholder: 'ghp_…',           width: '180px' },
            { key: 'owner',  label: 'Owner',             type: 'text',     placeholder: 'rkamradt',         width: '120px' },
            { key: 'repo',   label: 'Repo',              type: 'text',     placeholder: 'rkamradt-platform', width: '160px' },
            { key: 'branch', label: 'Branch',            type: 'text',     placeholder: 'main',             width: '90px'  },
            { key: 'path',   label: 'File path',         type: 'text',     placeholder: 'ecosystem.json',   width: '140px' },
          ].map(f => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em' }}>{f.label.toUpperCase()}</span>
              <input type={f.type} value={ghConfig[f.key]} placeholder={f.placeholder}
                onChange={e => saveGhConfig({ ...ghConfig, [f.key]: e.target.value })}
                style={{ width: f.width, background: C.surface, border: `1px solid ${C.border}`, borderRadius: '4px', color: C.text, fontFamily: 'IBM Plex Mono', fontSize: '12px', padding: '5px 9px', outline: 'none' }} />
            </label>
          ))}
          <button onClick={() => { ghPull(); setShowGhPanel(false); }}
            disabled={!ghConnected}
            style={{ background: C.accentBr, border: 'none', borderRadius: '4px', color: '#fff', cursor: ghConnected ? 'pointer' : 'not-allowed', fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', padding: '7px 16px', alignSelf: 'flex-end', opacity: ghConnected ? 1 : 0.45 }}>
            CONNECT & PULL
          </button>
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
            <button onClick={() => setShowImplPanel(false)}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: '13px' }}>×</button>
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
                <div key={i} style={{ color: C.green, fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700', paddingTop: '6px' }}>
                  ✓ {entry.message}{' '}
                  {entry.repoUrl && (
                    <a href={entry.repoUrl} target="_blank" rel="noreferrer"
                      style={{ color: C.accentBr, textDecoration: 'underline', fontWeight: '400' }}>
                      {entry.repoUrl}
                    </a>
                  )}
                  {entry.errors?.length > 0 && (
                    <span style={{ color: C.amber, fontWeight: '400' }}> ({entry.errors.length} push errors)</span>
                  )}
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
            {['chat', 'topology', 'export'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px',
                color: view === v ? C.accentBr : C.muted,
                borderBottom: `2px solid ${view === v ? C.accentBr : 'transparent'}`,
                fontFamily: 'IBM Plex Mono', fontSize: '11px', fontWeight: '700',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '-1px',
                transition: 'color 0.15s',
              }}>{v}</button>
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

              {/* Input */}
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
              <button onClick={() => {
                const { repoName } = implConfirm;
                setImplConfirm(null);
                setImplLog([{ type: 'info', message: `Repo ${repoName} already exists — overwriting` }]);
                runImplStream(repoName);
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
