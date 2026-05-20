import PolicyLayout from '../components/PolicyLayout'

// NOTE: Plain-English boilerplate draft. Have Indian legal counsel review
// before publishing — especially the rights, retention windows and the
// cross-border transfer language. Bracketed placeholders highlight what
// needs your input.

const PrivacyPage = () => (
  <PolicyLayout
    title="Privacy Policy"
    description="How Fetch (AIUM Tech Private Limited) collects, uses and protects personal data — contact form submissions, Fetch Pod transaction data, cookies and server logs."
    canonical="https://thefetch.in/privacy"
    lastUpdated="2026-05-17"
  >
    <section>
      <p>
        This Privacy Policy describes how <strong>AIUM Tech Private Limited</strong>,
        operating as <strong>Fetch</strong> ("we", "us" or "our"), collects, uses,
        shares and protects personal data when you visit{' '}
        <a href="https://thefetch.in/">thefetch.in</a>, contact us through the
        website, or buy something from a Fetch Pod.
      </p>
      <p>
        We follow India's Digital Personal Data Protection Act 2023 (DPDPA). If
        you live in a country covered by another law (for example, GDPR in the
        EU), those laws may also give you additional rights — see "Your rights"
        below.
      </p>
    </section>

    <section>
      <h2>Who we are</h2>
      <p>
        Fetch is a smart retail technology brand operated by AIUM Tech Private
        Limited, a company incorporated in India with its registered office at
        Lucia Mansion, Kalpane Kulshekara, Mangalore 575005, Karnataka, India.
      </p>
      <p>
        You can reach us at <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>{' '}
        or <a href="tel:+919019526185">+91 90195 26185</a>.
      </p>
    </section>

    <section>
      <h2>The data we collect</h2>

      <h3>Information you give us</h3>
      <ul>
        <li>
          <strong>Contact form.</strong> Your name, email, company (optional)
          and the message you send. Submitted via{' '}
          <a href="https://www.emailjs.com/" target="_blank" rel="noreferrer">EmailJS</a>{' '}
          and delivered to our inbox.
        </li>
        <li>
          <strong>Career applications.</strong> If you apply for a role via the
          mailto link, your email client sends us whatever you choose to share
          (name, CV, message).
        </li>
      </ul>

      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Fetch Pod transactions.</strong> When you buy something at a
          Fetch Pod, we record the SKU, time, machine ID, the amount and the
          UPI / card reference issued by the payment provider. We do not store
          your full card number or UPI ID — only the reference our payment
          partner returns.
        </li>
        <li>
          <strong>Server logs.</strong> Our hosting partner (Cloudflare) logs
          standard request metadata — IP address, user agent, timestamp,
          requested URL — for security and reliability.
        </li>
        <li>
          <strong>Cookies.</strong> See our <a href="/cookies">Cookie Policy</a>{' '}
          for the full list. Today the site uses only essential storage
          (e.g. the Mogura mini-game's local high-score).
        </li>
      </ul>
    </section>

    <section>
      <h2>How we use it</h2>
      <ul>
        <li>Reply to your enquiry or application.</li>
        <li>Process your purchase at a Fetch Pod and provide a refund if a dispense fails.</li>
        <li>Operate, secure and improve the Fetch Pods, Fetch Grid and this website.</li>
        <li>Send transactional messages (e.g. order confirmation, refund updates).</li>
        <li>Comply with legal, tax and accounting obligations under Indian law.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal data, and we do not use
        it for behavioural advertising.
      </p>
    </section>

    <section>
      <h2>Who we share it with</h2>
      <p>We share personal data only with parties that help us run Fetch:</p>
      <ul>
        <li>
          <strong>Payment processors</strong> — to authorise UPI / card
          transactions and issue refunds.
        </li>
        <li>
          <strong>Cloud and email providers</strong> — currently Cloudflare
          (hosting), EmailJS (contact form delivery), and standard email
          providers for our inbox.
        </li>
        <li>
          <strong>Distributors and brand partners</strong> — when Fetch Grid
          launches, retailers and distributors using Grid will see aggregate
          sales data for the SKUs they stock. We do not share data that
          identifies you personally with brand partners.
        </li>
        <li>
          <strong>Authorities</strong> — where we are legally required to do so
          (e.g. tax authorities, lawful information requests).
        </li>
      </ul>
    </section>

    <section>
      <h2>How long we keep it</h2>
      <ul>
        <li>Contact form messages — for as long as the conversation is open, then archived for up to <span className="policy-placeholder">[Retention: 24 months]</span> for follow-up.</li>
        <li>Transaction records — retained for the period required by Indian tax and accounting law (currently 8 years).</li>
        <li>Server logs — typically retained by Cloudflare for up to 30 days for security purposes.</li>
      </ul>
    </section>

    <section>
      <h2>Your rights</h2>
      <p>Under the DPDPA you have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Correct or update inaccurate data.</li>
        <li>Request erasure when we no longer need it.</li>
        <li>Withdraw consent for any processing that's based on consent.</li>
        <li>Nominate someone to exercise these rights if you become unable to.</li>
        <li>Raise a complaint with the Data Protection Board of India.</li>
      </ul>
      <p>
        To exercise any of these rights, email us at{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a> with the
        subject line "Privacy request". We aim to respond within 30 days.
      </p>
    </section>

    <section>
      <h2>International transfers</h2>
      <p>
        Some of our service providers (e.g. Cloudflare, EmailJS) may process
        data outside India. Where this happens, we rely on standard
        contractual safeguards and only work with providers that meet
        reasonable security standards.
      </p>
    </section>

    <section>
      <h2>Children</h2>
      <p>
        Our products and website are not directed at children under 18.
        We do not knowingly collect personal data from children under 18.
        If you believe a child has shared data with us, please contact us and
        we will delete it.
      </p>
    </section>

    <section>
      <h2>Security</h2>
      <p>
        We use industry-standard safeguards — encrypted transit (HTTPS),
        scoped access for our team, and audited cloud providers — to protect
        personal data. No system is perfectly secure; if a breach affects you,
        we will notify you and the Data Protection Board as required by law.
      </p>
    </section>

    <section>
      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The "Last reviewed" date
        above always reflects the latest revision. Material changes will be
        flagged on the site for at least 30 days.
      </p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>
        Questions about this policy? Email{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a> or
        write to AIUM Tech Private Limited, Lucia Mansion, Kalpane Kulshekara,
        Mangalore 575005.
      </p>
      <div className="policy-callout">
        <strong>Draft for legal review.</strong> This Privacy Policy is a working
        draft prepared for AIUM Tech Private Limited. Please have Indian legal
        counsel review and approve before treating it as binding.
      </div>
    </section>
  </PolicyLayout>
)

export default PrivacyPage
