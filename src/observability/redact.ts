/**
 * Secret redaction.
 *
 * Applied at the logging boundary so secrets cannot leak even on debug paths
 * (Prompt 2 §13, §20). Any value registered with `registerSecret` is replaced
 * with a fixed marker wherever it appears in a string.
 */

const REDACTED = '[REDACTED]';
const secrets = new Set<string>();

/** Register a secret value (token, password, cookie). Empty values are ignored. */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 4) secrets.add(value);
}

/** Clears registered secrets. Test-only helper to keep tests isolated. */
export function clearSecrets(): void {
  secrets.clear();
}

/** Replaces every registered secret occurrence with [REDACTED]. */
export function redact(input: string): string {
  let out = input;
  for (const secret of secrets) {
    // Escape regex metacharacters so literal secrets are matched exactly.
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), REDACTED);
  }
  // Defensive patterns: authorization headers and common token query params.
  out = out.replace(/(authorization\s*:\s*)([^\s,;]+)/gi, `$1${REDACTED}`);
  out = out.replace(/(token=)([^&\s"']+)/gi, `$1${REDACTED}`);
  out = out.replace(/(X-Api-Key\s*:\s*)([^\s,;]+)/gi, `$1${REDACTED}`);
  out = out.replace(/(PHPSESSID=)([^;\s"']+)/gi, `$1${REDACTED}`);
  return out;
}

/** Convenience alias used by the logger. */
export const sanitize = redact;
