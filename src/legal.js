// ============================================================
// DRIFT — legal documents shown in the app (customer + driver).
//
// DRAFT FOR ATTORNEY REVIEW. Written to Minnesota / Wisconsin standards as
// researched Sept 2026 (Justice v. Marvel (Minn. 2022); Minn. Stat. § 604.055;
// Schlobohm v. Spa Petite (Minn. 1982); Atkins v. Swimwest (Wis. 2005);
// Brooten v. Hickok (Wis. 2013); Minn. Stat. §§ 181.722–181.723; E-SIGN and
// Minn. Stat. ch. 325L). Not legal advice. Have a Minnesota attorney finalize.
//
// When you change the wording, bump LEGAL_VERSION — every user is re-asked to
// agree to the new version before their next booking / going online.
//
// TODO before launch: replace ENTITY with the registered LLC name and EMAIL with
// a real monitored inbox.
// ============================================================

export const LEGAL_VERSION = "2026-09-28.2";
export const LEGAL_UPDATED = "September 28, 2026";
export const ENTITY = "DRIFT";                 // e.g. "DRIFT Technologies LLC, a Minnesota limited liability company"
export const EMAIL = "legal@driftplow.com";    // TODO: real, monitored address
export const VENUE = "St. Louis County, Minnesota";

// Each section: { h: heading, p: [paragraphs], loud: true → rendered bold (conspicuous) }
export const DOCS = {
  // ------------------------------------------------------------------ CUSTOMER TERMS
  customerTerms: {
    id: "customerTerms",
    title: "Customer Terms of Service",
    who: "customer",
    intro: `These Terms are a binding agreement between you and ${ENTITY} ("DRIFT," "we," "us"). They include the separate Release, Waiver of Liability and Assumption of Risk, and a binding individual arbitration agreement with a class action waiver in Section 14. Please read them. If you don't agree, don't use DRIFT.`,
    sections: [
      { h: "1. What DRIFT is — and isn't", p: [
        `DRIFT is a technology platform. Our app lets people who need snow cleared ("Customers") find and book independent snow-removal operators ("Drivers"), and gives both sides tools for booking, messaging, tracking, photos, and payment.`,
        `DRIFT does not provide snow removal, plowing, shoveling, snow blowing, jump-starts, or any other physical service. DRIFT does not own or operate trucks or equipment, and DRIFT does not employ Drivers. Drivers are independent businesses. They decide whether to accept a request and how to do the work.`,
        `When a Driver accepts your offer, the agreement to do that job — at the price you offered — is between you and that Driver. DRIFT is not a party to it and is not responsible for the Driver's performance, conduct, or work.`,
      ] },
      { h: "2. No insurance, no vetting, no guarantees", loud: true, p: [
        `DRIFT DOES NOT PROVIDE INSURANCE OF ANY KIND for Customers, Drivers, property, vehicles, or jobs. DRIFT DOES NOT VERIFY OR REPRESENT THAT ANY DRIVER IS INSURED, LICENSED, BACKGROUND-CHECKED, BONDED, EXPERIENCED, OR QUALIFIED. You decide whether to book a Driver, and you're free to ask a Driver about their coverage directly.`,
        `DRIFT does not guarantee that a Driver will be available, will accept, will arrive at any particular time, or will complete a job, or that any surface will be free of snow or ice. Arrival times are estimates. Plowing does not remove ice and can leave ridges, packed snow, and slippery surfaces, and snow can refreeze or drift back.`,
        `If DRIFT ever chooses to give a refund, credit, or goodwill payment, it is voluntary and at our sole discretion. It is not insurance, not an admission of fault or responsibility, and it doesn't obligate us to do the same again.`,
      ] },
      { h: "3. Your account", p: [
        `You must be at least 18, able to form a binding contract, and the owner of the property you book for or authorized by the owner to arrange work on it. Keep your account information accurate and your login private; you're responsible for activity on your account.`,
      ] },
      { h: "4. Your property and your responsibilities", p: [
        `You are solely responsible for the condition and safety of your property. Before booking, use the app to mark the areas to clear, where snow should be pushed, and every hazard or item that could be damaged or hidden by snow — for example wells, septic and valve covers, irrigation heads, landscape lighting, edging, curbs, steps, rocks, stumps, drop-offs, soft ground, and anything left outside. Items and hazards you don't mark are at your own risk.`,
        `Keep people, pets, and vehicles away from the work area while a job is in progress. You authorize the Driver you book to enter the areas you marked to do the job.`,
        `You remain responsible for your property after a job, including ice, salting or sanding, refreezing, and anyone who walks or drives on it. You're responsible for following any law, city ordinance (including sidewalk-clearing deadlines), HOA rule, or lease that applies to you. Booking through DRIFT does not guarantee that you'll meet any deadline or requirement.`,
      ] },
      { h: "5. You name the price; fees; payment", p: [
        `You decide how much to offer for each job. DRIFT may show suggested offers based on your property's size and features, but the amount is your choice. Drivers decide which offers to accept, so lower offers may take longer to be accepted or may not be accepted at all.`,
        `Your total is your offer, plus a $10 call-out fee that goes entirely to the Driver, plus DRIFT's $5 booking fee. You'll see the total before you send an offer. Your card is authorized when you send it and charged only when the Driver marks the job complete; if no Driver accepts, you aren't charged. Payments are processed by our payment provider, Stripe. You authorize DRIFT to collect payment on the Driver's behalf as their limited payment collection agent; paying DRIFT satisfies what you owe the Driver for that job. Tips go 100% to the Driver.`,
      ] },
      { h: "6. Cancellations and problems", p: [
        `You can cancel before a Driver arrives at no charge. After a Driver has arrived or started, you may be charged. If there's a problem with a job, report it in the app within 48 hours with photos. We may help you and the Driver resolve it, but we're not obligated to, and any refund or credit is at our discretion (see Section 2).`,
      ] },
      { h: "7. Photos, messages, and texts", p: [
        `Drivers may take before-and-after photos of the work area; you agree to this. Messages between you and a Driver go through the app. You agree to receive calls and texts (including automated ones) about your account and jobs. Message and data rates may apply. You can opt out of non-essential texts by replying STOP.`,
      ] },
      { h: "8. Things you may not do", p: [
        `Don't misuse DRIFT: no false information, fraud, harassment, discrimination, unsafe instructions, requests for illegal work, or attempts to avoid DRIFT's fees by arranging a job found on DRIFT off the app for 12 months after you were introduced.`,
      ] },
      { h: "9. Ending your use", p: [
        `You can stop using DRIFT and close your account at any time. We may suspend or close accounts for safety, fraud, legal reasons, or breach of these Terms.`,
      ] },
      { h: "10. Disclaimer of warranties", loud: true, p: [
        `DRIFT IS PROVIDED "AS IS" AND "AS AVAILABLE." TO THE FULLEST EXTENT ALLOWED BY LAW, DRIFT DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, AND MAKES NO WARRANTY ABOUT ANY DRIVER OR ANY DRIVER'S WORK. MAPS, MEASUREMENTS, PRICES, WEATHER, AND ARRIVAL TIMES ARE ESTIMATES.`,
      ] },
      { h: "11. Limitation of liability", loud: true, p: [
        `TO THE FULLEST EXTENT ALLOWED BY LAW, DRIFT WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS OR DATA, AND DRIFT IS NOT LIABLE FOR THE ACTS OR OMISSIONS OF ANY DRIVER. DRIFT'S TOTAL LIABILITY FOR ALL CLAIMS RELATING TO DRIFT IS LIMITED TO THE GREATER OF $100 OR THE BOOKING FEES YOU PAID DRIFT IN THE SIX MONTHS BEFORE THE CLAIM AROSE.`,
        `Nothing in these Terms limits liability that cannot legally be limited, including liability for gross negligence or willful misconduct.`,
      ] },
      { h: "12. Indemnification — you agree to defend and cover DRIFT", loud: true, p: [
        `YOU AGREE TO DEFEND, INDEMNIFY, AND HOLD HARMLESS DRIFT AND ITS OWNERS, MEMBERS, MANAGERS, OFFICERS, EMPLOYEES, AND AGENTS FROM ANY CLAIM, DEMAND, LOSS, OR EXPENSE (INCLUDING REASONABLE ATTORNEYS' FEES) BROUGHT BY ANYONE ELSE — INCLUDING PEOPLE INJURED ON YOUR PROPERTY — ARISING FROM YOUR PROPERTY OR ITS CONDITION, HAZARDS YOU DIDN'T MARK, YOUR INSTRUCTIONS, YOUR BREACH OF THESE TERMS, OR YOUR VIOLATION OF ANY LAW, EXCEPT TO THE EXTENT CAUSED BY DRIFT'S GROSS NEGLIGENCE OR WILLFUL MISCONDUCT.`,
      ] },
      { h: "13. Release, waiver, and assumption of risk", p: [
        `The separate document titled "Release, Waiver of Liability and Assumption of Risk" is part of these Terms. You must agree to it to book through DRIFT.`,
      ] },
      { h: "14. Disputes: individual arbitration and class action waiver", loud: true, p: [
        `PLEASE READ THIS SECTION. IT AFFECTS YOUR RIGHTS. If you have a dispute with DRIFT, first email ${EMAIL} and give us 30 days to try to resolve it informally.`,
        `If we can't resolve it, YOU AND DRIFT AGREE THAT ANY DISPUTE RELATING TO DRIFT OR THESE TERMS WILL BE RESOLVED BY BINDING INDIVIDUAL ARBITRATION administered by the American Arbitration Association under its Consumer Arbitration Rules, instead of in court, except that either of us may bring an individual claim in small claims court. The Federal Arbitration Act governs this section. Arbitration fees are paid as the AAA Consumer Rules require. The hearing may be held by video or in ${VENUE}.`,
        `YOU AND DRIFT WAIVE ANY RIGHT TO A JURY TRIAL AND ANY RIGHT TO BRING OR TAKE PART IN A CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION. If this class waiver is found unenforceable for a claim, that claim goes to court instead of arbitration, and this arbitration section doesn't apply to it.`,
        `You may opt out of this arbitration agreement within 30 days of first accepting these Terms by emailing ${EMAIL} with your name and the words "arbitration opt-out."`,
      ] },
      { h: "15. Governing law", p: [
        `Minnesota law governs these Terms, except where the Federal Arbitration Act applies or where the law of your state cannot be waived. Any court case allowed by these Terms will be brought in ${VENUE}.`,
      ] },
      { h: "16. Changes, e-signature, and everything else", p: [
        `We may update these Terms. We'll show you the new version in the app, and you'll need to agree before your next booking. By tapping "Agree" you sign these Terms electronically under the federal E-SIGN Act and Minnesota's Uniform Electronic Transactions Act (Minn. Stat. ch. 325L); we keep a record of the version and the date and time you agreed. If any part of these Terms is unenforceable, the rest stays in effect and the unenforceable part is limited only as much as necessary. These Terms and the Release are the entire agreement between you and DRIFT about using the app. Questions: ${EMAIL}.`,
      ] },
    ],
  },

  // ------------------------------------------------------------------ CUSTOMER RELEASE
  customerRelease: {
    id: "customerRelease",
    title: "Release, Waiver of Liability and Assumption of Risk",
    who: "customer",
    intro: `READ THIS CAREFULLY. THIS IS A RELEASE OF LEGAL RIGHTS. By agreeing, you give up the right to sue DRIFT for certain claims — INCLUDING CLAIMS BASED ON DRIFT'S OWN ORDINARY NEGLIGENCE.`,
    sections: [
      { h: "1. Your choice", p: [
        `You don't have to use DRIFT. You're free to hire any snow-removal company directly, without this Release. If you'd like to discuss or negotiate any part of this Release before booking, email ${EMAIL} and don't book until we've replied.`,
      ] },
      { h: "2. Risks you assume", loud: true, p: [
        `Snow removal and winter property care involve risks, some of which can't be eliminated. They include: slips and falls on snow or ice before, during, or after a job; ice, packed snow, ridges, and refreezing that plowing does not remove; damage to driveways, pavement, gravel, curbs, lawns, landscaping, edging, fences, mailboxes, irrigation, lighting, vehicles, and anything hidden under snow; where snow is piled; the movement of heavy equipment; and the acts and omissions of independent Drivers and other people.`,
        `YOU KNOWINGLY AND VOLUNTARILY ASSUME ALL OF THESE RISKS, BOTH KNOWN AND UNKNOWN, FOR YOURSELF, YOUR HOUSEHOLD, YOUR GUESTS, AND YOUR PROPERTY.`,
      ] },
      { h: "3. Release and waiver — including DRIFT's own negligence", loud: true, p: [
        `TO THE FULLEST EXTENT ALLOWED BY LAW, YOU RELEASE, WAIVE, AND DISCHARGE DRIFT AND ITS OWNERS, MEMBERS, MANAGERS, OFFICERS, EMPLOYEES, AGENTS, SUCCESSORS, AND ASSIGNS (THE "RELEASED PARTIES") FROM ALL CLAIMS, DEMANDS, AND LIABILITY FOR PROPERTY DAMAGE, PERSONAL INJURY, ILLNESS, DEATH, OR OTHER LOSS ARISING OUT OF OR RELATING TO YOUR USE OF DRIFT, ANY JOB, OR ANY DRIVER — INCLUDING CLAIMS ARISING FROM THE ORDINARY NEGLIGENCE OF DRIFT OR ANY OTHER RELEASED PARTY.`,
        `Examples of DRIFT's ordinary negligence covered by this Release include mistakes in the app, maps, measurements, outlines, hazard markers, dispatch, messages, notifications, or arrival estimates.`,
        `YOU PROMISE NOT TO SUE ANY RELEASED PARTY FOR ANY CLAIM RELEASED HERE.`,
      ] },
      { h: "4. Your claims about a Driver's work", p: [
        `This Release does not release any Driver. Drivers are independent businesses, and any claim you have about how a Driver did a job is a claim against that Driver, not DRIFT.`,
      ] },
      { h: "5. What this Release does not cover", p: [
        `This Release does not apply to gross negligence, recklessness, or willful, wanton, or intentional misconduct by DRIFT, or to any liability that cannot be waived under Minnesota law (including Minn. Stat. § 604.055) or the law of your state. If any part of this Release is found unenforceable, the rest remains in effect to the fullest extent allowed.`,
      ] },
      { h: "6. Acknowledgment", loud: true, p: [
        `I HAVE READ THIS RELEASE, WAIVER OF LIABILITY AND ASSUMPTION OF RISK. I UNDERSTAND THAT I AM GIVING UP SUBSTANTIAL RIGHTS, INCLUDING MY RIGHT TO SUE DRIFT FOR ITS OWN ORDINARY NEGLIGENCE, AND I AGREE TO IT VOLUNTARILY.`,
      ] },
    ],
  },

  // ------------------------------------------------------------------ DRIVER AGREEMENT
  driverAgreement: {
    id: "driverAgreement",
    title: "Independent Contractor Agreement, Release and Waiver",
    who: "driver",
    intro: `This Agreement is between you (the "Driver") and ${ENTITY} ("DRIFT," "we," "us"). It explains that you run your own business and DRIFT is not your employer. It includes an assumption of risk, a release of claims (including claims based on DRIFT's own ordinary negligence), an indemnity, and a binding individual arbitration agreement with a class action waiver. Read it before you agree.`,
    sections: [
      { h: "1. You're an independent business — DRIFT is not your boss", loud: true, p: [
        `YOU ARE AN INDEPENDENT CONTRACTOR OPERATING YOUR OWN BUSINESS. YOU ARE NOT AN EMPLOYEE, PARTNER, JOINT VENTURER, AGENT, OR FRANCHISEE OF DRIFT, AND DRIFT IS NOT YOUR EMPLOYER OR SUPERVISOR.`,
        `DRIFT does not pay you wages or overtime, does not provide employee benefits, and does not provide workers' compensation, unemployment insurance, or disability coverage. You'll receive tax forms (such as a 1099) as the law requires.`,
      ] },
      { h: "2. You control your work", p: [
        `You decide whether, when, where, and how long to use DRIFT. There are no minimum hours, shifts, or number of jobs. You may accept or decline any request for any reason. Declining, passing, or letting a request expire is never penalized.`,
        `You choose your own methods, routes, vehicle, equipment, and schedule. DRIFT does not train, supervise, schedule, or inspect you, and you don't wear a DRIFT uniform or display DRIFT branding. You're free to work for anyone else at the same time, including competitors, and to market your own business.`,
        `A Customer's notes in the app — areas to clear, where to push snow, hazards — are the Customer's instructions to you, not DRIFT's. You decide whether a job is safe and whether to take it, and you may stop any job you believe is unsafe.`,
        `You may use your own helpers or employees at your own expense. They are yours, not DRIFT's, and you're responsible for them.`,
      ] },
      { h: "3. What DRIFT provides", p: [
        `DRIFT provides software that lets you receive job requests from Customers, see each Customer's offer and exactly what you'd earn before you accept, communicate, navigate, document work with photos, and get paid. That's a lead-generation and payments service. The job itself is an agreement between you and the Customer.`,
      ] },
      { h: "4. Earnings and fees", p: [
        `Customers choose how much to offer for each job. DRIFT may show Customers suggested amounts, but DRIFT does not set the job price. You'll see the Customer's offer and exactly what you'd earn before you accept, and you may pass on any offer.`,
        `You receive 80% of the Customer's offer, 100% of the $10 call-out fee the Customer pays, and 100% of tips. DRIFT keeps 20% of the offer as its service fee for platform access, payment processing, and support. Customers also pay DRIFT a separate $5 booking fee.`,
        `Payouts are made through Stripe Connect. You agree to Stripe's Connected Account Agreement, and you authorize DRIFT to collect payment from Customers on your behalf as your limited payment collection agent. We'll give you at least 14 days' notice in the app before changing our service fee; you can stop using DRIFT at any time.`,
      ] },
      { h: "5. Taxes", p: [
        `You're responsible for all taxes on your earnings, including self-employment tax, and for any sales tax that applies to your services. Provide an accurate W-9. DRIFT or Stripe will issue 1099 forms as the law requires.`,
      ] },
      { h: "6. Your vehicle, equipment, and expenses", p: [
        `You provide and pay for your own vehicle, plow, fuel, maintenance, phone, and tools. You're responsible for keeping them safe, legal, registered, and in good repair.`,
      ] },
      { h: "7. Insurance is your responsibility — DRIFT provides none", loud: true, p: [
        `DRIFT DOES NOT PROVIDE ANY INSURANCE FOR YOU, YOUR VEHICLE, YOUR EQUIPMENT, YOUR HELPERS, OR YOUR WORK, AND DRIFT DOES NOT TELL CUSTOMERS THAT YOU ARE INSURED. Whether to carry insurance, and what kind, is your decision and your responsibility.`,
        `Be aware: many personal auto policies exclude snowplowing and business use, which can leave you personally responsible for an accident or damage. Talk to a licensed insurance agent about general liability and commercial auto coverage.`,
      ] },
      { h: "8. Laws and safety", p: [
        `Follow all laws that apply to you, including traffic and vehicle laws, plow equipment and lighting requirements, local ordinances, and any license or registration your business needs. Hold a valid driver's license. Never work impaired. Don't push or deposit snow or ice onto public roads or sidewalks where the law prohibits it. Be respectful and non-discriminatory toward Customers.`,
      ] },
      { h: "9. Customer information and photos", p: [
        `Use Customer information only to complete that Customer's job, and keep it private. Before-and-after photos you take in the app are shared with the Customer and DRIFT to document the job.`,
      ] },
      { h: "10. Account deactivation", p: [
        `You can close your account at any time. DRIFT may deactivate an account for safety concerns, fraud, violations of law, a material breach of this Agreement, or repeated serious Customer complaints. Declining jobs is never a reason for deactivation.`,
      ] },
      { h: "11. Risks you assume", loud: true, p: [
        `Snow removal and winter driving are dangerous. Risks include collisions, rollovers, getting stuck, equipment failure, hidden objects and hazards, slips and falls, cold exposure, carbon monoxide, back and other injuries, animals, and the condition of Customers' property and the conduct of Customers and others. YOU KNOWINGLY AND VOLUNTARILY ASSUME ALL OF THESE RISKS, KNOWN AND UNKNOWN.`,
      ] },
      { h: "12. Release and waiver — including DRIFT's own negligence", loud: true, p: [
        `TO THE FULLEST EXTENT ALLOWED BY LAW, YOU RELEASE, WAIVE, AND DISCHARGE DRIFT AND ITS OWNERS, MEMBERS, MANAGERS, OFFICERS, EMPLOYEES, AGENTS, SUCCESSORS, AND ASSIGNS (THE "RELEASED PARTIES") FROM ALL CLAIMS FOR PERSONAL INJURY, DEATH, PROPERTY DAMAGE, DAMAGE TO YOUR VEHICLE OR EQUIPMENT, LOST INCOME, OR OTHER LOSS ARISING OUT OF OR RELATING TO YOUR USE OF DRIFT OR ANY JOB — INCLUDING CLAIMS ARISING FROM THE ORDINARY NEGLIGENCE OF DRIFT OR ANY OTHER RELEASED PARTY (for example, errors in maps, directions, outlines, hazard markers, notifications, or job details). YOU PROMISE NOT TO SUE ANY RELEASED PARTY FOR ANY RELEASED CLAIM.`,
        `This release does not cover gross negligence, recklessness, or willful, wanton, or intentional misconduct by DRIFT, or any right that cannot be waived by law. It does not release DRIFT's obligation to pay you earnings you are owed.`,
      ] },
      { h: "13. Indemnification — you agree to defend and cover DRIFT", loud: true, p: [
        `YOU AGREE TO DEFEND, INDEMNIFY, AND HOLD HARMLESS THE RELEASED PARTIES FROM ANY CLAIM, DEMAND, LOSS, FINE, OR EXPENSE (INCLUDING REASONABLE ATTORNEYS' FEES) ARISING FROM YOUR WORK, YOUR VEHICLE OR EQUIPMENT, YOUR HELPERS OR EMPLOYEES, PROPERTY DAMAGE OR INJURY YOU CAUSE, YOUR VIOLATION OF ANY LAW, YOUR TAXES, OR YOUR BREACH OF THIS AGREEMENT — INCLUDING CLAIMS BY CUSTOMERS AND OTHER THIRD PARTIES — EXCEPT TO THE EXTENT CAUSED BY DRIFT'S GROSS NEGLIGENCE OR WILLFUL MISCONDUCT.`,
      ] },
      { h: "14. Limitation of liability", loud: true, p: [
        `TO THE FULLEST EXTENT ALLOWED BY LAW, DRIFT IS NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES OR LOST PROFITS, AND DRIFT'S TOTAL LIABILITY TO YOU FOR ALL CLAIMS IS LIMITED TO THE GREATER OF $100 OR THE SERVICE FEES DRIFT KEPT FROM YOUR JOBS IN THE SIX MONTHS BEFORE THE CLAIM AROSE. This does not limit earnings DRIFT owes you or liability that cannot legally be limited.`,
      ] },
      { h: "15. Disputes: individual arbitration and class action waiver", loud: true, p: [
        `If you have a dispute with DRIFT, email ${EMAIL} first and give us 30 days to resolve it informally. If we can't, YOU AND DRIFT AGREE TO RESOLVE ANY DISPUTE RELATING TO THIS AGREEMENT OR YOUR USE OF DRIFT — INCLUDING ANY CLAIM ABOUT YOUR CLASSIFICATION AS AN INDEPENDENT CONTRACTOR — BY BINDING INDIVIDUAL ARBITRATION administered by the American Arbitration Association, except claims that by law can't be arbitrated and individual claims in small claims court. The Federal Arbitration Act governs. DRIFT will pay the arbitration fees beyond what you would pay to file in court. The hearing may be held by video or in ${VENUE}.`,
        `YOU AND DRIFT WAIVE ANY RIGHT TO A JURY TRIAL AND ANY RIGHT TO BRING OR TAKE PART IN A CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION. If this waiver is found unenforceable for a claim, that claim goes to court instead, and this arbitration section doesn't apply to it.`,
        `You may opt out of this arbitration agreement within 30 days of first accepting it by emailing ${EMAIL} with your name and the words "arbitration opt-out." Opting out won't affect your account.`,
      ] },
      { h: "16. Term, law, and everything else", p: [
        `This Agreement starts when you accept it and continues until either of us ends it, which either of us may do at any time for any reason. Minnesota law governs, except where the Federal Arbitration Act applies. DRIFT may update this Agreement with notice in the app; you'll be asked to agree before going online again. By tapping "Agree" you sign electronically under the federal E-SIGN Act and Minn. Stat. ch. 325L, and DRIFT keeps a record of the version and time. If any part is unenforceable, the rest stays in effect. There is no non-compete — you're free to work anywhere. Questions: ${EMAIL}.`,
      ] },
      { h: "17. Acknowledgment", loud: true, p: [
        `I HAVE READ THIS AGREEMENT. I UNDERSTAND I AM AN INDEPENDENT CONTRACTOR, NOT A DRIFT EMPLOYEE; THAT DRIFT PROVIDES NO INSURANCE; AND THAT I AM GIVING UP SUBSTANTIAL RIGHTS, INCLUDING MY RIGHT TO SUE DRIFT FOR ITS OWN ORDINARY NEGLIGENCE AND TO BRING CLASS ACTIONS. I AGREE VOLUNTARILY.`,
      ] },
    ],
  },
};

