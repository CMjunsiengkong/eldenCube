import { describe, expect, it } from 'vitest';
import config from '../vite.config';

// ARCHITECTURE.md §7: the build must work from CloudFront's root and from a local folder.
describe('vite config', () => {
  it('uses relative base, es2022 target and the documented ports', () => {
    expect(config.base).toBe('./');
    expect(config.build?.target).toBe('es2022');
    expect(config.server?.port).toBe(5173);
    expect(config.preview?.port).toBe(4173);
    expect(config.test?.environment).toBe('node');
  });
});
