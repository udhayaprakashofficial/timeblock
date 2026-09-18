export declare class CryptoService {
    private readonly key;
    constructor();
    encrypt(plaintext: string): string;
    decrypt(payload: string): string;
    /** Format: scrypt$<saltB64>$<hashB64> */
    hashPassword(password: string): string;
    verifyPassword(password: string, stored: string): boolean;
}
