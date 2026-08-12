import PolicyLayout from '../components/PolicyLayout'

// Privacy Policy for AIUM Tech Private Limited ("Fetch").
//
// Drafted against India's Digital Personal Data Protection Act, 2023
// (DPDPA), the Information Technology Act, 2000 read with the SPDI Rules,
// 2011, and the IT (Intermediary Guidelines and Digital Media Ethics Code)
// Rules, 2021. Covers every surface that captures data today:
//   thefetch.in            marketing site + contact form (EmailJS)
//   feedback.thefetch.in   Pod feedback and complaints (Cloudflare D1)
//   admin.thefetch.in      internal dashboard
//   Fetch Pods             unattended retail terminals
//   Fetch Grid             retail operations platform (in development)
//
// The Grievance Officer and CIN are populated. Remaining bracketed items
// (retention period, jurisdiction) are business decisions. Have Indian
// counsel review before this is held out as binding.

const PrivacyPage = () => (
  <PolicyLayout
    title="Privacy Policy"
    description="How AIUM Tech Private Limited (Fetch) collects, processes, stores and protects personal data across thefetch.in, Fetch Pods, the Fetch feedback service and Fetch Grid, in accordance with the Digital Personal Data Protection Act, 2023."
    canonical="https://thefetch.in/privacy"
    lastUpdated="2026-08-12"
  >
    <section>
      <p>
        This Privacy Policy ("<strong>Policy</strong>") describes the manner in which{' '}
        <strong>AIUM Tech Private Limited</strong>, a company incorporated under the
        Companies Act, 2013 (CIN: U47990MN2025PTC015220) and having its registered
        office at Nagamapal Khwai Brahmapur, Lalambung (Part), Imphal West,
        Lamphelpat, Manipur 795004, India, operating under the
        brand "<strong>Fetch</strong>" (hereinafter "<strong>Fetch</strong>",
        "<strong>we</strong>", "<strong>us</strong>" or "<strong>our</strong>"),
        collects, receives, stores, uses, processes, discloses, transfers and
        otherwise deals with personal data.
      </p>
      <p>
        This Policy is published in accordance with the Digital Personal Data
        Protection Act, 2023 ("<strong>DPDP Act</strong>"), the Information
        Technology Act, 2000 read with the Information Technology (Reasonable
        Security Practices and Procedures and Sensitive Personal Data or
        Information) Rules, 2011 ("<strong>SPDI Rules</strong>"), and the
        Information Technology (Intermediary Guidelines and Digital Media Ethics
        Code) Rules, 2021, each as amended from time to time.
      </p>
      <p>
        For the purposes of the DPDP Act, Fetch is the <strong>Data
        Fiduciary</strong> in respect of the personal data described in this
        Policy, and the individual to whom such personal data relates is the{' '}
        <strong>Data Principal</strong>.
      </p>
    </section>

    <section>
      <h2>1. Scope</h2>
      <p>This Policy applies to personal data processed through:</p>
      <ul>
        <li>the website <a href="https://thefetch.in/">thefetch.in</a> and its sub-pages;</li>
        <li>the feedback and complaint service at <strong>feedback.thefetch.in</strong>, accessed by scanning the QR code affixed to a Fetch Pod;</li>
        <li>our internal administration console at <strong>admin.thefetch.in</strong>;</li>
        <li><strong>Fetch Pods</strong>, being our unattended smart retail terminals; and</li>
        <li><strong>Fetch Grid</strong>, our retail operations platform presently under development, to the extent it is made available to you.</li>
      </ul>
      <p>
        By accessing our website, submitting information to us, or transacting at a
        Fetch Pod, you acknowledge that you have read and understood this Policy.
        Where processing is founded on consent, such consent is obtained separately
        and may be withdrawn in the manner described in Clause 9.
      </p>
    </section>

    <section>
      <h2>2. Categories of personal data collected</h2>

      <h3>2.1 Data you provide directly</h3>
      <ul>
        <li>
          <strong>Enquiry form (thefetch.in):</strong> name, email address, company
          name (optional) and the contents of your message. This form is transmitted
          through EmailJS and delivered to our electronic mailbox.
        </li>
        <li>
          <strong>Career applications:</strong> such information as you elect to
          include in an email application, which may include your name, contact
          details, curriculum vitae and employment history.
        </li>
        <li>
          <strong>Feedback submissions:</strong> a satisfaction rating, product
          category preferences, requested brands or items, your view on pricing,
          your frequency of use of the relevant Pod, and any free-text remarks you
          choose to enter.
        </li>
        <li>
          <strong>Complaint submissions:</strong> the nature of the issue, the time
          of occurrence, the product concerned, and, where a payment-related issue
          is reported, the amount paid and the UPI or transaction reference, together
          with an indication of whether a refund is sought.
        </li>
        <li>
          <strong>Contact particulars:</strong> your email address and/or mobile
          number, which are optional save where you request a refund or ask to be
          notified when a requested item is stocked, in which case they are necessary
          to give effect to your request.
        </li>
      </ul>

      <h3>2.2 Transaction data at Fetch Pods</h3>
      <p>
        When you purchase from a Fetch Pod we record the stock keeping unit
        dispensed, the date and time, the machine identifier, the amount charged
        and the payment reference returned by our payment partner. We do{' '}
        <strong>not</strong> collect or store your full payment card number, your
        UPI personal identifier, your bank credentials, or any authentication factor.
        Payment authorisation is performed by regulated payment service providers.
      </p>

      <h3>2.3 Data collected automatically</h3>
      <ul>
        <li>
          <strong>Technical logs:</strong> our infrastructure provider records
          standard request metadata, including internet protocol (IP) address, user
          agent string, timestamp and requested resource, for security, diagnostic
          and availability purposes.
        </li>
        <li>
          <strong>Pseudonymised identifiers:</strong> in the feedback service, your
          IP address is subjected to a one-way cryptographic hash before storage and
          is retained only in that hashed form, for the purposes of rate limiting and
          abuse prevention. Your two-letter country code and a truncated user agent
          string are stored alongside the submission.
        </li>
        <li>
          <strong>Cookies and local storage:</strong> as described in our{' '}
          <a href="/cookies">Cookie Policy</a>. We do not deploy advertising or
          cross-site tracking technologies.
        </li>
      </ul>

      <h3>2.4 Administrative accounts</h3>
      <p>
        In respect of our personnel authorised to access admin.thefetch.in, we
        process the account holder's email address, a cryptographic hash of the
        account password (the password itself is never stored or transmitted to us
        in recoverable form), session identifiers stored in hashed form, and a
        record of sign-in attempts including a hashed IP address.
      </p>

      <h3>2.5 Sensitive personal data</h3>
      <p>
        We do not solicit passwords, financial account information, health data,
        biometric information, or any other category of sensitive personal data or
        information within the meaning of Rule 3 of the SPDI Rules. You are
        requested not to submit such information through free-text fields.
      </p>
    </section>

    <section>
      <h2>3. Purposes of processing</h2>
      <p>Personal data is processed for the following specified lawful purposes:</p>
      <ul>
        <li>to respond to your enquiry, feedback, complaint or application;</li>
        <li>to complete and, where warranted, reverse a transaction at a Fetch Pod, including the processing of refunds in accordance with our <a href="/refunds">Refunds &amp; Grievance Policy</a>;</li>
        <li>to determine the product assortment stocked at a given Pod;</li>
        <li>to operate, maintain, secure, audit and improve the Fetch Pods, the Fetch Grid platform and our websites;</li>
        <li>to detect, prevent and investigate fraud, abuse, spam and unauthorised access;</li>
        <li>to communicate service-related notices, including confirmation of a refund; and</li>
        <li>to comply with applicable law, including taxation, accounting and record-keeping obligations, and to establish, exercise or defend legal claims.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell personal data. We do not undertake
        behavioural advertising, profiling for advertising purposes, or automated
        decision-making producing legal or similarly significant effects.
      </p>
    </section>

    <section>
      <h2>4. Legal basis</h2>
      <p>
        We process personal data on the basis of your consent, given by an
        affirmative action such as submitting a form, and on the basis of the
        "certain legitimate uses" recognised under Section 7 of the DPDP Act,
        including where you have voluntarily provided personal data for a specified
        purpose and have not indicated an objection, and where processing is
        necessary to comply with a legal obligation.
      </p>
    </section>

    <section>
      <h2>5. Disclosure and data processors</h2>
      <p>
        We do not disclose personal data to third parties except as set out below,
        and in each case subject to contractual obligations of confidentiality and
        security consistent with Section 8(2) of the DPDP Act:
      </p>
      <ul>
        <li><strong>Cloud infrastructure:</strong> Cloudflare, Inc., which provides hosting, content delivery, database (D1) and security services;</li>
        <li><strong>Form transmission:</strong> EmailJS, which delivers enquiry-form submissions to our mailbox;</li>
        <li><strong>Payment service providers:</strong> for authorisation, settlement and reversal of transactions effected at Fetch Pods;</li>
        <li><strong>Distributors and brand partners:</strong> in aggregated and de-identified form only, for assortment and supply planning. Data identifying you personally is not shared with brand partners;</li>
        <li><strong>Professional advisers and auditors:</strong> where bound by duties of confidentiality; and</li>
        <li><strong>Governmental and judicial authorities:</strong> where disclosure is required under applicable law or by a lawful order.</li>
      </ul>
      <p>
        In the event of a merger, amalgamation, restructuring or transfer of
        business, personal data may be transferred to the successor entity, subject
        to that entity being bound by obligations no less protective than those in
        this Policy.
      </p>
    </section>

    <section>
      <h2>6. Cross-border transfer</h2>
      <p>
        Certain of our processors operate infrastructure outside India, and personal
        data may accordingly be transferred to and processed in jurisdictions other
        than India. Such transfers are effected in accordance with Section 16 of the
        DPDP Act and are subject to appropriate contractual safeguards. We do not
        transfer personal data to any territory in respect of which transfer has been
        restricted by the Central Government.
      </p>
    </section>

    <section>
      <h2>7. Retention and erasure</h2>
      <p>
        Personal data is retained only for so long as is necessary for the purpose
        for which it was collected, or for such longer period as may be required
        under applicable law:
      </p>
      <ul>
        <li><strong>Enquiry and feedback records:</strong> retained for a period of twenty-four (24) months from the date of last correspondence, whereafter they are erased or irreversibly anonymised;</li>
        <li><strong>Transaction and refund records:</strong> retained for the period prescribed under the Companies Act, 2013 and applicable taxation statutes, presently eight (8) years;</li>
        <li><strong>Technical logs:</strong> retained by our infrastructure provider for a rolling period not exceeding thirty (30) days;</li>
        <li><strong>Administrative account records:</strong> retained for the duration of the account holder's authorisation and for a reasonable period thereafter for audit purposes.</li>
      </ul>
      <p>
        Upon the withdrawal of consent, or upon the purpose ceasing to be served, we
        shall erase the relevant personal data and cause our Data Processors to do
        likewise, save where retention is necessary for compliance with applicable law.
      </p>
    </section>

    <section>
      <h2>8. Security safeguards</h2>
      <p>
        We implement reasonable security practices and procedures within the meaning
        of Section 43A of the Information Technology Act, 2000 and Rule 8 of the SPDI
        Rules, commensurate with the nature of the personal data processed. These
        include, without limitation:
      </p>
      <ul>
        <li>encryption of data in transit by means of Transport Layer Security;</li>
        <li>storage of authentication credentials solely as salted cryptographic hashes;</li>
        <li>one-way hashing of IP addresses used for abuse prevention;</li>
        <li>role-based access restricted to authorised personnel on a need-to-know basis, protected by individual credentials;</li>
        <li>cryptographic authentication of Pod identifiers, so that submissions cannot be fabricated against a machine;</li>
        <li>rate limiting, automated-traffic detection and input validation; and</li>
        <li>logical segregation of the public-facing and administrative environments.</li>
      </ul>
      <p>
        Notwithstanding the foregoing, no method of transmission or storage is
        entirely secure, and we do not warrant absolute security.
      </p>
    </section>

    <section>
      <h2>9. Rights of Data Principals</h2>
      <p>
        Subject to and in accordance with the DPDP Act, you have the following rights:
      </p>
      <ul>
        <li><strong>Right to access information</strong> regarding the personal data processed about you, the processing activities undertaken, and the identities of other Data Fiduciaries and Data Processors with whom it has been shared (Section 11);</li>
        <li><strong>Right to correction, completion, updating and erasure</strong> of your personal data (Section 12);</li>
        <li><strong>Right to withdraw consent</strong> at any time, with such withdrawal operating prospectively and without affecting the lawfulness of processing carried out prior thereto (Section 6(4)–(6));</li>
        <li><strong>Right of grievance redressal</strong> through the mechanism at Clause 12 (Section 13); and</li>
        <li><strong>Right to nominate</strong> another individual to exercise your rights in the event of your death or incapacity (Section 14).</li>
      </ul>
      <p>
        A request may be made by writing to{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a> bearing the
        subject line "DPDP Request". We may require information reasonably necessary
        to verify your identity before giving effect to a request. We shall ordinarily
        respond within thirty (30) days.
      </p>
    </section>

    <section>
      <h2>10. Duties of Data Principals</h2>
      <p>
        You are reminded that Section 15 of the DPDP Act requires a Data Principal to
        comply with applicable law when exercising rights under the Act, not to
        impersonate another person while furnishing personal data, not to suppress
        material information, not to register a false or frivolous grievance or
        complaint, and to furnish only such information as is verifiably authentic
        when seeking correction or erasure.
      </p>
    </section>

    <section>
      <h2>11. Children</h2>
      <p>
        Our services are not directed at children. We do not knowingly process the
        personal data of any individual below the age of eighteen (18) years without
        the verifiable consent of a parent or lawful guardian, and we do not undertake
        tracking, behavioural monitoring or targeted advertising directed at children,
        in accordance with Section 9 of the DPDP Act. Should we become aware that
        personal data of a child has been collected without such consent, we shall
        erase it expeditiously. A parent or guardian may write to us at the address in
        Clause 12.
      </p>
    </section>

    <section>
      <h2>12. Grievance redressal</h2>
      <p>
        In compliance with Section 13 of the DPDP Act and Rule 3(2) of the
        Information Technology (Intermediary Guidelines and Digital Media Ethics
        Code) Rules, 2021, the particulars of the Grievance Officer are as follows:
      </p>
      <p>
        <strong>Name:</strong> Mr. Ronan Mark D'souza
        <br />
        <strong>Designation:</strong> Director and Grievance Officer
        <br />
        <strong>Entity:</strong> AIUM Tech Private Limited
        <br />
        <strong>Address:</strong> Nagamapal Khwai Brahmapur, Lalambung (Part), Imphal West, Lamphelpat, Manipur 795004, India
        <br />
        <strong>Email:</strong>{' '}
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>
        <br />
        <strong>Telephone:</strong>{' '}
        <a href="tel:+919019526185">+91 90195 26185</a> (Monday to Saturday, 10:00–18:00 IST)
      </p>
      <p>
        A grievance shall be acknowledged within twenty-four (24) hours of receipt and
        disposed of within fifteen (15) days therefrom. Where a Data Principal is not
        satisfied with the response, or where no response is received within the
        prescribed period, the Data Principal may prefer a complaint to the{' '}
        <strong>Data Protection Board of India</strong> in accordance with Section 13(3)
        of the DPDP Act. Consumer disputes may additionally be raised with the National
        Consumer Helpline (1915).
      </p>
    </section>

    <section>
      <h2>13. Personal data breach</h2>
      <p>
        In the event of a personal data breach, we shall give intimation to the Data
        Protection Board of India and to each affected Data Principal in the form and
        manner prescribed under Section 8(6) of the DPDP Act and the rules framed
        thereunder.
      </p>
    </section>

    <section>
      <h2>14. Amendments</h2>
      <p>
        We may amend this Policy from time to time. The "Last reviewed" date recorded
        at the head of this Policy reflects the date of the most recent revision.
        Where an amendment is material, we shall display a notice on our website for a
        period of not less than thirty (30) days. Continued use of our services
        following such notice constitutes acknowledgement of the amended Policy.
      </p>
    </section>

    <section>
      <h2>15. Governing law and jurisdiction</h2>
      <p>
        This Policy shall be governed by and construed in accordance with the laws of
        India. Subject to any non-derogable right available to you as a consumer under
        the Consumer Protection Act, 2019, the courts at Mangalore, Karnataka, being
        the place at which the Company carries on business, shall have exclusive
        jurisdiction in respect of any dispute arising out of or in connection with
        this Policy.
      </p>
    </section>

    <section>
      <h2>16. Contact</h2>
      <p>
        AIUM Tech Private Limited
        <br />
        Registered office: Nagamapal Khwai Brahmapur, Lalambung (Part), Imphal West, Lamphelpat, Manipur 795004, India
        <br />
        <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a> ·{' '}
        <a href="tel:+919019526185">+91 90195 26185</a>
        <br />
        Corporate Identity Number (CIN): U47990MN2025PTC015220
      </p>
      <div className="policy-callout">
        <strong>Draft for legal review.</strong> This Policy has been prepared as a
        working draft for AIUM Tech Private Limited and reflects the data processing
        activities known at the date stated above. It should be reviewed and approved
        by qualified Indian legal counsel before being held out as a binding
        statement of the company's practices.
      </div>
    </section>
  </PolicyLayout>
)

export default PrivacyPage
