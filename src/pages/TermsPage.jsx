import PolicyLayout from '../components/PolicyLayout'

// NOTE: Plain-English boilerplate draft. Have Indian legal counsel review
// before publishing — especially the limitation of liability, indemnity and
// jurisdiction clauses. Bracketed placeholders highlight what needs input.

const TermsPage = () => (
  <PolicyLayout
    title="Terms of Service"
    description="Terms that govern your use of the Fetch website, Fetch Pods (vending machines) and Fetch Grid early-access materials. Operated by AIUM Tech Private Limited."
    canonical="https://thefetch.in/terms"
    lastUpdated="2026-05-17"
  >
    <section>
      <p>
        These Terms of Service ("Terms") govern your use of{' '}
        <a href="https://thefetch.in/">thefetch.in</a>, our connected vending
        machines (<strong>Fetch Pods</strong>), and any early-access materials
        we share for <strong>Fetch Grid</strong>. By using any of these, you
        agree to these Terms.
      </p>
    </section>

    <section>
      <h2>1. About us</h2>
      <p>
        Fetch is operated by <strong>AIUM Tech Private Limited</strong>, a
        company incorporated in India with registered office at Lucia Mansion,
        Kalpane Kulshekara, Mangalore 575005, Karnataka. References to "Fetch",
        "we", "us" or "our" in these Terms mean AIUM Tech Private Limited.
      </p>
    </section>

    <section>
      <h2>2. Acceptance of these Terms</h2>
      <p>
        Using the website or making a purchase at a Fetch Pod means you accept
        these Terms. If you don't agree to any part, please stop using our
        services.
      </p>
      <p>
        You must be at least 18 years old (or have the consent of a parent or
        guardian) to use Fetch services that involve payment.
      </p>
    </section>

    <section>
      <h2>3. Using the website</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the site in a way that breaks any law or these Terms.</li>
        <li>Attempt to gain unauthorised access to our systems or data.</li>
        <li>Interfere with the operation of the site (e.g. crawling at abusive rates, scraping content for resale, automated denial-of-service).</li>
        <li>Reverse-engineer the simulator, Mogura mini-game or any other interactive on the site.</li>
      </ul>
    </section>

    <section>
      <h2>4. Using a Fetch Pod</h2>

      <h3>4.1 What a Fetch Pod is</h3>
      <p>
        A Fetch Pod is an unattended retail kiosk that dispenses packaged
        consumer goods on demand. Each Pod displays prices and product
        information on screen at the point of purchase.
      </p>

      <h3>4.2 Payment</h3>
      <p>
        Pods accept payment via the payment methods displayed on the Pod
        (typically UPI; cards and other methods may be available depending on
        the Pod). The price charged is the price shown on screen at the moment
        you confirm payment. All prices are inclusive of applicable taxes.
      </p>

      <h3>4.3 Dispense failures</h3>
      <p>
        If your payment is debited but the product does not dispense, please:
      </p>
      <ol>
        <li>Note the Pod ID shown on the screen.</li>
        <li>Email <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a> with your UPI / card reference and the time of the transaction, or use the in-Pod help screen if available.</li>
      </ol>
      <p>
        We process eligible refunds per our{' '}
        <a href="/refunds">Refunds &amp; Grievance Policy</a>.
      </p>

      <h3>4.4 Faulty or unsafe products</h3>
      <p>
        If a product you receive is faulty, past its best-before date, or
        unsafe, stop using it and contact us. We will refund or replace it per
        the Refunds &amp; Grievance Policy. Always check the packaging and
        best-before date before consuming.
      </p>

      <h3>4.5 Refusal of service</h3>
      <p>
        We may refuse or cancel a transaction if we suspect fraud, abuse,
        violation of these Terms, or a fault with the Pod. Where we cancel a
        transaction we will refund any amount debited.
      </p>

      <h3>4.6 Damage to a Pod</h3>
      <p>
        Pods are property of AIUM Tech Private Limited (or our partners). You
        must not damage, tamper with, modify or remove parts of a Pod. We may
        recover the cost of damage caused by negligent or wilful misuse from
        the person responsible.
      </p>
    </section>

    <section>
      <h2>5. Fetch Grid (early access)</h2>
      <p>
        Fetch Grid is under active development. Anything we share about Grid on
        this site — feature descriptions, screenshots, mockups — describes our
        current direction and may change without notice. Access to Grid, when
        it opens, will be governed by a separate Grid agreement signed at
        onboarding.
      </p>
    </section>

    <section>
      <h2>6. Intellectual property</h2>
      <p>
        The website, the Fetch brand, the Fetch Pod and Fetch Grid product
        names, and all associated software, copy, designs and source code, are
        the property of AIUM Tech Private Limited and our licensors. Brand
        names of products dispensed by Pods belong to their respective owners
        and are used to describe what we stock.
      </p>
      <p>
        You may not copy, redistribute or create derivative works of our
        materials without our written permission, except for personal,
        non-commercial use of the website (e.g. printing a page for your
        records).
      </p>
    </section>

    <section>
      <h2>7. Third-party content and links</h2>
      <p>
        The site may link to third-party sites. We are not responsible for the
        content, privacy practices or availability of those sites.
      </p>
    </section>

    <section>
      <h2>8. Disclaimers</h2>
      <p>
        The website and our materials are provided "as is", without warranties
        of any kind, except those required by law. We don't warrant that the
        site will be uninterrupted or error-free, or that information on the
        site is always current.
      </p>
      <p>
        Nothing in these Terms excludes or limits liability that cannot be
        excluded under Indian consumer law.
      </p>
    </section>

    <section>
      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, our total liability arising out
        of or in connection with these Terms, the website or a Fetch Pod
        purchase will not exceed the amount you paid us in the{' '}
        <span className="policy-placeholder">[Liability cap: 12 months]</span>{' '}
        preceding the event giving rise to the claim, or{' '}
        <span className="policy-placeholder">[Floor amount: ₹5,000]</span>,
        whichever is higher.
      </p>
      <p>
        We are not liable for indirect, incidental, special, consequential or
        punitive damages, or for loss of profits, revenue, data or goodwill.
      </p>
    </section>

    <section>
      <h2>10. Indemnity</h2>
      <p>
        You agree to indemnify and hold AIUM Tech Private Limited harmless from
        any claim, demand or expense (including reasonable legal fees) arising
        out of your breach of these Terms, your misuse of a Fetch Pod, or your
        violation of any law or third-party right.
      </p>
    </section>

    <section>
      <h2>11. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by the laws of India. The courts at{' '}
        <span className="policy-placeholder">[Jurisdiction: Mangalore, Karnataka]</span>{' '}
        will have exclusive jurisdiction over any dispute, subject to any
        non-waivable rights you have as a consumer in your home state.
      </p>
    </section>

    <section>
      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. The "Last reviewed" date
        at the top reflects the latest revision. Material changes will be
        highlighted on the site for at least 30 days.
      </p>
    </section>

    <section>
      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Email{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>{' '}
        or call <a href="tel:+919019526185">+91 90195 26185</a>.
      </p>
      <div className="policy-callout">
        <strong>Draft for legal review.</strong> These Terms are a working draft
        prepared for AIUM Tech Private Limited. Please have Indian legal
        counsel review and approve before relying on this document.
      </div>
    </section>
  </PolicyLayout>
)

export default TermsPage
