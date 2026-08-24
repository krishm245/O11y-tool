import { describe, expect, it } from 'vitest';
import {
  MASKED_VALUE,
  PRIVACY_POLICY_VERSION,
  isSensitiveField,
  maskText,
  sanitizeUrl,
} from './index.js';

describe(`privacy policy v${PRIVACY_POLICY_VERSION}`, () => {
  it.each([
    { type: 'password' },
    { name: 'access_token' },
    { id: 'credit-card-number' },
    { autocomplete: 'cc-csc' },
    { ariaLabel: 'API key' },
    { placeholder: 'Account number' },
  ])('recognizes a sensitive field: %j', (field) => {
    expect(isSensitiveField(field)).toBe(true);
  });

  it('does not classify ordinary fields as sensitive', () => {
    expect(
      isSensitiveField({ name: 'search', autocomplete: 'organization' }),
    ).toBe(false);
  });

  it('retains URL paths and query keys but drops values and fragments', () => {
    const secret = 'top-secret-bearer-token';
    const sanitized = sanitizeUrl(
      `https://shop.example/checkout?coupon=${secret}&step=payment#${secret}`,
    );
    expect(sanitized).toEqual({
      originPath: 'https://shop.example/checkout',
      queryKeys: ['coupon', 'step'],
    });
    expect(JSON.stringify(sanitized)).not.toContain(secret);
  });

  it('uses one stable mask marker rather than preserving value shape', () => {
    expect(MASKED_VALUE).toBe('[MASKED]');
    expect(MASKED_VALUE).not.toContain('4111111111111111');
  });

  it('removes designated DOM text before rrweb receives it', () => {
    const secret = '4111111111111111';
    const maskedElement = {
      closest: (selector: string) =>
        selector === '.o11y-mask' ? maskedElement : null,
      getAttribute: () => null,
      id: '',
    } as unknown as HTMLElement;
    const snapshotValue = maskText(secret, maskedElement);
    expect(snapshotValue).toBe(MASKED_VALUE);
    expect(JSON.stringify({ textContent: snapshotValue })).not.toContain(
      secret,
    );
  });
});
