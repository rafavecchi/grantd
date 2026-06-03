// Generates the encryption secrets for .env. Standalone — does not import config.
import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64');
const salt = randomBytes(24).toString('base64url');

console.log('# Add these to your .env (keep them secret):\n');
console.log(`ENCRYPTION_KEYRING={"1":"${key}"}`);
console.log('ENCRYPTION_ACTIVE_KID=1');
console.log(`API_KEY_SALT=${salt}`);
