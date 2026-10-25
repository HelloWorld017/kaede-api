import { postParams, postStorage } from '@/utils/post';
import { response, route } from '@/utils/route';

export const getPost = route({
  method: 'get',
  path: '/:postId',
  request: { params: postParams },
  handle: async (c, { params }) => {
    const store = await postStorage(c.env, params.postId);
    return response({
      ok: true,
      postId: params.postId,
      likes: (await store.kv.get<number>('likes')) ?? 0,
    });
  },
});

export const getLikes = route({
  method: 'get',
  path: '/:postId/likes',
  request: { params: postParams },
  handle: async (c, { params }) => {
    const store = await postStorage(c.env, params.postId);
    return response({ ok: true, likes: (await store.kv.get<number>('likes')) ?? 0 });
  },
});

export const addLike = route({
  method: 'post',
  path: '/:postId/likes',
  request: { params: postParams },
  handle: async (c, { params }) => {
    const store = await postStorage(c.env, params.postId);
    return response({ ok: true, likes: await store.kv.increment('likes') });
  },
});
