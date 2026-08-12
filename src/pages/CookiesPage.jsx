import PolicyLayout from '../components/PolicyLayout'

// NOTE: Plain-English boilerplate draft covering all three surfaces —
// thefetch.in, feedback.thefetch.in and admin.thefetch.in. If analytics is
// added later (Google Analytics, PostHog, etc.), update "What we use today"
// and add a consent banner before any non-essential cookie is set.

const CookiesPage = () => (
  <PolicyLayout
    title="Cookie Policy"
    description="What cookies and similar browser storage Fetch uses across thefetch.in, the Pod feedback service and the internal dashboard, and how to control them."
    canonical="https://thefetch.in/cookies"
    lastUpdated="2026-08-12"
  >
    <section>
      <p>
        This Cookie Policy explains how <strong>thefetch.in</strong> uses
        cookies and similar browser storage technologies, and how you can
        control them. It's a companion to our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </section>

    <section>
      <h2>What cookies are</h2>
      <p>
        Cookies are small files a website saves on your device so it can
        remember things between visits (whether you're logged in, your
        preferences, etc.). "Similar technologies" includes browser{' '}
        <em>localStorage</em> and <em>sessionStorage</em> — also small bits of
        data the site stores on your device.
      </p>
    </section>

    <section>
      <h2>What we use today</h2>
      <p>
        <strong>thefetch.in</strong> runs no analytics, advertising or
        cross-site tracking technology. The only browser storage in use is
        strictly necessary:
      </p>
      <ul>
        <li>
          <strong>Mogura mini-game high score</strong> — held in your browser's
          <em> localStorage</em> under <code>fetch.mogura.best</code> so we can
          show your best score next time. It never leaves your device.
        </li>
        <li>
          <strong>Cloudflare security cookies</strong> — our infrastructure
          provider may set short-lived cookies to protect the site against bots
          and abuse. These are necessary for the site to load reliably and are
          not used to track you.
        </li>
      </ul>

      <h3>On our other services</h3>
      <ul>
        <li>
          <strong>feedback.thefetch.in</strong> — the Pod feedback service sets
          no cookies of its own. If the bot-protection challenge (Cloudflare
          Turnstile) is enabled, it may set a short-lived token solely to
          confirm the submission is not automated.
        </li>
        <li>
          <strong>admin.thefetch.in</strong> — our internal dashboard sets a
          single strictly necessary session cookie
          (<code>fetch_admin_session</code>), marked HttpOnly, Secure and
          SameSite=Lax, which identifies a signed-in member of staff for seven
          days. It is not set for members of the public.
        </li>
      </ul>
      <p>
        For the wider picture of what we collect and why, see our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </section>

    <section>
      <h2>What may change later</h2>
      <p>
        As Fetch grows we may add:
      </p>
      <ul>
        <li>
          <strong>Analytics</strong> — to understand which pages people read
          and where they get stuck. If we add this, we'll switch on a cookie
          banner asking for your consent before any analytics cookie is set.
        </li>
        <li>
          <strong>Preferences</strong> — e.g. remembering whether you've
          dismissed an announcement.
        </li>
      </ul>
      <p>
        We'll update this page (and the "Last reviewed" date at the top) the
        same day any of this ships.
      </p>
    </section>

    <section>
      <h2>How to control cookies</h2>
      <p>
        You can block or delete cookies from any browser:
      </p>
      <ul>
        <li><strong>Chrome</strong> — Settings → Privacy and security → Cookies and other site data.</li>
        <li><strong>Safari</strong> — Settings → Advanced → Manage Website Data.</li>
        <li><strong>Firefox</strong> — Settings → Privacy &amp; Security → Cookies and Site Data.</li>
        <li><strong>Edge</strong> — Settings → Cookies and site permissions.</li>
      </ul>
      <p>
        Blocking the essential Cloudflare cookies may make the site harder to
        load. Clearing the Mogura high-score is harmless — you'll just start
        from zero next time you play.
      </p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>
        Questions about this policy? Email{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>.
      </p>
      <div className="policy-callout">
        <strong>Draft for legal review.</strong> This Cookie Policy is a working
        draft prepared for AIUM Tech Private Limited. Please have Indian legal
        counsel review and approve before publication.
      </div>
    </section>
  </PolicyLayout>
)

export default CookiesPage
