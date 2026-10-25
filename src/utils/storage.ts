import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely';
import type { Compilable } from 'kysely';
import type { Bindings } from '@/utils/config';

type Statement = { sql: string; parameters: SqlStorageValue[] };
type Operation =
  | { operation: 'kv:get'; key: string }
  | { operation: 'kv:put'; key: string; value: unknown }
  | { operation: 'kv:increment'; key: string }
  | { operation: 'sql'; statements: Statement[] };

export class AppStorage {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request) {
    const body = (await request.json()) as Operation;

    switch (body.operation) {
      case 'kv:get': {
        const value = await this.state.storage.get(body.key);
        return Response.json({ value });
      }

      case 'kv:put': {
        await this.state.storage.put(body.key, body.value);
        return Response.json({ value: null });
      }

      case 'kv:increment': {
        const value = await this.state.storage.transaction(async tx => {
          const next = ((await tx.get<number>(body.key)) ?? 0) + 1;
          await tx.put(body.key, next);
          return next;
        });

        return Response.json({ value });
      }

      case 'sql': {
        const value = this.state.storage.transactionSync(() =>
          body.statements.map(statement =>
            this.state.storage.sql.exec(statement.sql, ...statement.parameters).toArray(),
          ),
        );

        return Response.json({ value });
      }

      default: {
        throw new Error('unexpected operation');
      }
    }
  }
}

export const database = <DB>() =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: db => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    },
  });

const compile = (query: Compilable): Statement => {
  const { sql, parameters } = query.compile();
  return { sql, parameters: parameters as SqlStorageValue[] };
};

export const storage = (env: Bindings, namespace: string) => {
  const stub = env.STORAGE.get(env.STORAGE.idFromName(namespace));
  const send = async <T>(body: Operation): Promise<T> => {
    const result = await stub.fetch('https://storage/', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!result.ok) {
      throw new Error('Storage request failed');
    }

    return (await result.json<{ value: T }>()).value;
  };

  return {
    kv: {
      get: <T>(key: string) => send<T | undefined>({ operation: 'kv:get', key }),
      put: (key: string, value: unknown) => send<void>({ operation: 'kv:put', key, value }),
      increment: (key: string) => send<number>({ operation: 'kv:increment', key }),
    },

    sql: async <T>(query: Compilable<T>) =>
      (await send<T[][]>({ operation: 'sql', statements: [compile(query)] }))[0],

    batch: (queries: Compilable[]) =>
      send<Record<string, SqlStorageValue>[][]>({
        operation: 'sql',
        statements: queries.map(compile),
      }),
  };
};
