/**
 * The legal documents (TUI-85): terms of service, privacy policy and data processing agreement,
 * shown by LegalPage at /terms, /privacy and /dpa. Drafts written from what the app actually
 * stores and the services it uses; the owner has them reviewed before relying on them. English
 * only, outside the UI catalog: a translation of a legal document is a new document.
 *
 * A block is a paragraph, or a list when it's an array.
 */
export type LegalBlock = string | string[];
export type LegalSection = { id: string; title: string; blocks: LegalBlock[] };
export type LegalDocument = {
  slug: 'terms' | 'privacy' | 'dpa';
  title: string;
  updated: string;
  summary: string[];
  sections: LegalSection[];
};

/** Who runs EduStrux, and how to reach them. One place, so every document says the same. */
export const OPERATOR = {
  name: 'Anojan ST',
  place: 'Auckland, New Zealand',
  email: 'hello@edustrux.com',
};

const WHO = `EduStrux is run by ${OPERATOR.name}, a sole trader based in ${OPERATOR.place} ("we", "us", "our").`;
const UPDATED = '31 October 2026';

const SUBPROCESSORS = [
  'Cloudflare: hosting, the database and file storage. Your data is stored in Cloudflare’s Oceania region; requests are served from Cloudflare’s network worldwide. (United States company)',
  'Clerk: sign-in, and the name and email address of each person with an account. (United States)',
  'Resend: delivering emails, such as invitations, invoices and announcements. (United States)',
  'Stripe: subscription billing for EduStrux plans, once billing is switched on. Stripe receives the billing details of the person who subscribes, never student or family data. (United States and Australia)',
];

