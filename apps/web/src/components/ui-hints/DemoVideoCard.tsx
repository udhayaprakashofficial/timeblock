'use client';

import { demoVideoUrl, HINTS, resetDismissedHints } from './hints';

function embedSrc(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
      const parts = u.pathname.split('/');
      const embedIdx = parts.indexOf('embed');
      if (embedIdx >= 0 && parts[embedIdx + 1]) {
        return `https://www.youtube.com/embed/${parts[embedIdx + 1]}`;
      }
    }
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Settings “Learn Cupkey” card — embeds when NEXT_PUBLIC_DEMO_VIDEO_URL is set. */
export function DemoVideoCard() {
  const tip = HINTS['demo.video'];
  const url = demoVideoUrl();
  const embed = url ? embedSrc(url) : null;

  return (
    <section className="settings-panel settings-demo">
      <div className="settings-panel-head is-plain">
        <div>
          <p className="settings-kicker">Learn</p>
          <h2 className="settings-panel-title">{tip.title}</h2>
          <p className="settings-meta">{tip.body}</p>
        </div>
      </div>

      <div className="demo-video-card">
        {embed ? (
          <div className="demo-video-frame">
            <iframe
              src={embed}
              title="Cupkey demo video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="demo-video-poster" role="img" aria-label="Demo video coming soon">
            <span className="demo-video-mark" aria-hidden>
              ▶
            </span>
            <div className="demo-video-poster-copy">
              <strong>Demo video coming soon</strong>
              <p>The walkthrough will play here when the recording is ready.</p>
            </div>
          </div>
        )}
      </div>

      <div className="settings-panel-actions">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => {
            resetDismissedHints();
            window.location.reload();
          }}
        >
          Show tips again
        </button>
      </div>
    </section>
  );
}
