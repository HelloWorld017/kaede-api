import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../src/utils/crypto.ts';

const input = createInterface({ input: process.stdin, output: process.stderr });
try {
  const password = await input.question('Admin password (input is visible): ');
  const clientHash = createHash('sha256').update(password).digest('hex');
  console.info(await hashPassword(clientHash));
} finally {
  input.close();
}
