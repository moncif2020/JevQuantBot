import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Global resilience handler to isolate external browser extensions and benign runtime notices
if (typeof window !== 'undefined') {
  const isIgnorableExtensionOrBenignError = (
    message?: string,
    filename?: string,
    stack?: string,
    reason?: any
  ): boolean => {
    const text = [
      message,
      filename,
      stack,
      typeof reason === 'string' ? reason : reason?.message,
      typeof reason === 'object' && reason !== null ? JSON.stringify(reason) : '',
    ]
      .filter(Boolean)
      .join(' ');

    // 1. External Chrome / Browser Extension injected script errors (e.g., wallet, translators, ad blockers)
    if (
      text.includes('chrome-extension://') ||
      text.includes('moz-extension://') ||
      text.includes('safari-extension://') ||
      text.includes('injectedScript') ||
      text.includes('Could not establish connection. Receiving end does not exist') ||
      text.includes('The message port closed before a response was received') ||
      text.includes('Extension context invalidated')
    ) {
      return true;
    }

    // 2. Benign chart and observer events
    if (
      text.includes('Object is disposed') ||
      text.includes('ResizeObserver loop') ||
      text.includes('ResizeObserver loop completed with undelivered notifications')
    ) {
      return true;
    }

    // 3. Empty object rejections / errors (e.g. error: {})
    if (
      (reason && typeof reason === 'object' && Object.keys(reason).length === 0 && !reason.message) ||
      text.trim() === '{}' ||
      text.trim() === 'error: {}'
    ) {
      return true;
    }

    return false;
  };

  // Intercept window.onerror
  const originalOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    if (
      isIgnorableExtensionOrBenignError(
        typeof message === 'string' ? message : '',
        source,
        error?.stack
      )
    ) {
      return true; // suppresses the error from browser reporting
    }
    if (originalOnError) {
      return originalOnError.apply(this, [message, source, lineno, colno, error]);
    }
    return false;
  };

  // Capture phase error event
  window.addEventListener(
    'error',
    (event) => {
      if (
        isIgnorableExtensionOrBenignError(
          event.message,
          event.filename,
          event.error?.stack
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    },
    true
  );

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (
      isIgnorableExtensionOrBenignError(
        undefined,
        undefined,
        event.reason?.stack,
        event.reason
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
