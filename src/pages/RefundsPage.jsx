import PolicyLayout from '../components/PolicyLayout'

// NOTE: Plain-English boilerplate draft combining the Refund / Cancellation
// disclosures required by India's Consumer Protection (E-Commerce) Rules 2020
// with the named Grievance Officer required by the IT Rules 2021. Replace the
// bracketed placeholders with the actual officer's details before publishing.

const RefundsPage = () => (
  <PolicyLayout
    title="Refunds & Grievance"
    description="How to claim a refund for a Fetch Pod purchase, and how to escalate a complaint to our Grievance Officer. Operated by AIUM Tech Private Limited."
    canonical="https://thefetch.in/refunds"
    lastUpdated="2026-05-17"
  >
    <section>
      <p>
        This page covers two things: how to get your money back if something
        goes wrong with a Fetch Pod purchase, and how to raise a formal
        complaint to our named Grievance Officer. Both are required by Indian
        law and we take them seriously.
      </p>
    </section>

    <section>
      <h2>Refund &amp; Cancellation</h2>

      <h3>When you're entitled to a refund</h3>
      <p>
        Refunds apply to purchases made at a Fetch Pod (the connected vending
        machines operated by AIUM Tech Private Limited). You can claim a
        refund if:
      </p>
      <ul>
        <li><strong>Your payment was debited but no product was dispensed.</strong></li>
        <li><strong>The product dispensed was faulty</strong> — damaged packaging, past best-before date, or otherwise unsafe.</li>
        <li><strong>The wrong product dispensed.</strong></li>
        <li><strong>The Pod charged you more than the displayed price</strong> due to a system fault.</li>
      </ul>
      <p>
        Because Pod purchases dispense instantly, we don't offer
        change-of-mind refunds once an item has dispensed correctly.
      </p>

      <h3>How to claim</h3>
      <ol>
        <li>Note the <strong>Pod ID</strong> shown on the Pod screen.</li>
        <li>Keep your <strong>UPI / card reference</strong> from the payment app.</li>
        <li>
          Email <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>{' '}
          with the subject line "Refund — Pod {`{ID}`}" and include the date,
          time, amount and reference.
        </li>
      </ol>

      <h3>How quickly we process refunds</h3>
      <ul>
        <li>
          We acknowledge refund requests within <strong>1 business day</strong>.
        </li>
        <li>
          Eligible refunds are credited back to the original payment method
          within{' '}
          <span className="policy-placeholder">[Refund window: 7 business days]</span>{' '}
          of approval. Bank or UPI provider delays may add 1–2 days.
        </li>
        <li>
          If we need more information from you, the clock pauses until you
          reply.
        </li>
      </ul>

      <h3>Cancellations</h3>
      <p>
        A Fetch Pod purchase completes instantly when the item dispenses, so
        there's no cancellation window for successful purchases. If your
        payment is debited but the Pod fails to dispense, treat it as a refund
        request — see "How to claim" above.
      </p>

      <h3>Partner / distributor terms</h3>
      <p>
        Commercial refunds, returns and reconciliation between Fetch and its
        distributor or brand partners are governed by separate signed
        agreements and aren't covered by this policy.
      </p>
    </section>

    <section>
      <h2>Grievance Redressal</h2>
      <p>
        In line with the Information Technology (Intermediary Guidelines and
        Digital Media Ethics Code) Rules 2021, AIUM Tech Private Limited has
        appointed a Grievance Officer to address any concerns you may have
        about Fetch services or content on this site.
      </p>

      <h3>How to raise a grievance</h3>
      <p>Send a written complaint with:</p>
      <ul>
        <li>Your full name and contact details.</li>
        <li>A clear description of the issue (and the Pod ID, transaction reference or page URL where relevant).</li>
        <li>What outcome you're looking for.</li>
        <li>Any supporting evidence (screenshots, photos, payment proof).</li>
      </ul>

      <h3>Our Grievance Officer</h3>
      <p>
        <strong>Name:</strong> <span className="policy-placeholder">[Grievance Officer Name]</span>
        <br />
        <strong>Designation:</strong> Grievance Officer, AIUM Tech Private Limited
        <br />
        <strong>Email:</strong>{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>
        <br />
        <strong>Postal address:</strong> AIUM Tech Private Limited, Lucia Mansion,
        Kalpane Kulshekara, Mangalore 575005, Karnataka, India.
        <br />
        <strong>Phone:</strong>{' '}
        <a href="tel:+919019526185">+91 90195 26185</a> (business hours, IST).
      </p>

      <h3>Our response times</h3>
      <ul>
        <li>We will <strong>acknowledge</strong> your grievance within 24 hours of receipt.</li>
        <li>We will <strong>resolve</strong> it within 15 days of receipt.</li>
        <li>If the issue requires more time (for example, a payment-partner investigation), we will keep you informed of progress and an expected resolution date.</li>
      </ul>

      <h3>If you're still unhappy</h3>
      <p>
        If our Grievance Officer's response doesn't resolve your concern, you
        may escalate to:
      </p>
      <ul>
        <li>The <strong>Data Protection Board of India</strong>, for data-protection grievances under the DPDPA 2023.</li>
        <li>The <strong>National Consumer Helpline</strong> (1915 / consumerhelpline.gov.in) for consumer disputes.</li>
        <li>Any court of competent jurisdiction in{' '}
          <span className="policy-placeholder">[Jurisdiction: Mangalore, Karnataka]</span>.
        </li>
      </ul>
    </section>

    <section>
      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The "Last reviewed" date
        at the top reflects the latest revision. We will keep older versions
        on request.
      </p>
    </section>

    <section>
      <div className="policy-callout">
        <strong>Draft for legal review.</strong> This Refunds &amp; Grievance
        policy is a working draft prepared for AIUM Tech Private Limited. The
        refund window, the Grievance Officer's name, and the jurisdiction
        clause all need to be confirmed by Indian legal counsel before this is
        treated as binding.
      </div>
    </section>
  </PolicyLayout>
)

export default RefundsPage
