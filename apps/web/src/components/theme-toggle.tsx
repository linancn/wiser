'use client';

import { useEffect, useState } from 'react';

import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './app-shell.module.css';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'wiser-theme';

function activeTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />
    </svg>
  );
}

export function ThemeToggle({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const restored: Theme =
      stored === 'light' || stored === 'dark' ? stored : activeTheme();
    document.documentElement.dataset.theme = restored;
    document.documentElement.style.colorScheme = restored;
    setTheme(restored);
  }, []);

  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
  const label =
    nextTheme === 'dark'
      ? dictionary.shell.themeToDark
      : dictionary.shell.themeToLight;

  function toggleTheme() {
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  return (
    <button
      className={styles.themeToggle}
      type="button"
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title={label}
      data-theme={theme}
      onClick={toggleTheme}
    >
      <span className={styles.themeTrack} aria-hidden="true">
        <span className={styles.themeOption} data-option="light">
          <SunIcon />
        </span>
        <span className={styles.themeOption} data-option="dark">
          <MoonIcon />
        </span>
        <span className={styles.themeThumb} />
      </span>
      <span className={styles.themeLabel}>{dictionary.shell.theme}</span>
    </button>
  );
}
