import argon2 from 'argon2'

export const hashPassword = async (password: string): Promise<string> => {
  return argon2.hash(password, {
    type: argon2.argon2id,
  })
}

export const verifyPassword = async (
  password: string,
  passwordHash: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | null = null

/**
 * A real argon2 hash of a random value, cached. Verify against this when a
 * login has no matching user so the response takes the same time either way
 * (timing-based account enumeration).
 */
export const getDummyHash = (): Promise<string> => {
  if (!dummyHash) {
    dummyHash = argon2.hash(
      `no-such-user-${Math.random()}`,
      { type: argon2.argon2id },
    )
  }
  return dummyHash
}