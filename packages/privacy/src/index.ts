export { PRIVACY_POLICY_VERSION } from './policy.js';
export const MASK_CLASS = 'o11y-mask';
export const BLOCK_CLASS = 'o11y-block';
export const MASKED_VALUE = '[MASKED]';
export const BLOCKED_VALUE = '[BLOCKED]';

export type FieldDescriptor = {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
};

export type SanitizedUrl = {
  originPath: string;
  queryKeys: string[];
};

const SENSITIVE_FIELD_PATTERN =
  /(?:pass(?:word|code)?|pwd|secret|token|auth|bearer|api[-_ ]?key|session|cookie|cvv|cvc|security[-_ ]?code|card[-_ ]?(?:number|no)|credit[-_ ]?card|iban|routing|account[-_ ]?number)/i;

const PAYMENT_AUTOCOMPLETE = new Set([
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
]);

export function isSensitiveField(field: FieldDescriptor): boolean {
  if ((field.type ?? '').toLowerCase() === 'password') return true;
  if (PAYMENT_AUTOCOMPLETE.has((field.autocomplete ?? '').toLowerCase())) {
    return true;
  }
  return [field.name, field.id, field.ariaLabel, field.placeholder].some(
    (value) => typeof value === 'string' && SENSITIVE_FIELD_PATTERN.test(value),
  );
}

export function describeField(element: Element): FieldDescriptor {
  return {
    type: element.getAttribute('type'),
    name: element.getAttribute('name'),
    id: element.id,
    autocomplete: element.getAttribute('autocomplete'),
    ariaLabel: element.getAttribute('aria-label'),
    placeholder: element.getAttribute('placeholder'),
  };
}

export function shouldMaskElement(element: Element | null): boolean {
  if (element === null) return false;
  return (
    element.closest(`.${MASK_CLASS}`) !== null ||
    (element.closest('input, textarea, select') !== null &&
      isSensitiveField(
        describeField(element.closest('input, textarea, select')!),
      ))
  );
}

export function sanitizeUrl(input: string, base?: string): SanitizedUrl {
  const url = new URL(input, base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Only HTTP and HTTPS URLs can be recorded');
  }
  const queryKeys: string[] = [];
  url.searchParams.forEach((_value, key) => {
    if (!queryKeys.includes(key)) queryKeys.push(key);
  });
  return {
    originPath: `${url.origin}${url.pathname}`,
    queryKeys: queryKeys.sort(),
  };
}

export function safeElementLabel(element: Element | null): string {
  if (element === null) return 'unknown';
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const type = element.getAttribute('type');
  return [tag, role, type].filter(Boolean).join(':').slice(0, 80);
}

export function maskText(text: string, element: HTMLElement | null): string {
  if (element === null || !shouldMaskElement(element)) return text;
  return text.length === 0 ? '' : MASKED_VALUE;
}
