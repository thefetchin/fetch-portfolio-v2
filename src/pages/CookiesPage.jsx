import PolicyLayout from '../components/PolicyLayout'

// NOTE: Plain-English boilerplate draft. The site currently uses only
// essential browser storage (local high-score for the Mogura mini-game).
// If you add analytics later (Google Analytics, PostHog, etc.), update the
// "Cookies we use" table and consider a consent banner.

const CookiesPage = () => (
  <PolicyLayout
    title="Cookie Policy"
    description="What cookies and similar browser storage thefetch.in uses today, and what would change if we add analytics in the future."
    canonical="https://thefetch.in/cookies"
    lastUpdated="2026-05-17"
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
        Right now <strong>thefetch.in</strong> doesn't run any analytics or
        advertising tracker. We use only <strong>essential</strong> browser
        storage:
      </p>
      <ul>
        <li>
          <strong>Mogura mini-game high-score</strong> — saved in your
          browser's <em>localStorage</em> under <code>fetch.mogura.best</code>{' '}
          so we can show your best score next time you play. It never leaves
          your device.
        </li>
        <li>
          <strong>Cloudflare security cookies</strong> — our host (Cloudflare)
          may set short-lived cookies to defend the site against bots and
          abuse. These are required for the site to load reliably and aren't
          used for tracking.
        </li>
      </ul>
      <p>
        We don't set any cookies that identify you personally, and we don't
        share cookie data with advertisers.
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
