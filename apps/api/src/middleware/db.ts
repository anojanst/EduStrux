import { createDb } from '@edustrux/db';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

/** What a request cost in calls to D1. On Cloudflare each call is a network round trip. */
export type DbTrips = {
  /** Calls made to D1. One statement is one call, and so is one batch of statements. */
  trips: number;
  /**
   * How many of those calls the request waited for one after another. A call's stage is one
   * more than the highest stage among the calls that had finished when it started (1 if none
   * had), and this is the highest stage any call reached. Calls sent together share a stage.
   * It never comes out lower than the real depth, so a budget can be held to it (D-102).
   */
  stages: number;
  /** Milliseconds with at least one call in flight. */
  ms: number;
};

type D1 = D1Database | D1DatabaseSession;

/** The statement methods that send it to D1. `bind` only builds a statement. */
const SENDS = new Set<PropertyKey>(['first', 'run', 'all', 'raw']);

/**
 * Wraps a D1 binding so every call made through it is counted. Drizzle only ever sees the
 * wrapper, so nothing in a repository changes.
 */
export function countTrips(d1: D1Database): { d1: D1Database; counts: DbTrips } {
  const counts: DbTrips = { trips: 0, stages: 0, ms: 0 };
  /** D1's own `batch` reads fields a wrapper doesn't have, so it is given the real statements. */
  const real = new WeakMap<object, D1PreparedStatement>();
  let inFlight = 0;
  let busySince = 0;
  /** The highest stage among the calls that have finished. */
  let finished = 0;

  async function trip<T>(send: () => Promise<T>): Promise<T> {
    // This call may have waited for any call that has already finished, so it is one stage on
    // from the deepest of them. A call still in flight can't have been waited for.
    const stage = finished + 1;
    counts.trips += 1;
    counts.stages = Math.max(counts.stages, stage);
    if (inFlight === 0) busySince = performance.now();
    inFlight += 1;
    try {
      return await send();
    } finally {
      finished = Math.max(finished, stage);
      inFlight -= 1;
      if (inFlight === 0) counts.ms += performance.now() - busySince;
    }
  }

  function countedStatement(statement: D1PreparedStatement): D1PreparedStatement {
    const wrapper = new Proxy(statement, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (key === 'bind') {
          return (...values: unknown[]) => countedStatement(target.bind(...values));
        }
        if (SENDS.has(key)) return (...args: unknown[]) => trip(() => value.apply(target, args));
        return value.bind(target);
      },
    });
    real.set(wrapper, statement);
    return wrapper;
  }

  function countedDatabase<T extends D1>(database: T): T {
    return new Proxy(database, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (key === 'prepare') return (query: string) => countedStatement(target.prepare(query));
        if (key === 'batch') {
          return (statements: D1PreparedStatement[]) =>
            trip(() => target.batch(statements.map((s) => real.get(s) ?? s)));
        }
        if (key === 'exec') return (...args: unknown[]) => trip(() => value.apply(target, args));
        if (key === 'withSession') {
          // A session (read replication) makes its calls through the same methods.
          return (...args: unknown[]) => countedDatabase(value.apply(target, args));
        }
        return value.bind(target);
      },
    });
  }

  return { d1: countedDatabase(d1), counts };
}

/**
 * Gives the request its database, and says what the request cost in D1 calls on every response,
 * in every environment (D-099): `Server-Timing: db;dur=12.0;trips=3;stages=2`. `dur` is the
 * standard field, in milliseconds. `call()` in the tests reads the other two.
 */
export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  const { d1, counts } = countTrips(c.env.DB);
  c.set('db', createDb(d1));
  await next();
  c.header(
    'Server-Timing',
    `db;dur=${counts.ms.toFixed(1)};trips=${counts.trips};stages=${counts.stages}`,
    { append: true },
  );
});
