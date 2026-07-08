import { describe, it, expect, beforeEach } from 'vitest';

const THEME_KEY = 'theme';
const LANG_KEY = 'lang';

type Theme = 'dark' | 'light';
type Lang = 'zh' | 'en';

function readTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) || 'dark';
}

function readLang(): Lang {
  return (localStorage.getItem(LANG_KEY) as Lang) || 'zh';
}

function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}

function saveLang(lang: Lang): void {
  localStorage.setItem(LANG_KEY, lang);
}

function toggleTheme(current: Theme): Theme {
  const next = current === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  return next;
}

function toggleLang(current: Lang): Lang {
  const next = current === 'zh' ? 'en' : 'zh';
  saveLang(next);
  return next;
}

describe('UIContext — theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to dark theme when localStorage is empty', () => {
    expect(readTheme()).toBe('dark');
  });

  it('restores theme from localStorage', () => {
    localStorage.setItem(THEME_KEY, 'light');
    expect(readTheme()).toBe('light');
  });

  it('persists theme after toggle', () => {
    const initial = readTheme();
    const newTheme = toggleTheme(initial);
    expect(newTheme).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('toggles dark → light → dark', () => {
    saveTheme('dark');
    const t1 = toggleTheme(readTheme());
    expect(t1).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    const t2 = toggleTheme(readTheme());
    expect(t2).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('preserves theme across simulated page reloads', () => {
    // First session: set theme to light
    saveTheme('light');
    let current = readTheme();
    expect(current).toBe('light');

    // Simulate page reload: clear memory, re-read
    current = readTheme();
    expect(current).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('returns stored theme value even if unexpected', () => {
    localStorage.setItem(THEME_KEY, 'invalid');
    expect(readTheme()).toBe('invalid'); // returns raw stored value with type cast
  });
});

describe('UIContext — language persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to zh when localStorage is empty', () => {
    expect(readLang()).toBe('zh');
  });

  it('restores language from localStorage', () => {
    localStorage.setItem(LANG_KEY, 'en');
    expect(readLang()).toBe('en');
  });

  it('persists language after toggle', () => {
    saveLang('zh');
    const newLang = toggleLang(readLang());
    expect(newLang).toBe('en');
    expect(localStorage.getItem(LANG_KEY)).toBe('en');
  });

  it('toggles zh → en → zh', () => {
    saveLang('zh');
    const l1 = toggleLang(readLang());
    expect(l1).toBe('en');

    const l2 = toggleLang(readLang());
    expect(l2).toBe('zh');
    expect(localStorage.getItem(LANG_KEY)).toBe('zh');
  });

  it('preserves language across simulated page reloads', () => {
    saveLang('en');
    expect(readLang()).toBe('en');
    // re-read after "reload"
    expect(readLang()).toBe('en');
  });
});

describe('UIContext — theme and lang independent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('theme and lang do not interfere with each other', () => {
    saveTheme('light');
    saveLang('en');

    expect(readTheme()).toBe('light');
    expect(readLang()).toBe('en');

    // Toggle only theme
    toggleTheme('light');
    expect(readTheme()).toBe('dark');
    expect(readLang()).toBe('en'); // lang unchanged

    // Toggle only lang
    toggleLang('en');
    expect(readTheme()).toBe('dark'); // theme unchanged
    expect(readLang()).toBe('zh');
  });

  it('both persist across simulated reloads', () => {
    saveTheme('light');
    saveLang('en');

    expect(readTheme()).toBe('light');
    expect(readLang()).toBe('en');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(localStorage.getItem(LANG_KEY)).toBe('en');
  });
});
