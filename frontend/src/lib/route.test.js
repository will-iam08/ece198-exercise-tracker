import { describe, expect, it } from 'vitest';
import { currentPortal } from './route.js';

describe('currentPortal', () => {
  it('maps paths to an entry point', () => {
    expect(currentPortal('/')).toBe('patient');
    expect(currentPortal('/doctor')).toBe('doctor');
    expect(currentPortal('/doctor/')).toBe('doctor');
    expect(currentPortal('/doctor/anything')).toBe('doctor');
    expect(currentPortal('/doctors')).toBe('patient');
    expect(currentPortal('/admin')).toBe('admin');
    expect(currentPortal('/admin/')).toBe('admin');
    expect(currentPortal('/admin/patients')).toBe('admin');
    expect(currentPortal('/administrator')).toBe('patient');
    expect(currentPortal('/doctor/admin')).toBe('doctor');
  });
});
