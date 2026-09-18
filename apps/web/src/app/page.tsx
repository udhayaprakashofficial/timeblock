import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Timeblock — Plan your day, prove your hours',
  description:
    'Timeblock turns time blocks into proof of work—live timers, locked meetings, and timesheets ready for your team lead.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Timeblock — Plan your day, prove your hours',
    description:
      'The SaaS planner for scheduling by the clock and exporting hours your team lead can trust.',
    type: 'website',
    siteName: 'Timeblock',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Timeblock — Plan your day, prove your hours',
    description:
      'Schedule by time, log actual work, and download a clean timesheet whenever you need it.',
  },
  robots: { index: true, follow: true },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Timeblock',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Daily time-blocking planner with timers, effort badges, and downloadable timesheets.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  featureList: [
    'Time-based task scheduling',
    'Start/Stop time tracking',
    'Effort badges and streaks',
    'Daily timesheet export for team leads',
    'Weekly reports and end-of-day sheets',
  ],
};

/** Royalty-free Unsplash photos for non-hero sections. */
const PHOTOS = {
  focus:
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=1200&q=80',
  desk:
    'https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?auto=format&fit=crop&w=1400&q=80',
  avatars: [
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=96&h=96&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=96&h=96&q=80',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=96&h=96&q=80',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=96&h=96&q=80',
  ],
};

