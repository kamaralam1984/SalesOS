import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** argon2id with OWASP-recommended minimum cost. */
const OPTS: argon2.HashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
let dummyHash: Promise<string> | undefined;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTS);
  }
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
  /** Burn comparable CPU time for unknown users so response time does not reveal account existence. */
  async verifyDummy(plain: string): Promise<void> {
    dummyHash ??= argon2.hash('dummy-password-for-timing', OPTS);
    await argon2.verify(await dummyHash, plain).catch(() => false);
  }
}
