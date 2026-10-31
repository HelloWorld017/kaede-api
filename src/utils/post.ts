import GhostContentAPI from '@tryghost/content-api';
import axios from 'axios';
import { z } from 'zod';
import { ApiError } from '@/utils/route';
import { database, storage } from '@/utils/storage';
import type { Bindings } from '@/utils/config';

export const postParams = z.object({ postId: z.string().regex(/^[a-f0-9]{24}$/) });
type Post = {
  uniqueId: string;
  id: string;
  slug: string | null;
};
const db = database<{ posts: Post }>();

export const postStorage = async (env: Bindings, postId: string) => {
  const posts = storage(env, 'posts');
  await posts.sql(
    db.schema
      .createTable('posts')
      .ifNotExists()
      .addColumn('uniqueId', 'text', c => c.notNull().primaryKey())
      .addColumn('id', 'text', c => c.notNull().unique())
      .addColumn('slug', 'text', c => c.unique()),
  );

  const [saved] = await posts.sql(db.selectFrom('posts').selectAll().where('id', '=', postId));

  if (!env.GHOST_URL || !env.GHOST_KEY) {
    throw new ApiError('ghost-not-configured', 503);
  }

  const api = new GhostContentAPI({
    url: env.GHOST_URL.replace(/\/$/, ''),
    key: env.GHOST_KEY,
    version: 'v6.0',
    makeRequest: options =>
      axios({
        ...options,
        adapter: 'fetch',
        fetchOptions: { cache: 'no-store' },
        timeout: 10000,
      }),
  });

  let post;
  try {
    post = await api.posts.read({ id: postId });
  } catch (error) {
    const status = (error as { response?: { status: number } }).response?.status;
    throw new ApiError(
      status === 404 ? 'no-such-post' : 'ghost-unavailable',
      status === 404 ? 404 : 502,
    );
  }

  const uniqueId = saved ? saved.uniqueId : crypto.randomUUID();
  const [row] = await posts.sql(
    db
      .insertInto('posts')
      .values({ uniqueId, id: postId, slug: post.slug })
      .onConflict(oc =>
        oc.doUpdateSet({
          id: postId,
          slug: post.slug,
        }),
      )
      .returning('uniqueId'),
  );

  return storage(env, row.uniqueId);
};
