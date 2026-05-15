import * as SQLite from 'expo-sqlite';
/** Channel the device uses to mirror its activity to the webui debug panel. */
export declare const DEBUG_CHANNEL = "drizzle-studio-debug";
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
export declare function useDrizzleStudio(db: SQLite.SQLiteDatabase | null): void;
//# sourceMappingURL=useDrizzleStudio.d.ts.map