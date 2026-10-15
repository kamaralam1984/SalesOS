/**
 * Password weakness check shared by API and web (client hint only; the API is authoritative).
 *
 * This is NOT a breached-password service (no network call, no k-anonymity lookup): it is a bundled deny-list of very
 * common passwords and base words, plus structural checks. A hosted breach check (HIBP range API) can be added behind a
 * provider interface once egress and privacy are approved (docs/security-review.md, residual risks).
 */

// Common passwords / base words (lower case, leet-normalised, trailing digits and symbols stripped).
const COMMON_BASES = new Set([
  'password', 'passwort', 'passw0rd', 'pass', 'passcode', 'letmein', 'welcome', 'welcome1', 'qwerty', 'qwertyuiop', 'qwertyuiopasdf', 'asdfghjkl', 'asdfgh', 'zxcvbnm', 'zxcvbn',
  'iloveyou', 'ilovesales', 'admin', 'administrator', 'root', 'login', 'master', 'superman', 'batman', 'trustno', 'monkey', 'dragon', 'football', 'baseball', 'cricket', 'shadow',
  'sunshine', 'princess', 'abcdef', 'abcdefgh', 'abcdefghijkl', 'changeme', 'change', 'secret', 'secure', 'default', 'test', 'testing', 'tester', 'demo', 'sample', 'guest', 'user',
  'sales', 'salesos', 'salesteam', 'coacheasily', 'coachingos', 'coach', 'india', 'bharat', 'mumbai', 'delhi', 'pune', 'hindustan', 'jaishreeram', 'omnamahshivaya', 'krishna', 'ganesh',
  'company', 'office', 'work', 'summer', 'winter', 'spring', 'autumn', 'monsoon', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'holiday', 'internet', 'computer', 'whatever', 'freedom', 'starwars', 'pokemon', 'naruto', 'killer', 'hunter', 'ranger', 'soccer', 'hockey', 'jordan', 'michael', 'jennifer', 'charlie', 'thomas',
  'hello', 'helloworld', 'google', 'facebook', 'whatsapp', 'instagram', 'youtube', 'linkedin', 'microsoft', 'apple', 'amazon', 'flipkart', 'paytm', 'pass1234', 'p4ssword', 'p@ssword',
]);

const LEET: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '01234567890123456789', '09876543210987654321', 'zyxwvutsrqponmlkjihgfedcba'];

/** Returns a human-readable reason when the password is too guessable, otherwise null. `context` = values that must not appear in it. */
export function passwordWeakness(password: string, context: string[] = []): string | null {
  const lower = password.toLowerCase();
  if (new Set(lower).size < 6) return 'Password uses too few different characters';
  if (/(.)\1{5,}/.test(lower)) return 'Password repeats the same character too many times';
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 8 <= seq.length; i++) if (lower.includes(seq.slice(i, i + 8))) return 'Password contains an obvious keyboard or number sequence';
  }
  // normalise: drop the trailing run of digits/symbols ("Password@2026!" -> "password"), undo leet-speak, keep letters only
  const core = lower.replace(/[\d\W_]+$/, '');
  const deleet = [...core].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
  if (COMMON_BASES.has(deleet)) return 'Password is a very common word or password; choose something less guessable';
  // two common words glued together ("welcomepassword", "adminsales") are still trivially guessed
  for (const a of COMMON_BASES) {
    if (a.length >= 4 && deleet.startsWith(a) && COMMON_BASES.has(deleet.slice(a.length))) return 'Password is made of common words; choose something less guessable';
  }
  for (const raw of context) {
    const c = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c.length >= 4 && lower.replace(/[^a-z0-9]/g, '').includes(c)) return 'Password must not contain your name or email';
  }
  return null;
}
