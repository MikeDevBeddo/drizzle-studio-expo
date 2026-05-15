import {
    DevToolsPluginClient,
    useDevToolsPluginClient
} from "expo/devtools";
import {
    ComponentPropsWithoutRef,
    CSSProperties,
    RefObject,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import StudioScript from './studio.js';

declare global {
    interface Window {
        client: DevToolsPluginClient;
    }
}

interface DrizzleStudioRef {
    dbHash: string;
    client: DevToolsPluginClient;
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'drizzle-studio': ComponentPropsWithoutRef<'div'> & {
        ref?: RefObject<DrizzleStudioRef | null>;
      };
    }
  }
}

/** Channel the device-side `useDrizzleStudio` hook mirrors its activity to. */
const DEBUG_CHANNEL = 'drizzle-studio-debug';

interface DebugEntry {
    /** Device clock (ms) when the event happened. */
    t: number;
    /** Browser clock (ms) when the webui received it. */
    at: number;
    kind?: string;
    id?: string;
    sql?: string;
    rows?: number | null;
    ms?: number;
    error?: string;
    dbReady?: boolean;
    devServer?: string;
    queries?: number;
    transactions?: number;
    count?: number;
}

export default function App() {
    const client = useDevToolsPluginClient("expo-drizzle-studio-plugin");
    const studioRef = useRef<DrizzleStudioRef>(null);

    useEffect(() => {
        if (!client) {
            return;
        }
        if (!customElements.get("drizzle-studio")) {
            new Function(StudioScript as string)();
        }
        if (studioRef.current) {
            studioRef.current.dbHash = client.connectionInfo.devServer;
            studioRef.current.client = client;
        }
    }, [client]);

    return (
        <>
            <drizzle-studio
                ref={studioRef}
                style={{
                    flexGrow: 1,
                    minHeight: 0
                }}
            />
            <DebugPanel client={client} />
        </>
    );
}

// ───────────────────────────────────────────────────────────────────────────
//  Debug panel — visualises the device <-> studio traffic so the "infinite
//  loader" can be diagnosed without guessing.
// ───────────────────────────────────────────────────────────────────────────

