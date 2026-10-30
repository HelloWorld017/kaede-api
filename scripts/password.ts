import { hashPassword } from '../src/utils/crypto.ts';

export default {
  async test(_controller: unknown, env: { PASSWORD: string }) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.PASSWORD));
    const clientHash = new Uint8Array(digest).toHex();
    console.info(await hashPassword(clientHash));
  },
};
