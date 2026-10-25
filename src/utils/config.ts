export type Bindings = {
  STORAGE: DurableObjectNamespace;
  GHOST_URL: string;
  GHOST_KEY: string;
  CORS_ORIGIN?: string | null;
  ADMIN_PASSWORD?: string | null;
  COMMENTS_MAX_COUNT?: string | null;
  COMMENTS_MAX_AUTHOR?: string | null;
  COMMENTS_MAX_CONTENT?: string | null;
};

export const config = (env: Bindings) => ({
  maxCount: Number(env.COMMENTS_MAX_COUNT || 10000),
  maxAuthor: Number(env.COMMENTS_MAX_AUTHOR || 32),
  maxContent: Number(env.COMMENTS_MAX_CONTENT || 1500),
});
