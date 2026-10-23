import { describe, it, expect } from 'vitest';
import { resendErrorMessage } from '../src/platform/platform-settings.js';

describe('email service errors shown on screen', () => {
  it('keeps only the readable message from a JSON error reply', () => {
    const body = JSON.stringify({ message: 'Invalid `to` field. Please use our testing email address.', name: 'validation_error', statusCode: 422 });
    expect(resendErrorMessage(422, body)).toBe('Invalid `to` field. Please use our testing email address.');
  });

  it('falls back to the reply text, or the status when there is none', () => {
    expect(resendErrorMessage(502, 'Bad gateway')).toBe('Bad gateway');
    expect(resendErrorMessage(500, '')).toBe('error 500');
  });
});
