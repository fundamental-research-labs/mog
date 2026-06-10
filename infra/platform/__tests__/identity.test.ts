import { createPlatformIdentity, createTestPlatformIdentity } from '../identity';

// Helper to mock navigator properties
function withNavigator(
  overrides: { platform?: string; userAgentData?: { platform: string } | undefined },
  fn: () => void,
): void {
  const origPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
  const origUserAgentData = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');

  if (overrides.platform !== undefined) {
    Object.defineProperty(navigator, 'platform', {
      value: overrides.platform,
      configurable: true,
    });
  }

  // Always set userAgentData (even to undefined) to control the detection path
  Object.defineProperty(navigator, 'userAgentData', {
    value: overrides.userAgentData,
    configurable: true,
  });

  try {
    fn();
  } finally {
    if (origPlatform) {
      Object.defineProperty(navigator, 'platform', origPlatform);
    } else {
      // @ts-expect-error — restoring original absent state
      delete navigator.platform;
    }
    if (origUserAgentData) {
      Object.defineProperty(navigator, 'userAgentData', origUserAgentData);
    } else {
      delete navigator.userAgentData;
    }
  }
}

function withLocationSearch(search: string, fn: () => void): void {
  const originalUrl = window.location.href;
  window.history.replaceState({}, '', search);
  try {
    fn();
  } finally {
    window.history.replaceState({}, '', originalUrl);
  }
}

describe('createPlatformIdentity', () => {
  it('honors the app-eval macOS platform override before userAgentData', () => {
    withLocationSearch('/?app-eval-platform-mac', () => {
      withNavigator({ platform: 'MacIntel', userAgentData: { platform: 'Linux' } }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('macos');
      });
    });
  });

  describe('via userAgentData (modern Chromium path)', () => {
    it('detects macOS', () => {
      withNavigator({ userAgentData: { platform: 'macOS' } }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('macos');
      });
    });

    it('detects Windows', () => {
      withNavigator({ userAgentData: { platform: 'Windows' } }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('windows');
      });
    });

    it('detects Linux', () => {
      withNavigator({ userAgentData: { platform: 'Linux' } }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('linux');
      });
    });

    it('defaults unknown platform to windows', () => {
      withNavigator({ userAgentData: { platform: 'ChromeOS' } }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('windows');
      });
    });
  });

  describe('via navigator.platform (Safari/fallback path)', () => {
    it('detects macOS from MacIntel', () => {
      withNavigator({ platform: 'MacIntel', userAgentData: undefined }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('macos');
      });
    });

    it('detects macOS from MacARM', () => {
      withNavigator({ platform: 'MacARM', userAgentData: undefined }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('macos');
      });
    });

    it('detects Linux', () => {
      withNavigator({ platform: 'Linux x86_64', userAgentData: undefined }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('linux');
      });
    });

    it('detects Windows from Win32', () => {
      withNavigator({ platform: 'Win32', userAgentData: undefined }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('windows');
      });
    });

    it('defaults empty string to windows', () => {
      withNavigator({ platform: '', userAgentData: undefined }, () => {
        const id = createPlatformIdentity();
        expect(id.os).toBe('windows');
      });
    });
  });

  it('sets runtime to web when not in Tauri', () => {
    withNavigator({ platform: 'Win32', userAgentData: undefined }, () => {
      const id = createPlatformIdentity();
      expect(id.runtime).toBe('web');
    });
  });

  it('returns a frozen object', () => {
    const id = createPlatformIdentity();
    expect(Object.isFrozen(id)).toBe(true);
  });
});

describe('createTestPlatformIdentity', () => {
  it('defaults to windows/web', () => {
    const id = createTestPlatformIdentity();
    expect(id.os).toBe('windows');
    expect(id.runtime).toBe('web');
  });

  it('allows overriding os', () => {
    const id = createTestPlatformIdentity({ os: 'macos' });
    expect(id.os).toBe('macos');
    expect(id.runtime).toBe('web');
  });

  it('allows overriding runtime', () => {
    const id = createTestPlatformIdentity({ runtime: 'desktop' });
    expect(id.os).toBe('windows');
    expect(id.runtime).toBe('desktop');
  });

  it('allows overriding both', () => {
    const id = createTestPlatformIdentity({ os: 'linux', runtime: 'desktop' });
    expect(id.os).toBe('linux');
    expect(id.runtime).toBe('desktop');
  });

  it('returns a frozen object', () => {
    const id = createTestPlatformIdentity();
    expect(Object.isFrozen(id)).toBe(true);
  });
});
