import GhostContentAPI from '@tryghost/content-api';
import axios from 'axios';
import { z } from 'zod';
import { ApiError } from '@/utils/route';
import { storage } from '@/utils/storage';
import type { Bindings } from '@/utils/config';

export const postParams = z.object({ postId: z.string().regex(/^[a-f0-9]{24}$/) });
export const postStorage = async (env: Bindings, postId: string) => {
  const store = storage(env, postId);
  if (!(await store.kv.get<boolean>('verified'))) {
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

    try {
      await api.posts.read({ id: postId });
    } catch (error) {
      const status = (error as { response?: { status: number } }).response?.status;
      throw new ApiError(
        status === 404 ? 'no-such-post' : 'ghost-unavailable',
        status === 404 ? 404 : 502,
      );
    }

    await store.kv.put('verified', true);
  }

  return store;
};
