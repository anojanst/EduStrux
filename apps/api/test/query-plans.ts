import { createDb } from '@edustrux/db';
import { env } from 'cloudflare:workers';
import type { OrgCtx } from '../src/db/scope';

/** A repository call to take the plan of, e.g. `(ctx) => people.studentNames(ctx, IDS)`. */
export type Send = (ctx: OrgCtx) => unknown;

type Sent = { sql: string; params: unknown[] };

/** `env.DB`, noting every statement on its way through. Each one still runs. */
function recording(d1: D1Database, sent: Sent[]): D1Database {
  return {
    prepare(sql: string) {
      const statement = d1.prepare(sql);
      return {
        bind(...params: unknown[]) {
          sent.push({ sql, params });
          return statement.bind(...params);
        },
      };
    },
    batch: (statements: D1PreparedStatement[]) => d1.batch(statements),
  } as unknown as D1Database;
}

/**
 * The plan SQLite picks for the statement a repository call sends, one step per line. It is the
 * SQL and the values the code really sends, explained on the database the migrations build,
 * which has no table statistics, as in production.
 *
 * The call must send one statement. The audit row a write adds isn't counted.
 */
export async function planOf(send: Send): Promise<string> {
  const sent: Sent[] = [];
  await send({ db: createDb(recording(env.DB, sent)), orgId: 'org_plans', actorUserId: null });

  const statements = sent.filter(({ sql }) => !sql.startsWith('insert into "audit_log"'));
  if (statements.length !== 1) {
    throw new Error(
      `Expected one statement, got ${statements.length}:\n${statements.map((s) => s.sql).join('\n')}`,
    );
  }
  const { sql, params } = statements[0]!;
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return results.map((step) => step.detail).join('\n');
}

/**
 * Matches a plan that reaches `table` through an index on `column`: the ids of a lookup, or the
 * filter of a list. `SEARCH students USING INDEX students_org_family_idx (org_id=?)` reaches
 * students by the org alone, so it doesn't match `family_id`.
 */
export function searchBy(table: string, column: string): RegExp {
  return new RegExp(
    `^SEARCH ${table} USING (COVERING )?INDEX \\S+ \\((.* AND )?${column}=\\?`,
    'm',
  );
}

/** Matches a plan that reads `table` along `index`. */
export function searchIn(table: string, index: string): RegExp {
  return new RegExp(`^SEARCH ${table} USING (COVERING )?INDEX ${index} \\(`, 'm');
}

/** The step SQLite adds when no index gives the rows in the order asked for. */
export const SORT = 'USE TEMP B-TREE FOR ORDER BY';

/**
 * Matches a plan with a step that reads every row an org has in a table: it scans the table, or
 * enters an index by the org alone. A page with no filter does that on purpose, along the index
 * that holds its order, so check this only where every table should be reached by ids.
 */
export const READS_AN_ORG =
  /^(SCAN (?!json_each)\w+|SEARCH \w+ USING (COVERING )?INDEX \S+ \(org_id=\?\))/m;
