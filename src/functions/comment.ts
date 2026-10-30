import type { Generated, Selectable } from 'kysely';
import { z } from 'zod';
import { config } from '@/utils/config';
import { hashPassword, verifyPassword } from '@/utils/crypto';
import { postParams, postStorage } from '@/utils/post';
import type { Bindings } from '@/utils/config';
import { ApiError, response, route } from '@/utils/route';
import { database } from '@/utils/storage';

type Comment = {
  sequence: Generated<number>;
  id: string;
  threadId: number | null;
  author: string;
  content: string;
  password: string;
  date: number;
  admin: number;
  deleted: Generated<number>;
};

const db = database<{ comments: Comment }>();
const password = z.string().min(1).max(1024);
const perPage = 30;
const count = db.selectFrom('comments').select(eb => eb.fn.countAll<number>().as('count'));

async function comments(env: Bindings, postId: string) {
  const store = await postStorage(env, postId);
  await store.batch([
    db.schema
      .createTable('comments')
      .ifNotExists()
      .addColumn('sequence', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('id', 'text', c => c.notNull().unique())
      .addColumn('threadId', 'integer')
      .addColumn('author', 'text', c => c.notNull())
      .addColumn('content', 'text', c => c.notNull())
      .addColumn('password', 'text', c => c.notNull())
      .addColumn('date', 'integer', c => c.notNull())
      .addColumn('admin', 'integer', c => c.notNull())
      .addColumn('deleted', 'integer', c => c.notNull().defaultTo(0)),
    db.schema.createIndex('comments_thread').ifNotExists().on('comments').column('threadId'),
  ]);
  return store;
}

function publicComment(row: Selectable<Comment>, postId: string) {
  return {
    _id: row.id,
    postId,
    threadId: row.threadId ?? row.sequence,
    subThreadId: row.threadId === null ? 0 : row.sequence,
    author: row.author,
    content: row.content,
    date: row.date,
    ...(row.admin ? { admin: true } : {}),
    ...(row.deleted ? { deleted: true } : {}),
  };
}

export const listComments = route({
  method: 'get',
  path: '/:postId/comments',
  request: {
    params: postParams,
    query: z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1) }),
  },
  handle: async (c, { params, query }) => {
    const store = await comments(c.env, params.postId);
    const [total] = await store.sql(count);
    const rows = await store.sql(
      db
        .selectFrom('comments')
        .selectAll()
        .orderBy(eb => eb.fn.coalesce('threadId', 'sequence'))
        .orderBy('sequence')
        .limit(perPage)
        .offset((query.page - 1) * perPage),
    );

    return response({
      ok: true,
      pagination: { current: query.page, max: Math.ceil(total.count / perPage) },
      comments: rows.map(row => publicComment(row, params.postId)),
    });
  },
});

export const addComment = route({
  method: 'post',
  path: '/:postId/comments',
  request: {
    params: postParams,
    body: z.object({
      author: z.string().min(1),
      content: z.string().min(1),
      password,
      replyTo: z.coerce.number().int().positive().optional(),
    }),
  },
  handle: async (c, { params, body }) => {
    const limits = config(c.env);

    if (body.author.length > limits.maxAuthor) {
      throw new ApiError('invalid-author');
    }

    if (body.content.length > limits.maxContent) {
      throw new ApiError('invalid-content');
    }

    const store = await comments(c.env, params.postId);
    const hashed = await hashPassword(body.password);
    const admin = Number(await verifyPassword(c.env.ADMIN_PASSWORD, body.password));
    const parent = db
      .selectFrom('comments')
      .select('id')
      .where('sequence', '=', body.replyTo ?? 0)
      .where('threadId', 'is', null)
      .where('deleted', '=', 0);

    const [created] = await store.sql(
      db
        .insertInto('comments')
        .columns(['id', 'threadId', 'author', 'content', 'password', 'date', 'admin'])
        .expression(
          db
            .selectNoFrom(eb => [
              eb.val(crypto.randomUUID()).as('id'),
              eb.val(body.replyTo ?? null).as('threadId'),
              eb.val(body.author).as('author'),
              eb.val(body.content).as('content'),
              eb.val(hashed).as('password'),
              eb.val(Date.now()).as('date'),
              eb.val(admin).as('admin'),
            ])
            .$if(limits.maxCount > 0, qb => qb.where(eb => eb(count, '<', limits.maxCount)))
            .$if(body.replyTo !== undefined, qb => qb.where(eb => eb.exists(parent))),
        )
        .returningAll(),
    );

    if (!created) {
      const [total] = await store.sql(count);
      if (limits.maxCount > 0 && total.count >= limits.maxCount) {
        throw new ApiError('too-many-comments');
      }

      throw new ApiError('no-such-comment', 404);
    }

    return response({ ok: true, comment: publicComment(created, params.postId) });
  },
});

export const deleteComment = route({
  method: 'delete',
  path: '/:postId/comments/:commentId',
  request: { params: postParams.extend({ commentId: z.uuid() }), body: z.object({ password }) },
  handle: async (c, { params, body }) => {
    const store = await comments(c.env, params.postId);
    const target = db
      .selectFrom('comments')
      .selectAll()
      .where('id', '=', params.commentId)
      .where('deleted', '=', 0);

    const [comment] = await store.sql(target);
    if (!comment) {
      throw new ApiError('no-such-comment', 404);
    }

    if (
      !(await verifyPassword(c.env.ADMIN_PASSWORD, body.password)) &&
      !(await verifyPassword(comment.password, body.password))
    ) {
      throw new ApiError('invalid-password');
    }

    const [changed, removed] = await store.batch([
      comment.threadId === null
        ? db
            .updateTable('comments')
            .set({ author: '', content: '', password: '', admin: 0, deleted: 1 })
            .where('id', '=', comment.id)
            .where('deleted', '=', 0)
            .returning('id')
        : db.deleteFrom('comments').where('id', '=', comment.id).returning('id'),

      db
        .deleteFrom('comments')
        .where('deleted', '=', 1)
        .where(eb =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('comments as reply')
                .select('reply.id')
                .whereRef('reply.threadId', '=', 'comments.sequence'),
            ),
          ),
        )
        .returning('id'),
    ]);

    if (!changed.length) {
      throw new ApiError('no-such-comment', 404);
    }

    const deleted = [...(comment.threadId === null ? [] : changed), ...removed].map(row => row.id);

    return response({
      ok: true,
      ...(deleted.includes(comment.id) ? {} : { candidates: comment.id }),
      deleted,
    });
  },
});
