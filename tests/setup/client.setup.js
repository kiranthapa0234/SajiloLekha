/**
 * Per-file client setup.
 *
 * Registers the jest-dom matchers, then replaces the pieces of the browser that
 * jsdom does not implement but the app genuinely depends on. Each polyfill is
 * added only because something in `client/src` calls it; none is speculative.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * `ResizeObserver` is used by Recharts to size its responsive container.
 * jsdom has no layout engine, so it must be stubbed or every chart test throws.
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * `matchMedia` drives `prefers-reduced-motion`. Without this, any component
 * reading it throws "window.matchMedia is not a function".
 */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/** jsdom implements neither of these; both are used by the upload field. */
if (!window.scrollTo) window.scrollTo = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

/**
 * Recharts measures text with a canvas context. jsdom returns null from
 * getContext, which makes every axis render a crash rather than a blank chart.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => ({
    font: '',
    fillText() {},
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    scale() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    translate() {},
    rotate() {},
    setTransform() {},
    clearRect() {},
    rect() {},
    clip() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: [] }),
    putImageData() {},
    canvas: null,
  });
}