function DebugPanel({ client }: { client: DevToolsPluginClient | null }) {
    const [open, setOpen] = useState(false);
    const [log, setLog] = useState<DebugEntry[]>([]);
    const [mountedAt] = useState(() => Date.now());
    const [, forceTick] = useState(0);

    // Subscribe to the device-side debug feed.
    useEffect(() => {
        if (!client) {
            return;
        }
        const sub = client.addMessageListener(
            DEBUG_CHANNEL,
            (entry: Omit<DebugEntry, 'at'>) => {
                setLog((prev) => [...prev.slice(-299), { ...entry, at: Date.now() }]);
            },
        );
        return () => sub.remove();
    }, [client]);

    // Re-render every second so the "no data yet" diagnosis can mature.
    useEffect(() => {
        const id = setInterval(() => forceTick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const counts = useMemo(() => {
        const c = { recv: 0, ok: 0, error: 0, flush: 0, attached: 0 };
        for (const e of log) {
            if (e.kind === 'query:recv' || e.kind === 'transaction:recv') c.recv++;
            else if (e.kind === 'query:ok') c.ok++;
            else if (e.kind === 'query:error') c.error++;
            else if (e.kind === 'flush') c.flush++;
            else if (e.kind === 'listeners:attached') c.attached++;
        }
        return c;
    }, [log]);

    const diagnosis = useMemo(
        () => diagnose(client, log, counts, Date.now() - mountedAt),
        [client, log, counts, mountedAt],
    );

    const toggle: CSSProperties = {
        position: 'fixed', right: 12, bottom: 12, zIndex: 99999,
        padding: '6px 12px', borderRadius: 8, border: '1px solid #3a3a3a',
        background: '#1d1d1f', color: '#e6e6e6', font: '12px monospace',
        cursor: 'pointer',
    };

    if (!open) {
        const dot = !client ? '#e0a000' : counts.error > 0 ? '#e04444'
            : counts.ok > 0 ? '#3aa655' : '#e0a000';
        return (
            <button style={toggle} onClick={() => setOpen(true)}>
                <span style={{ color: dot }}>●</span> studio debug
                {counts.recv > 0 ? ` · ${counts.recv} q` : ''}
            </button>
        );
    }

    return (
        <div style={{
            position: 'fixed', right: 12, bottom: 12, zIndex: 99999,
            width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
            background: '#161617', color: '#e6e6e6', font: '12px monospace',
            border: '1px solid #3a3a3a', borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: '#1d1d1f', borderBottom: '1px solid #3a3a3a',
            }}>
                <strong>Drizzle Studio · debug</strong>
                <span>
                    <button style={miniBtn} onClick={() => setLog([])}>clear</button>
                    <button
                        style={miniBtn}
                        onClick={() => {
                            void navigator.clipboard?.writeText(JSON.stringify(log, null, 2));
                        }}
                    >copy</button>
                    <button style={miniBtn} onClick={() => setOpen(false)}>×</button>
                </span>
            </div>

            <div style={{ padding: '8px 10px', borderBottom: '1px solid #2a2a2a' }}>
                <Row label="client" value={client ? 'connected' : 'connecting…'} />
                <Row label="connected" value={client ? String(client.isConnected?.() ?? '—') : '—'} />
                <Row label="devServer" value={client?.connectionInfo?.devServer ?? '—'} />
                <Row
                    label="counts"
                    value={`recv ${counts.recv} · ok ${counts.ok} · err ${counts.error} · flush ${counts.flush}`}
                />
            </div>

            <div style={{
                padding: '8px 10px', borderBottom: '1px solid #2a2a2a',
                background: diagnosis.level === 'error' ? '#2a1718'
                    : diagnosis.level === 'ok' ? '#152417' : '#2a2417',
                color: diagnosis.level === 'error' ? '#ff9b9b'
                    : diagnosis.level === 'ok' ? '#9bdfae' : '#e8d48a',
            }}>
                {diagnosis.text}
            </div>

            <div style={{ overflowY: 'auto', padding: '4px 0' }}>
                {log.length === 0 ? (
                    <div style={{ padding: '8px 10px', color: '#888' }}>
                        No events from the device yet.
                    </div>
                ) : (
                    log.map((e, i) => (
                        <div key={i} style={{
                            padding: '2px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            color: entryColor(e.kind),
                        }}>
                            {clock(e.at)} {e.kind ?? '?'} {detail(e)}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

const miniBtn: CSSProperties = {
    marginLeft: 6, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
    border: '1px solid #3a3a3a', background: '#2a2a2c', color: '#e6e6e6',
    font: '11px monospace',
};

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: '#888', width: 78, flexShrink: 0 }}>{label}</span>
            <span style={{ wordBreak: 'break-all' }}>{value}</span>
        </div>
    );
}

function clock(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function entryColor(kind?: string): string {
    if (kind === 'query:error') return '#ff9b9b';
    if (kind === 'query:ok') return '#9bdfae';
    if (kind === 'flush') return '#e8d48a';
    if (kind === 'listeners:attached') return '#8ab4f8';
    return '#cfcfcf';
}

function detail(e: DebugEntry): string {
    const id = e.id ? `#${String(e.id).slice(0, 8)}` : '';
    switch (e.kind) {
        case 'listeners:attached':
            return `dbReady=${e.dbReady} devServer=${e.devServer ?? '—'}`;
        case 'query:recv':
            return `${id} dbReady=${e.dbReady} ${truncate(e.sql)}`;
        case 'query:ok':
            return `${id} rows=${e.rows} ${e.ms}ms`;
        case 'query:error':
            return `${id} ${e.error}`;
        case 'transaction:recv':
        case 'transaction:done':
            return `${id} count=${e.count ?? '—'}`;
        case 'flush':
            return `queries=${e.queries} transactions=${e.transactions}`;
        default:
            return truncate(e.sql);
    }
}

function truncate(sql?: string): string {
    if (!sql) return '';
    const flat = sql.replace(/\s+/g, ' ').trim();
    return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

interface Diagnosis {
    level: 'ok' | 'warn' | 'error';
    text: string;
}

function diagnose(
    client: DevToolsPluginClient | null,
    log: DebugEntry[],
    counts: { recv: number; ok: number; error: number; flush: number; attached: number },
    elapsedMs: number,
): Diagnosis {
    if (!client) {
        return { level: 'warn', text: 'Connecting to the dev server…' };
    }
    if (log.length === 0) {
        if (elapsedMs < 3000) {
            return { level: 'warn', text: 'Connected — waiting for the device…' };
        }
        return {
            level: 'error',
            text: 'Connected to the dev server, but nothing arrived from the device. '
                + 'Check the app is running, that useDrizzleStudio() / <DatabaseDevTools/> '
                + 'is mounted, and reload the app.',
        };
    }
    if (counts.attached > 0 && counts.recv === 0) {
        return {
            level: 'error',
            text: 'The device hook is mounted but the studio\'s queries are not reaching it. '
                + 'Likely a DevTools connection issue — reload both the app and this page.',
        };
    }
    if (counts.error > 0) {
        return {
            level: 'error',
            text: `The device received queries but ${counts.error} failed — see the red rows below.`,
        };
    }
    if (counts.recv > 0 && counts.ok > 0) {
        return {
            level: 'ok',
            text: 'The device is receiving and answering queries. If the studio still '
                + 'spins, the response shape is the suspect — compare a query:ok row.',
        };
    }
    if (counts.recv > 0) {
        return { level: 'warn', text: 'Queries received — waiting for the device to answer…' };
    }
    return { level: 'warn', text: 'Listening…' };
}