const terms: LegalDocument = {
  slug: 'terms',
  title: 'Terms of service',
  updated: UPDATED,
  summary: [
    'EduStrux is software for running a tuition centre. You own the data you put in it, and you are responsible for it and for what you do with the app.',
    'It’s provided as it is. We work hard to keep it running and your data safe, but we can’t promise it will never fail, so keep your own records and exports.',
    'Our liability is limited to what you paid us in the last 12 months. These terms are for businesses, under New Zealand law.',
  ],
  sections: [
    {
      id: 'about',
      title: 'About these terms',
      blocks: [
        WHO,
        'These terms are an agreement between us and the person or organisation that creates an EduStrux account for a centre ("you"). By creating an account or using EduStrux, you agree to them. If you accept them for a business or other organisation, you confirm you have the authority to bind it, and "you" means that organisation.',
        'The Privacy policy and the Data processing agreement are part of these terms.',
        'You must be at least 18 to create an account.',
      ],
    },
    {
      id: 'service',
      title: 'The service',
      blocks: [
        'EduStrux lets you manage classes, timetables, students and families, attendance, make-up lessons, invoices, payment records and messages, and lets the staff and parents you invite see the parts that concern them (the "service").',
        'EduStrux is a new product. Features will change: we may add, change or remove features, and we’ll tell you in advance if we remove one you rely on, where we reasonably can.',
        'EduStrux does not process payments between you and your families. It records payments you receive in other ways.',
      ],
    },
    {
      id: 'accounts',
      title: 'Your account and your users',
      blocks: [
        'You are responsible for everything done under your centre’s account, including by the staff and parents you invite. Give each person only the access they need, and remove people who should no longer have it.',
        'Keep sign-in details secure and tell us straight away if you think someone has accessed your account without permission.',
        'Make sure the information you give us about yourself and your business is accurate and kept up to date.',
      ],
    },
    {
      id: 'plans',
      title: 'Trial, plans and payment',
      blocks: [
        'A new centre gets a free 14-day trial. When it ends, the centre becomes read-only until you choose a plan. Nothing is deleted when a trial ends.',
        'Each plan has a price and a limit on the number of students with an active enrolment. The current plans and prices are shown on our website and in the app.',
        'Plans are billed in advance, monthly or yearly, through our payment provider, and renew automatically until you cancel. Prices are in the currency shown when you subscribe and exclude any taxes that apply, which you pay.',
        'You can cancel at any time; the plan runs until the end of the period you have paid for. Fees already paid are not refunded, except where the law requires.',
        'We may change prices. We’ll give you at least 30 days’ notice by email, and the new price applies from your next renewal after that.',
        'If a payment fails and isn’t fixed, we may make your centre read-only or suspend it until it is.',
      ],
    },
    {
      id: 'data',
      title: 'Your data',
      blocks: [
        'You own the data you and your users put into EduStrux ("your data"), including information about students, families and staff.',
        'You give us permission to store, copy, process and display your data only as needed to provide, secure and support the service, and as described in the Privacy policy and the Data processing agreement. We don’t sell your data or use it for advertising.',
        'You are responsible for your data and for having the right to put it in EduStrux. In particular, you are responsible for:',
        [
          'telling families and staff how you use their information, and getting any consent you need, including from parents or guardians for information about children;',
          'the accuracy of what you enter, and correcting it when asked;',
          'keeping only what you need: don’t store sensitive information (such as health details beyond what a feature asks for) that EduStrux isn’t designed to hold;',
          'complying with the privacy, education and other laws that apply to your business.',
        ],
        'You can export your data at any time from the app.',
      ],
    },
    {
      id: 'records',
      title: 'Invoices, fees and other records you make',
      blocks: [
        'EduStrux calculates amounts, invoices, discounts, tax, credits and reports from the settings, prices and records you enter. You are responsible for checking them before you rely on them or send them, and for your prices, your tax registration and returns, and your dealings with your families.',
        'Nothing in EduStrux is accounting, tax, legal or education advice.',
      ],
    },
    {
      id: 'use',
      title: 'Acceptable use',
      blocks: [
        'You and your users must not:',
        [
          'break the law, or infringe anyone’s rights, through EduStrux;',
          'send spam or messages people haven’t agreed to receive;',
          'upload malicious code, or try to get around security, access other centres’ data, or overload the service;',
          'copy, resell or reverse-engineer the service, or use it to build a competing product;',
          'use automated tools to access the service other than through the features we provide.',
        ],
        'We may remove content or suspend access that breaks these rules, and we’ll tell you why unless the law or a risk to others prevents it.',
      ],
    },
    {
      id: 'availability',
      title: 'Availability, backups and support',
      blocks: [
        'We aim to keep EduStrux available and working, but it may be unavailable at times, for example for maintenance, because of a fault, or because of a problem with one of our providers. We don’t guarantee any level of availability.',
        'We back up the service every night and keep backups for 14 days, so we can recover from a failure. Backups are not a substitute for your own records: export your data regularly.',
        `We provide support by email at ${OPERATOR.email}, on a best-effort basis.`,
      ],
    },
    {
      id: 'ending',
      title: 'Cancelling, suspension and closing an account',
      blocks: [
        'You can stop using EduStrux and cancel your plan at any time.',
        'We may suspend or close your account if you seriously or repeatedly break these terms, don’t pay, or use EduStrux in a way that risks harm to us, other customers or anyone else. Where it is reasonable, we’ll warn you first and give you a chance to fix the problem.',
        'We may stop offering EduStrux altogether. If we do, we’ll give you at least 60 days’ notice so you can export your data, and refund any fees paid for the time after it stops.',
        'After an account is closed, export what you need. We may delete your data 90 days after the account closes, and we’ll delete it sooner if you ask. Backups expire within 14 days after that.',
      ],
    },
    {
      id: 'ip',
      title: 'Our intellectual property',
      blocks: [
        'We own EduStrux, its software, design and brand. These terms give you the right to use the service while your account is active; they don’t transfer any ownership to you.',
        'If you send us ideas or feedback, we may use them freely, without owing you anything.',
      ],
    },
    {
      id: 'warranties',
      title: 'No warranties',
      blocks: [
        'To the extent the law allows, EduStrux is provided "as is" and "as available". We don’t promise that it will be uninterrupted, error-free or secure against every threat, that it will meet your particular needs, or that calculations and reports will be free of errors.',
      ],
    },
    {
      id: 'liability',
      title: 'Limitation of liability',
      blocks: [
        'To the extent the law allows:',
        [
          'we are not liable for any indirect or consequential loss, or for any loss of profit, revenue, business, goodwill, opportunity or data, however it arises, even if we were told it was possible;',
          'we are not liable for loss caused by your data, your users, your decisions, events outside our reasonable control, or the acts or failures of the providers we rely on;',
          'our total liability for everything arising out of or relating to EduStrux and these terms, whether in contract, tort (including negligence), under statute or otherwise, is limited to the fees you paid us in the 12 months before the event that gave rise to the claim, or NZ$100 if you paid nothing.',
        ],
        'Nothing in these terms limits liability that cannot be limited by law.',
      ],
    },
    {
      id: 'indemnity',
      title: 'Your responsibility for claims',
      blocks: [
        'You agree to cover our reasonable losses and costs (including legal costs) from any claim brought against us by a third party, including your staff, families or students, that arises from your data, your use of EduStrux, or your breach of these terms or the law.',
      ],
    },
    {
      id: 'consumer',
      title: 'Business use and consumer law',
      blocks: [
        'EduStrux is supplied for business purposes and you acquire it in trade. To the extent the law allows, the Consumer Guarantees Act 1993 does not apply, and sections 9, 12A, 13 and 14(1) of the Fair Trading Act 1986 do not apply. You and we agree that it is fair and reasonable to be bound by this clause.',
        'If you are using EduStrux as a consumer, nothing in these terms takes away rights you have under consumer law that can’t be excluded.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to these terms',
      blocks: [
        'We may update these terms. If a change is material, we’ll tell you by email or in the app at least 30 days before it takes effect. If you keep using EduStrux after a change takes effect, you accept the new terms; if you don’t accept them, you can cancel before then.',
      ],
    },
    {
      id: 'general',
      title: 'General',
      blocks: [
        'These terms are governed by the laws of New Zealand, and the courts of New Zealand have exclusive jurisdiction over any dispute about them.',
        'We are not responsible for delay or failure caused by events outside our reasonable control.',
        'We may transfer these terms to someone who takes over EduStrux, and we’ll tell you if we do. You may not transfer them without our written agreement.',
        'If part of these terms can’t be enforced, the rest still applies. Not enforcing a right straight away doesn’t mean giving it up. These terms, with the documents they refer to, are the whole agreement between you and us about EduStrux.',
        'We send notices to the email address of your account’s owner. You can send notices to us by email.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        `${OPERATOR.name}, trading as EduStrux, ${OPERATOR.place}. Email ${OPERATOR.email}.`,
      ],
    },
  ],
};

const privacy: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy policy',
  updated: UPDATED,
  summary: [
    'Centres use EduStrux to keep records about their students and families. The centre decides what goes in and is responsible for it; we store and process it for them. If you’re a parent, ask your centre first.',
    'We keep only what a feature needs, don’t sell anything, don’t show ads, don’t use tracking cookies, and don’t train AI on your data.',
    'Data is stored with Cloudflare in the Oceania region. A few trusted providers help us run the service.',
  ],
  sections: [
    {
      id: 'about',
      title: 'Who we are and what this covers',
      blocks: [
        WHO,
        'This policy explains how we handle personal information, under New Zealand’s Privacy Act 2020. It covers two kinds of information:',
        [
          'information about the people who use EduStrux to run a centre, such as owners and staff, and about people who contact us or visit our website: for this, we are responsible;',
          'information a centre puts into EduStrux about its students, families and staff, and that families send through a centre’s forms: for this, the centre is responsible, and we hold and process it on the centre’s behalf, as set out in our Data processing agreement.',
        ],
        'If you’re a parent or student and have a question about information a centre holds about you, contact the centre first. We’ll help the centre answer.',
      ],
    },
    {
      id: 'collect',
      title: 'What we collect',
      blocks: [
        'Account information: your name and email address, the centres you belong to and your role in each, and your sign-in history (held by our sign-in provider).',
        'Information centres enter, which can include:',
        [
          'students’ names, grade levels, classes and enrolments, attendance, absences and make-up lessons, lesson notes and homework;',
          'parents’ and guardians’ names, email addresses and phone numbers, and which of them is an emergency contact;',
          'consents recorded for a student, such as for photos or medical treatment, with any note the centre adds;',
          'invoices, payments, credits and bank references for each family;',
          'messages the centre sends, and whether each email was delivered;',
          'files the centre uploads, and enquiries and enrolment requests sent through the centre’s forms.',
        ],
        'Billing information: when a centre subscribes, our payment provider handles the card and billing details. We never see full card numbers.',
        'Technical information: our servers log requests, including IP address and browser details, and keep the logs for up to 7 days for security and fixing faults. To stop abuse of the public forms, we keep a one-way scrambled (hashed) form of the sender’s IP address, not the address itself.',
        'Cookies: we use only the cookies needed to keep you signed in, and your browser’s storage for display preferences. We don’t use advertising or analytics trackers.',
      ],
    },
    {
      id: 'use',
      title: 'How we use it',
      blocks: [
        'We use personal information to:',
        [
          'provide EduStrux: sign people in, show each person what their role allows, and keep the centre’s records;',
          'send emails on a centre’s behalf, such as invitations, invoices, reminders and announcements;',
          'bill for subscriptions;',
          'support centres, and answer questions;',
          'keep the service secure, prevent abuse and fix faults;',
          'meet our legal obligations.',
        ],
        'We don’t sell personal information, use it for advertising, or use it to train artificial intelligence models.',
      ],
    },
    {
      id: 'share',
      title: 'Who we share it with',
      blocks: [
        'We use these providers to run EduStrux. They handle personal information only to provide their service to us:',
        SUBPROCESSORS,
        'We may also disclose information when the law requires it, to protect people from serious harm, or to someone who takes over EduStrux, who must then handle it under this policy.',
      ],
    },
    {
      id: 'overseas',
      title: 'Information sent overseas',
      blocks: [
        'Some of our providers are based outside New Zealand, mainly in the United States and Australia, so information may be stored or processed there. We choose providers that protect personal information in ways comparable to the Privacy Act, and rely on their contractual commitments to do so.',
      ],
    },
    {
      id: 'security',
      title: 'How we protect it',
      blocks: [
        [
          'all traffic is encrypted (HTTPS);',
          'each centre’s data is kept separate, and each person sees only what their role allows;',
          'changes to records are logged, with who made them;',
          'the service is backed up every night;',
          'we store only what a feature can’t work without, and erase what is no longer needed.',
        ],
        'No system is perfectly secure. If you think your account has been compromised, contact us straight away.',
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep it',
      blocks: [
        [
          'Account information: while the account is active, and as needed afterwards for legal or accounting purposes.',
          'Centre records: as long as the centre keeps them. A centre can erase a family at any time. A family with no activity for 6 months is erased automatically, and once the number of years the centre sets for keeping financial records has passed, it is deleted completely.',
          'After a centre’s account closes: until the centre asks us to delete it, or 90 days, whichever comes first.',
          'Backups: 14 days. Server logs: 7 days. Data exports: 7 days.',
        ],
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      blocks: [
        'You can ask to see the personal information we hold about you, and to have it corrected. For information a centre holds, ask the centre; we’ll help it respond. We’ll answer requests made to us within 20 working days.',
        `To make a request, email ${OPERATOR.email}. We may need to confirm who you are first.`,
        'If you’re not happy with how we’ve handled your information, you can complain to the Office of the Privacy Commissioner (privacy.org.nz).',
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        'Information about children is entered by their centre, which is responsible for telling parents and getting any consent needed. Students don’t have their own accounts: parents and guardians sign in instead.',
      ],
    },
    {
      id: 'breaches',
      title: 'If something goes wrong',
      blocks: [
        'If a privacy breach affects information in EduStrux, we’ll tell the affected centres without undue delay, and we’ll notify the Privacy Commissioner and affected people where the Privacy Act requires it.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        'We’ll update this policy when what we do changes, and change the date at the top. If a change is significant, we’ll tell centres by email or in the app.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        `${OPERATOR.name}, trading as EduStrux, ${OPERATOR.place}. Email ${OPERATOR.email}.`,
      ],
    },
  ],
};

const dpa: LegalDocument = {
  slug: 'dpa',
  title: 'Data processing agreement',
  updated: UPDATED,
  summary: [
    'Your centre decides what personal information goes into EduStrux and why. We store and process it only to provide the service to you.',
    'We keep it secure, use only the providers listed here, tell you about a breach without undue delay, and help you answer requests from families.',
    'You can export your data at any time, and we delete it after your account closes.',
  ],
  sections: [
    {
      id: 'about',
      title: 'About this agreement',
      blocks: [
        WHO,
        'This agreement is part of our Terms of service. It applies to personal information that you, the centre ("you"), and your users put into EduStrux, or that families send through your forms ("centre data").',
        'You are responsible for centre data and decide what is collected and why. We hold and process it on your behalf. Under New Zealand’s Privacy Act 2020, we hold it as your agent, and you remain responsible for it.',
      ],
    },
    {
      id: 'instructions',
      title: 'What we do with centre data',
      blocks: [
        'We process centre data only to provide, secure and support EduStrux, as described in the Terms of service and Privacy policy, and as you instruct us through the app or in writing. We don’t use it for our own purposes, sell it, or use it for advertising or to train AI models.',
        'If the law requires us to process centre data differently, we’ll tell you first, unless the law prevents it.',
      ],
    },
    {
      id: 'yours',
      title: 'Your responsibilities',
      blocks: [
        'You confirm you have the right to put centre data into EduStrux, that you have told the people concerned how it is used, and that you have any consent needed, including from parents or guardians for information about children.',
      ],
    },
    {
      id: 'people',
      title: 'Confidentiality',
      blocks: [
        'Only people working on EduStrux who need access to centre data to run or support the service can access it, and they are bound to keep it confidential.',
      ],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [
        'We take reasonable steps to protect centre data, including:',
        [
          'encryption of all traffic;',
          'keeping each centre’s data separate, and access by role;',
          'a log of changes to records;',
          'nightly backups kept for 14 days;',
          'storing only what a feature needs, and erasing data that is no longer needed.',
        ],
      ],
    },
    {
      id: 'subprocessors',
      title: 'Our providers',
      blocks: [
        'You agree that we use these providers to process centre data for us:',
        SUBPROCESSORS,
        'We’ll tell you by email at least 30 days before adding or replacing a provider that processes centre data. If you object on reasonable grounds and we can’t address it, you can cancel your plan, and we’ll refund fees paid for the time after you cancel.',
      ],
    },
    {
      id: 'overseas',
      title: 'Overseas processing',
      blocks: [
        'Centre data is stored in Cloudflare’s Oceania region, and may be processed in the United States and Australia by the providers above. We rely on their contractual commitments to protect it in ways comparable to the Privacy Act.',
        'If you are subject to the EU or UK General Data Protection Regulation, contact us before putting personal information into EduStrux, so we can agree the terms those laws require.',
      ],
    },
    {
      id: 'requests',
      title: 'Requests from families and staff',
      blocks: [
        'If someone asks us directly to see or correct information you hold about them, we’ll pass the request to you. The app lets you view, correct, export and erase a family’s information, and we’ll give reasonable help if you need more.',
      ],
    },
    {
      id: 'breaches',
      title: 'Privacy breaches',
      blocks: [
        'If we become aware of a breach affecting centre data, we’ll tell you without undue delay, and aim to within 72 hours, with what we know about what happened, what information is affected, and what we’re doing about it. We’ll help you decide whether the breach must be notified, and with notifying the Privacy Commissioner and affected people.',
      ],
    },
    {
      id: 'deletion',
      title: 'Return and deletion',
      blocks: [
        'You can export centre data from the app at any time. After your account closes, we delete centre data when you ask, or after 90 days, whichever comes first. Backups expire within 14 days after that. We may keep information the law requires us to keep.',
      ],
    },
    {
      id: 'audits',
      title: 'Information and reviews',
      blocks: [
        'On reasonable written request, no more than once a year, we’ll answer questions or a reasonable questionnaire about how we protect centre data.',
      ],
    },
    {
      id: 'liability',
      title: 'Liability and precedence',
      blocks: [
        'The limits of liability in the Terms of service apply to this agreement. If this agreement and the Terms of service conflict about centre data, this agreement applies.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        `${OPERATOR.name}, trading as EduStrux, ${OPERATOR.place}. Email ${OPERATOR.email}.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocument['slug'], LegalDocument> = {
  terms,
  privacy,
  dpa,
};
