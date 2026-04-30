import { describe, it, expect } from 'vitest';
import { postProcess } from '../post-process';

describe('postProcess', () => {
  it('returns null for empty / whitespace-only output', () => {
    expect(postProcess('')).toBeNull();
    expect(postProcess('   \n  \t')).toBeNull();
  });

  it('strips @everyone and @here', () => {
    expect(postProcess('hello @everyone how are you')).toBe('hello how are you');
    expect(postProcess('@here look')).toBe('look');
    expect(postProcess('mid @everyone-text')).toBe('mid -text');
  });

  it('passes short text through', () => {
    expect(postProcess('all good')).toBe('all good');
  });

  it('truncates long text at the last sentence boundary under 2000', () => {
    const sentence = 'a'.repeat(50) + '. ';
    const long = sentence.repeat(60);
    const out = postProcess(long)!;
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith('.')).toBe(true);
  });

  it('hard-truncates at 2000 if no sentence boundary exists', () => {
    const long = 'x'.repeat(2500);
    const out = postProcess(long)!;
    expect(out.length).toBe(2000);
  });
});
