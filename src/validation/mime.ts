/**
 * MIME decoding helpers.
 *
 * Providers return raw SMTP payloads that have usually been transformed in
 * transit (relays commonly convert plain text to HTML, add tracking pixels, and
 * apply quoted-printable or base64 transfer encoding). Comparing rendered text
 * against a raw payload without decoding produced a FALSE `BODY_MISMATCH` in a
 * real run — the harness, not the provider, was at fault.
 *
 * These helpers normalise a payload enough to answer the only question that
 * matters: is the expected content present?
 */

/** Removes quoted-printable soft line breaks ("=" at end of line). */
export function unwrapSoftLineBreaks(input: string): string {
  return input.replace(/=\r?\n/g, '');
}

/** Decodes quoted-printable escape sequences (=3D, =C3=A9, ...). */
export function decodeQuotedPrintable(input: string): string {
  const unwrapped = unwrapSoftLineBreaks(input);
  const bytes: number[] = [];
  for (let i = 0; i < unwrapped.length; i += 1) {
    const ch = unwrapped[i] as string;
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(unwrapped.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(unwrapped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Decodes base64 (used when a relay chooses base64 transfer encoding). */
export function decodeBase64(input: string): string {
  try {
    return Buffer.from(input.replace(/\s+/g, ''), 'base64').toString('utf8');
  } catch {
    return input;
  }
}

/**
 * Splits a raw MIME-ish payload into its header block and body, and separates a
 * decoded text view from an HTML view.
 *
 * Deliberately lenient: this is not a full MIME parser. It extracts enough to
 * validate content and to report text vs. HTML honestly.
 */
export interface DecodedPayload {
  readonly headers: Record<string, string>;
  readonly rawBody: string;
  /** Decoded, HTML-stripped text (best effort). */
  readonly textView: string;
  /** Decoded HTML if the payload looks like HTML, else null. */
  readonly htmlView: string | null;
}

export function decodePayload(raw: string): DecodedPayload {
  const separator = raw.search(/\r?\n\r?\n/);
  const headerBlock = separator === -1 ? '' : raw.slice(0, separator);
  const bodyRaw = separator === -1 ? raw : raw.slice(separator + (raw.match(/\r?\n\r?\n/)?.[0].length ?? 2));

  const headers: Record<string, string> = {};
  for (const line of headerBlock.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!(key in headers)) headers[key] = line.slice(idx + 1).trim();
  }

  const cte = (headers['content-type'] ?? '');
  const encoding = (headers['content-transfer-encoding'] ?? '').toLowerCase();
  let body = bodyRaw;
  if (encoding.includes('base64')) body = decodeBase64(bodyRaw);
  else if (encoding.includes('quoted-printable')) body = decodeQuotedPrintable(bodyRaw);
  else body = unwrapSoftLineBreaks(bodyRaw);

  // A payload is treated as HTML if the Content-Type says so or it looks like HTML.
  const isHtml = cte.toLowerCase().includes('text/html') || /<html[\s>]|<body[\s>]|<br\s*\/?>|<p[\s>]/i.test(body);

  return {
    headers,
    rawBody: body,
    textView: isHtml ? htmlToText(body) : body,
    htmlView: isHtml ? body : null,
  };
}

/**
 * Converts HTML to comparable plain text: strips tags, decodes entities, and
 * collapses whitespace. Not a renderer — just enough to check content presence.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    // Block-level tags become spaces so words do not run together.
    .replace(/<(br|p|div|tr|li|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
