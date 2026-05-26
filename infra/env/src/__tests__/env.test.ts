import { getEnvVar, isDev, isProd, isTest } from '../index';

describe('@mog/env under Jest (Node fallback)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('isTest() reflects NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    expect(isTest()).toBe(true);
    expect(isDev()).toBe(false);
    expect(isProd()).toBe(false);
  });

  it('isDev() reflects NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    expect(isDev()).toBe(true);
    expect(isProd()).toBe(false);
  });

  it('isProd() reflects NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(isProd()).toBe(true);
    expect(isDev()).toBe(false);
  });

  it('getEnvVar returns undefined for missing keys', () => {
    expect(getEnvVar('__DEFINITELY_NOT_SET_XYZ__')).toBeUndefined();
  });

  it('getEnvVar returns string values for set keys', () => {
    process.env.__MOG_ENV_TEST_VAR__ = 'hello';
    try {
      expect(getEnvVar('__MOG_ENV_TEST_VAR__')).toBe('hello');
    } finally {
      delete process.env.__MOG_ENV_TEST_VAR__;
    }
  });
});
