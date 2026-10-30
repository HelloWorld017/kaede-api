import { createHash, createHmac } from 'node:crypto';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { serialize } from 'node:v8';
import { z } from 'zod';

const { values } = parseArgs({
  options: {
    posts: { type: 'string' },
    comments: { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.posts || !values.comments || !values.output) {
  console.info(
    'Usage: node scripts/migrate-mongodb.ts --posts posts.json --comments comments.json --output ./data-v2\n' +
      'Requires Node.js 22.18+ and mongoexport JSON/JSONL files. Output must be empty.',
  );
  process.exit(values.help ? 0 : 1);
}
const postsPath = values.posts;
const commentsPath = values.comments;
const namespace = 'kaede-api-storage-v2';

// workerd/server/actor-id-impl.c++: SHA256(uniqueKey) is the HMAC key;
// the ID consists of HMAC(name)[0:16] followed by HMAC(first half)[0:16].
const namespaceKey = createHash('sha256').update(namespace).digest();
function storageId(name: string) {
  const first = createHmac('sha256', namespaceKey).update(name).digest().subarray(0, 16);
  const second = createHmac('sha256', namespaceKey).update(first).digest().subarray(0, 16);
  return Buffer.concat([first, second]).toString('hex');
}

const integer = z.preprocess(value => {
  if (typeof value === 'object' && value !== null) {
    const extended = value as Record<string, unknown>;
    value = extended.$numberLong ?? extended.$numberInt ?? extended.$numberDouble ?? value;
  }
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const postId = z.string().regex(/^[a-f0-9]{24}$/);
const objectId = z.union([postId, z.object({ $oid: postId }).transform(value => value.$oid)]);
const postSchema = z.object({ postId, likes: integer });
const commentSchema = z
  .object({
    _id: objectId,
    postId,
    threadId: integer.refine(value => value > 0),
    subThreadId: integer,
    author: z.string(),
    content: z.string(),
    password: z.string(),
    date: integer,
    admin: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .transform(({ _id: id, ...comment }) => ({ ...comment, id }));
type LegacyComment = z.infer<typeof commentSchema>;

async function load<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const text = (await readFile(path, 'utf8')).trim();
  const rows: unknown[] = text.startsWith('[')
    ? JSON.parse(text)
    : text
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));
  return rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      throw new Error(`${path}: document ${index + 1}: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

// Stable UUIDv5 IDs allow the same export to produce the same comment IDs.
function uuid(id: string) {
  const hash = createHash('sha1')
    .update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
    .update(`kaede-api:mongodb:${id}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main() {
  const posts = await load(postsPath, postSchema);
  const comments = await load(commentsPath, commentSchema);
  const groups = new Map<string, { likes: number; comments: LegacyComment[] }>();
  for (const post of posts) {
    if (groups.has(post.postId)) {
      throw new Error(`Duplicate post: ${post.postId}`);
    }
    groups.set(post.postId, { likes: post.likes, comments: [] });
  }
  const ids = new Set<string>();
  for (const comment of comments) {
    if (ids.has(comment.id)) {
      throw new Error(`Duplicate comment: ${comment.id}`);
    }
    ids.add(comment.id);
    if (!groups.has(comment.postId)) {
      groups.set(comment.postId, { likes: 0, comments: [] });
    }
    groups.get(comment.postId)!.comments.push(comment);
  }

  let placeholders = 0;
  const data = [...groups].map(([id, group]) => {
    const threads = new Map<number, LegacyComment[]>();
    for (const comment of group.comments) {
      if (!threads.has(comment.threadId)) {
        threads.set(comment.threadId, []);
      }
      threads.get(comment.threadId)!.push(comment);
    }
    const rows: (string | number | null)[][] = [];
    let sequence = 0;
    for (const [threadId, thread] of [...threads].sort(([a], [b]) => a - b)) {
      const roots = thread.filter(comment => comment.subThreadId === 0);
      if (roots.length > 1) {
        throw new Error(`Duplicate root: ${id}/${threadId}`);
      }
      const parent = ++sequence;
      const root = roots[0];
      const row = (comment: LegacyComment, seq: number, parentId: number | null) => [
        seq,
        uuid(comment.id),
        parentId,
        comment.author,
        comment.content,
        comment.password,
        comment.date,
        Number(comment.admin ?? false),
        Number(comment.deleted ?? false),
      ];
      if (root) {
        rows.push(row(root, parent, null));
      } else {
        // The old API could create replies without an existing parent.
        placeholders++;
        rows.push([parent, uuid(`orphan:${id}:${threadId}`), null, '', '', '', 0, 0, 1]);
      }
      for (const reply of thread
        .filter(comment => comment.subThreadId !== 0)
        .sort((a, b) => a.subThreadId - b.subThreadId || a.id.localeCompare(b.id))) {
        rows.push(row(reply, ++sequence, parent));
      }
    }
    return { id, likes: group.likes, rows };
  });

  const output = resolve(values.output!);
  const existing = await readdir(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  if (existing.length) {
    throw new Error(`Output directory must be empty: ${output}`);
  }
  const directory = join(output, namespace);
  await mkdir(directory, { recursive: true });
  for (const post of data) {
    const db = new DatabaseSync(join(directory, `${storageId(post.id)}.sqlite`));
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID;
        CREATE TABLE comments (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          threadId INTEGER,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          password TEXT NOT NULL,
          date INTEGER NOT NULL,
          admin INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX comments_thread ON comments(threadId);
      `);
      const insert = db.prepare(
        'INSERT INTO comments (sequence,id,threadId,author,content,password,date,admin,deleted) VALUES (?,?,?,?,?,?,?,?,?)',
      );
      for (const row of post.rows) {
        insert.run(...row);
      }
      // Durable Object KV uses V8's structured-clone wire format, not JSON.
      const put = db.prepare('INSERT INTO _cf_KV (key,value) VALUES (?,?)');
      put.run('likes', serialize(post.likes));
      put.run('verified', serialize(true));
      db.exec('COMMIT');
    } finally {
      // Closing also rolls back an incomplete transaction on error.
      db.close();
    }
    console.info(`Imported ${post.id}: ${post.rows.length} comments, ${post.likes} likes`);
  }
  // No alarms are imported; workerd creates metadata.sqlite on first startup.
  console.info(
    `Migrated ${data.length} posts and ${comments.length} comments to ${output}` +
      ` (${placeholders} deleted placeholders for orphan threads).`,
  );
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
