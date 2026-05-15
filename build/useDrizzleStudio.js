import { useDevToolsPluginClient, } from 'expo/devtools';
import { useEffect, useRef } from 'react';
/** Channel the device uses to mirror its activity to the webui debug panel. */
export const DEBUG_CHANNEL = 'drizzle-studio-debug';
/**
 * Mirror an event to the webui debug panel. Best-effort, and deliberately
 * NOT logged to the Metro console — that would spam the terminal on every
 * studio query. Open the debug panel in the studio page to watch traffic.
 */
function emitDebug(client, entry) {
    try {
        client.sendMessage(DEBUG_CHANNEL, { t: Date.now(), ...entry });
    }
    catch {
        // the debug channel is purely diagnostic — never let it throw
    }
}
async function runQuery(db, client, event) {
    const startedAt = Date.now();
    let statement = null;
    try {
        statement = await db.prepareAsync(event.sql);
        const executed = event.arrayMode
            ? await statement.executeForRawResultAsync(event.params ?? [])
            : await statement.executeAsync(event.params ?? []);
        const data = await executed.getAllAsync();
        client.sendMessage(`query-${event.id}`, data);
        emitDebug(client, {
            kind: 'query:ok',
            id: event.id,
            sql: event.sql,
            rows: Array.isArray(data) ? data.length : null,
            ms: Date.now() - startedAt,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        client.sendMessage(`query-${event.id}`, { error: message });
        emitDebug(client, {
            kind: 'query:error',
            id: event.id,
            sql: event.sql,
            error: message,
        });
    }
    finally {
        // The original plugin never finalized prepared statements — every
        // studio introspection query leaked one. Always release it.
        await statement?.finalizeAsync().catch(() => undefined);
    }
}
async function runTransaction(db, client, event) {
    const results = [];
    try {
        await db.withTransactionAsync(async () => {
            for (const query of event.queries) {
                const statement = await db.prepareAsync(query.sql);
                try {
                    const executed = await statement.executeAsync(query.params ?? []);
                    results.push(await executed.getAllAsync());
                }
                finally {
                    await statement.finalizeAsync().catch(() => undefined);
                }
            }
        });
    }
    catch (error) {
        results.push({
            error: error instanceof Error ? error.message : String(error),
        });
    }
    client.sendMessage(`transaction-${event.id}`, results);
    emitDebug(client, {
        kind: 'transaction:done',
        id: event.id,
        count: event.queries.length,
    });
}
/**
 * Bridges an `expo-sqlite` database to Drizzle Studio.
 *
 * Fixes the "infinite loader / no tables" symptom (drizzle-studio-expo#23):
 * the studio fires its whole schema-introspection burst the instant it
 * connects. The original hook only attached its message listeners once
 * `db` was non-null — so any query that arrived while the database was
 * still opening was silently dropped and the studio spun forever.
 *
 * Here the listeners attach as soon as the DevTools client exists; queries
 * that arrive before the database is ready are buffered and replayed once
 * it is. Prepared statements are also finalized (the original leaked one
 * per query), and every step is mirrored to a debug channel.
 */
export function useDrizzleStudio(db) {
    const client = useDevToolsPluginClient('expo-drizzle-studio-plugin');
    // Live ref so the (stable) listeners always see the current database
    // without having to re-subscribe when it becomes available.
    const dbRef = useRef(db);
    dbRef.current = db;
    const pendingQueries = useRef([]);
    const pendingTransactions = useRef([]);
    // Attach studio listeners as soon as the client exists — NOT gated on db.
    useEffect(() => {
        if (!client) {
            return;
        }
        emitDebug(client, {
            kind: 'listeners:attached',
            dbReady: dbRef.current != null,
            devServer: client.connectionInfo?.devServer,
        });
        const subscriptions = [
            client.addMessageListener('query', (event) => {
                emitDebug(client, {
                    kind: 'query:recv',
                    id: event.id,
                    sql: event.sql,
                    dbReady: dbRef.current != null,
                });
                if (dbRef.current) {
                    void runQuery(dbRef.current, client, event);
                }
                else {
                    // Database still opening — buffer and replay on the flush effect.
                    pendingQueries.current.push(event);
                }
            }),
            client.addMessageListener('transaction', (event) => {
                emitDebug(client, {
                    kind: 'transaction:recv',
                    id: event.id,
                    dbReady: dbRef.current != null,
                });
                if (dbRef.current) {
                    void runTransaction(dbRef.current, client, event);
                }
                else {
                    pendingTransactions.current.push(event);
                }
            }),
        ];
        return () => {
            for (const subscription of subscriptions) {
                subscription.remove();
            }
        };
    }, [client]);
    // Replay anything that queued up while the database was opening.
    useEffect(() => {
        if (!client || !db) {
            return;
        }
        const queries = pendingQueries.current.splice(0);
        const transactions = pendingTransactions.current.splice(0);
        if (queries.length > 0 || transactions.length > 0) {
            emitDebug(client, {
                kind: 'flush',
                queries: queries.length,
                transactions: transactions.length,
            });
        }
        for (const event of queries) {
            void runQuery(db, client, event);
        }
        for (const event of transactions) {
            void runTransaction(db, client, event);
        }
    }, [client, db]);
}
//# sourceMappingURL=useDrizzleStudio.js.map