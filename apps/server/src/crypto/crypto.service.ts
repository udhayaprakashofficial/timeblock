import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.TOKEN_ENCRYPTION_KEY ?? 'dev-encryption-key-change-me';
    this.key = scryptSync(secret, 'timeblock-salt', 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** Format: scrypt$<saltB64>$<hashB64> */
  hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const actual = scryptSync(password, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
