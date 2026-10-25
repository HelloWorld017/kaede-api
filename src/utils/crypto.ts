async function derive(password: string, salt: Uint8Array, iterations: number, bytes = 32) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      bytes * 8,
    ),
  );
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256:100000:${salt.toBase64()}:${(await derive(password, salt, 100000)).toBase64()}`;
}

export async function verifyPassword(stored: string | null | undefined, password: string) {
  if (!stored) {
    return false;
  }

  const parts = stored.split(':');
  const legacy = parts.length === 2;
  const [salt, expected] = legacy ? parts : parts.slice(2);
  const iterations = legacy ? 10000 : Number(parts[1]);
  if (
    !salt ||
    !expected ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 1000000 ||
    (!legacy && parts[0] !== 'pbkdf2-sha256')
  ) {
    return false;
  }

  try {
    const target = Uint8Array.fromBase64(expected);
    const actual = await derive(
      legacy ? password.slice(0, 32) : password,
      Uint8Array.fromBase64(salt),
      iterations,
      target.length,
    );

    return actual.reduce((diff, byte, index) => diff | (byte ^ target[index]!), 0) === 0;
  } catch {
    return false;
  }
}