// Plain-English summary shown on the customer's consent screen (above the checkbox).
export const CUSTOMER_KEY_POINTS = [
  ["plowtruck", "DRIFT is an app, not a plow company", "Independent local operators do the work. They aren't DRIFT employees, and the job is between you and them."],
  ["shield", "No insurance or vetting from DRIFT", "DRIFT doesn't insure anyone and doesn't check drivers' insurance, licenses, or backgrounds."],
  ["pin", "Mark your hazards", "You're responsible for your property. Anything you don't mark — wells, covers, edging, rocks — is at your risk."],
  ["warning", "You release DRIFT", "You accept the risks of winter property care and give up claims against DRIFT, including for its own ordinary negligence."],
  ["doc", "Disputes: individual arbitration", "No class actions. You can opt out of arbitration within 30 days."],
];

// Each driver acknowledgment is its own checkbox (conspicuous + specific).
export const DRIVER_ACKS = [
  { id: "ic", title: "I run my own business", text: "I'm an independent contractor, not a DRIFT employee. DRIFT isn't my boss — I choose if, when, and how I work, and I can decline any job with no penalty. I'll get a 1099 and handle my own taxes." },
  { id: "ins", title: "DRIFT provides no insurance", text: "I'm solely responsible for my own liability, vehicle, equipment, and injury coverage. My personal auto policy may not cover plowing." },
  { id: "risk", title: "I accept the risks and release DRIFT", text: "Plowing and winter driving are dangerous. I assume those risks and release DRIFT from claims — including claims based on DRIFT's own ordinary negligence." },
  { id: "indem", title: "I'll cover claims from my work", text: "I'll defend and indemnify DRIFT against claims arising from my work, my vehicle, my helpers, or damage and injuries I cause." },
  { id: "arb", title: "Disputes go to individual arbitration", text: "No class or collective actions. I can opt out of arbitration by email within 30 days." },
];
