import crypto from "node:crypto";

const SCRYPT_PREFIX = "scrypt";
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt);
  return `${SCRYPT_PREFIX}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [version, salt, expected] = storedHash.split("$");
  if (version !== SCRYPT_PREFIX || !salt || !expected) return false;
  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}

async function scrypt(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
