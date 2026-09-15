import bcrypt from "bcryptjs";
import { env } from "../../config/env";

/**
 * Password hashing.
 *
 * bcrypt at 12 rounds by default — tuneable per environment, because the right
 * cost is "as slow as your login endpoint can afford", which differs between a
 * laptop and production hardware.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A throwaway hash comparison, run when no user matched.
 *
 * Without it, a request for a non-existent address returns measurably faster
 * than one for a real address with a wrong password — which turns the login
 * endpoint into a user-enumeration oracle.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7xqK5VvXsQdWbCv1dTBkEIQ7uWYbZ7O";

export async function fakeVerify(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
