'use client';

import { toPng } from 'html-to-image';

/**
 * Google Fonts (and other cross-origin) stylesheets throw SecurityError on
 * cssRules. Temporarily disable those sheets so html-to-image can export.
 */
function withReadableStylesheets<T>(run: () => Promise<T>): Promise<T> {
  const disabled: CSSStyleSheet[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      void sheet.cssRules;
    } catch {
      try {
        sheet.disabled = true;
        disabled.push(sheet);
      } catch {
        /* ignore */
      }
    }
  }
  return run().finally(() => {
    for (const sheet of disabled) {
      try {
        sheet.disabled = false;
      } catch {
        /* ignore */
      }
    }
  });
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.click();
}

export async function downloadNodePng(
  node: HTMLElement,
  filename: string,
): Promise<void> {
  const options = {
    cacheBust: true,
    pixelRatio: 2 as const,
    backgroundColor: undefined as string | undefined,
    // Prefer local fallback fonts; avoid fetching Google Font CSS.
    fontEmbedCSS: `
      * { font-family: Archivo, system-ui, -apple-system, sans-serif !important; }
    `,
    filter: (domNode: HTMLElement) => {
      if (domNode.tagName === 'LINK') {
        const rel = (domNode.getAttribute('rel') || '').toLowerCase();
        const href = domNode.getAttribute('href') || '';
        if (
          rel.includes('stylesheet') &&
          /fonts\.googleapis|fonts\.gstatic/i.test(href)
        ) {
          return false;
        }
      }
      return true;
    },
  };

  try {
    const dataUrl = await withReadableStylesheets(() => toPng(node, options));
    triggerDownload(dataUrl, filename);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/cssRules|SecurityError|Cannot access rules/i.test(msg)) throw err;
    const dataUrl = await withReadableStylesheets(() =>
      toPng(node, { ...options, skipFonts: true }),
    );
    triggerDownload(dataUrl, filename);
  }
}
