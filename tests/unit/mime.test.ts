import { describe, it, expect } from 'vitest';
import {
  unwrapSoftLineBreaks,
  decodeQuotedPrintable,
  htmlToText,
  decodePayload,
} from '../../src/validation/mime.js';
import { validateContent } from '../../src/validation/validate.js';

describe('unwrapSoftLineBreaks', () => {
  it('joins a quoted-printable soft line break', () => {
    expect(unwrapSoftLineBreaks('message=\r\n generated')).toBe('message generated');
    expect(unwrapSoftLineBreaks('message=\n generated')).toBe('message generated');
  });
});

describe('decodeQuotedPrintable', () => {
  it('decodes =3D to "="', () => {
    expect(decodeQuotedPrintable('a=3Db')).toBe('a=b');
  });

  it('decodes UTF-8 byte sequences', () => {
    // =C3=A9 is é
    expect(decodeQuotedPrintable('caf=C3=A9')).toBe('café');
  });

  it('unwraps soft breaks before decoding', () => {
    expect(decodeQuotedPrintable('This is a synthetic benchmark message=\r\n generated'))
      .toBe('This is a synthetic benchmark message generated');
  });
});

describe('htmlToText', () => {
  it('strips tags and keeps the words', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('separates words across block tags so they do not run together', () => {
    expect(htmlToText('one<br/>two')).toBe('one two');
  });

  it('decodes entities', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"');
  });

  it('removes comments such as tracking pixel wrappers', () => {
    // A comment becomes a separator space so adjacent words cannot run together.
    expect(htmlToText('start<!--[if mso]><img src="x" /><![endif]-->end')).toBe('start end');
  });
});

describe('decodePayload', () => {
  it('splits headers from the body', () => {
    const decoded = decodePayload('Subject: hi\r\nX-Test: 1\r\n\r\nbody here');
    expect(decoded.headers['subject']).toBe('hi');
    expect(decoded.headers['x-test']).toBe('1');
    expect(decoded.rawBody).toBe('body here');
  });

  it('recognises an HTML payload and produces a text view', () => {
    const decoded = decodePayload(
      'Content-Type: text/html\r\n\r\n<html><body><p>Hello world</p></body></html>',
    );
    expect(decoded.htmlView).not.toBeNull();
    expect(decoded.textView).toContain('Hello world');
  });

  it('leaves a plain-text payload as text', () => {
    const decoded = decodePayload('Content-Type: text/plain\r\n\r\njust text');
    expect(decoded.htmlView).toBeNull();
    expect(decoded.textView).toBe('just text');
  });
});

/**
 * Regression: a REAL run produced BODY_MISMATCH because a relay converted the
 * message to HTML + quoted-printable. The harness was at fault, not the provider.
 */
describe('regression: relay-transformed body must not be a false mismatch', () => {
  // The generator's body is a sentence plus a correlation line. A relay may
  // inject its own text between them, so the assertion targets the correlation
  // marker and the leading sentence separately — which is what a real
  // verification actually needs.
  const expected = {
    subject: 'EBM-BENCH ascii [EBM-real-1-s1-abc]',
    text: 'This is a synthetic benchmark message generated for QA verification.',
  };

  it('passes when the body arrives as quoted-printable HTML with tracking pixels', () => {
    const relayBody =
      '<html><head></head><body><!--[if mso]> <img src="https://track.example/x" /> <![endif]-->' +
      'This is a synthetic benchmark message=\r\n generated for QA verification. It contains no personal or confidential dat=\r\n' +
      'a.<br/><br/>Correlation: EBM-real-1-s1-abc<br/><br/></body></html>\r\n';

    const result = validateContent({
      mode: 'normalized',
      expected,
      actual: { subject: expected.subject, textBody: relayBody, htmlBody: null },
      correlationId: 'EBM-real-1-s1-abc',
      recipient: 'box@maildrop.cc',
    });

    expect(result.differences).toEqual([]);
    expect(result.status).toBe('PASS');
    expect(result.correlationFoundInBody).toBe(true);
  });

  it('still fails when the content genuinely differs', () => {
    const result = validateContent({
      mode: 'normalized',
      expected,
      actual: {
        subject: expected.subject,
        textBody: '<html><body><p>Completely different content</p></body></html>',
        htmlBody: null,
      },
      correlationId: 'EBM-real-1-s1-abc',
      recipient: 'box@maildrop.cc',
    });
    expect(result.status).toBe('FAIL');
  });

  it('still fails when the correlation id is absent', () => {
    const result = validateContent({
      mode: 'normalized',
      expected,
      actual: {
        subject: 'Some other subject',
        textBody: 'Unrelated body with no identifier',
        htmlBody: null,
      },
      correlationId: 'EBM-real-1-s1-abc',
      recipient: 'box@maildrop.cc',
    });
    expect(result.status).toBe('FAIL');
    expect(result.correlationFoundInBody).toBe(false);
  });
});