function AvatarStack({ extra = '+5' }: { extra?: string }) {
  return (
    <div className="landing-avatars" aria-hidden>
      {PHOTOS.avatars.slice(0, 3).map((src) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" width={28} height={28} />
      ))}
      <span>{extra}</span>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="landing-atmosphere" aria-hidden>
        <span className="landing-orb landing-orb-a" />
        <span className="landing-orb landing-orb-b" />
      </div>

      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="Timeblock home">
          <span className="landing-brand-mark" aria-hidden />
          Timeblock.
        </Link>
        <div className="landing-nav-actions">
          <Link href="/#how" className="landing-link">
            How it works
          </Link>
          <Link href="/login" className="landing-link">
            Sign in
          </Link>
          <Link href="/login" className="landing-cta landing-cta-sm">
            Get started
          </Link>
        </div>
      </header>

      <section className="landing-hero" aria-label="Introduction">
        <div className="landing-hero-mesh" aria-hidden>
          <span className="landing-mesh-ring" />
          <span className="landing-mesh-ring is-b" />
        </div>

        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <p className="landing-brand-hero">Timeblock.</p>
            <h1 className="landing-headline">
              Your day, scheduled.
              <span className="landing-headline-break">
                Your hours, undeniable.
              </span>
            </h1>
            <p className="landing-lede">
              The SaaS planner that turns time blocks into proof of work—live
              timers, locked meetings, and timesheets ready for your team lead.
            </p>
            <div className="landing-cta-row">
              <Link href="/login" className="landing-cta">
                Start free
              </Link>
              <Link href="/#how" className="landing-cta-ghost">
                See the product
              </Link>
            </div>
          </div>

          <div className="landing-hero-ui" aria-hidden>
            <div className="landing-ui-shell">
              <div className="landing-ui-top">
                <span>Today</span>
                <span className="landing-ui-live">Live</span>
              </div>
              <div className="landing-ui-track">
                <div className="landing-ui-row is-a">
                  <strong>Deep work</strong>
                  <em>09:00 – 11:00</em>
                </div>
                <div className="landing-ui-row is-b">
                  <strong>Google Meet</strong>
                  <em>11:00 – 11:30</em>
                </div>
                <div className="landing-ui-row is-c">
                  <strong>Build &amp; review</strong>
                  <em>13:00 – 15:30</em>
                </div>
                <div className="landing-ui-row is-d">
                  <strong>Learning</strong>
                  <em>16:00 – 17:00</em>
                </div>
                <div className="landing-ui-needle" />
              </div>
              <div className="landing-ui-stats">
                <div>
                  <b>72%</b>
                  <span>Utilized</span>
                </div>
                <div>
                  <b>4.6h</b>
                  <span>Tracked</span>
                </div>
                <div>
                  <b>6</b>
                  <span>Blocks</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-how landing-reveal" id="how">
        <div className="landing-how-head">
          <p className="landing-eyebrow">How it works</p>
          <h2>From empty calendar to shareable proof—in three steps</h2>
        </div>

        <div className="landing-how-stage">
          <div className="landing-how-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PHOTOS.focus}
              alt="Professional planning the day on a laptop"
            />
          </div>

          <aside className="landing-float landing-float-left" aria-hidden>
            <article className="landing-task-card">
              <header>
                <strong>Deep work block</strong>
                <span className="landing-bell" />
              </header>
              <p>Product roadmap</p>
              <footer>
                <em>9:00 – 11:00</em>
                <AvatarStack extra="+2" />
              </footer>
            </article>
            <article className="landing-task-card is-soft">
              <header>
                <strong>Google Meet sync</strong>
                <span className="landing-bell" />
              </header>
              <p>Weekly standup</p>
              <footer>
                <em>11:00 – 11:30</em>
                <AvatarStack extra="+4" />
              </footer>
            </article>
          </aside>

          <aside className="landing-float landing-float-right" aria-hidden>
            <article className="landing-progress-card">
              <span className="landing-progress-ico is-meet" />
              <div>
                <strong>Meetings</strong>
                <i style={{ ['--pct' as string]: '72%' }} />
              </div>
              <AvatarStack />
            </article>
            <article className="landing-progress-card">
              <span className="landing-progress-ico is-build" />
              <div>
                <strong>Build &amp; ship</strong>
                <i style={{ ['--pct' as string]: '54%' }} />
              </div>
              <AvatarStack extra="+3" />
            </article>
            <article className="landing-progress-card">
              <span className="landing-progress-ico is-notes" />
              <div>
                <strong>Comments</strong>
                <i style={{ ['--pct' as string]: '88%' }} />
              </div>
              <AvatarStack extra="+1" />
            </article>
          </aside>
        </div>

        <ol className="landing-step-cards">
          <li>
            <span className="landing-step-num">01</span>
            <span className="landing-step-check" aria-hidden />
            <strong>Create your account &amp; connect your calendar.</strong>
            <p>
              Sign in, set work hours, and pull Google Meet blocks into a day
              you can actually plan around.
            </p>
          </li>
          <li>
            <span className="landing-step-num">02</span>
            <span className="landing-step-check" aria-hidden />
            <strong>Block focus work. Track real minutes.</strong>
            <p>
              Drop tasks into free slots, keep meetings locked, and start/stop
              timers so actual time matches the plan.
            </p>
          </li>
          <li>
            <span className="landing-step-num">03</span>
            <span className="landing-step-check" aria-hidden />
            <strong>Export the timesheet. Keep the streak.</strong>
            <p>
              Download a daily sheet for your TL and unlock effort badges as
              focus compounds.
            </p>
          </li>
        </ol>
      </section>

      <section
        className="landing-section landing-features-block landing-reveal"
        id="features"
      >
        <div className="landing-features-intro">
          <div className="landing-feature-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PHOTOS.desk}
              alt="Hands typing on a laptop during focused work"
            />
          </div>
          <div className="landing-section-head">
            <p className="landing-eyebrow">Features</p>
            <h2>Everything after the plan—still in one place</h2>
            <p className="landing-section-lede">
              Progress signals, motivation loops, and a paper trail your
              reporting cadence already expects.
            </p>
          </div>
        </div>
        <ul className="landing-features">
          <li>
            <span className="landing-feature-mark" aria-hidden />
            <strong>Priority list + calendar</strong>
            <span>
              Drag order, locked meetings stay fixed, open slots re-pack.
            </span>
          </li>
          <li>
            <span className="landing-feature-mark" aria-hidden />
            <strong>Effort badges</strong>
            <span>
              Daily learning, streaks, and focus challenges that keep you
              honest.
            </span>
          </li>
          <li>
            <span className="landing-feature-mark" aria-hidden />
            <strong>Weekly report &amp; EOD</strong>
            <span>
              See estimated vs actual and close the day with a clear sheet.
            </span>
          </li>
          <li>
            <span className="landing-feature-mark" aria-hidden />
            <strong>Task comments</strong>
            <span>
              Leave notes on any task and revisit them on past dates.
            </span>
          </li>
        </ul>
      </section>

      <section className="landing-finale landing-reveal">
        <p className="landing-brand-hero is-compact">Timeblock.</p>
        <h2>Ship tomorrow with a schedule already waiting</h2>
        <p>
          Open your workspace, drop the first block, and keep a timesheet ready
          the moment someone asks what you did.
        </p>
        <Link href="/login" className="landing-cta">
          Get started free
        </Link>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-pulse" aria-hidden>
          <span className="landing-footer-tick" />
        </div>
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <Link href="/" className="landing-brand">
              <span className="landing-brand-mark" aria-hidden />
              Timeblock.
            </Link>
            <p>
              Schedule by time, prove your hours, and share a timesheet your
              team lead can trust.
            </p>
          </div>
          <div className="landing-footer-cols">
            <div>
              <h3>Product</h3>
              <nav aria-label="Product">
                <Link href="/#how">How it works</Link>
                <Link href="/#features">Features</Link>
                <Link href="/login">Get started</Link>
              </nav>
            </div>
            <div>
              <h3>Workspace</h3>
              <nav aria-label="Workspace">
                <Link href="/login">Sign in</Link>
                <Link href="/schedule">Schedule</Link>
                <Link href="/today">Today</Link>
              </nav>
            </div>
            <div>
              <h3>Reporting</h3>
              <nav aria-label="Reporting">
                <Link href="/timesheet">Timesheet</Link>
                <Link href="/report">Weekly report</Link>
                <Link href="/badges">Effort badges</Link>
              </nav>
            </div>
          </div>
        </div>
        <div className="landing-footer-bar">
          <span>© {new Date().getFullYear()} Timeblock</span>
          <span className="landing-footer-motto">
            Plan the day. Prove the hours.
          </span>
        </div>
      </footer>
    </div>
  );
}
