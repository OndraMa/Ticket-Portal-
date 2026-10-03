// Run only in a private terminal, never in GitHub Actions logs.
// node secrets.mjs prints values to enter in Cloudflare Settings / Variables and Secrets.
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
const io=createInterface({input:process.stdin,output:process.stdout});
console.log('Use a temporary private terminal; the following password input is visible.');
const password=await io.question('New shared portal password (at least 14 characters): ');
io.close();
if(password.length<14) throw new Error('Use at least 14 characters.');
const salt=randomBytes(16);
console.log('PORTAL_PASSWORD_HASH='+salt.toString('base64')+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64'));
console.log('SESSION_SECRET='+randomBytes(32).toString('base64'));
console.log('TOKEN_ENCRYPTION_KEY='+randomBytes(32).toString('base64'));
console.log('ADMIN_SETUP_KEY='+randomBytes(32).toString('base64url'));
