/* Use-case pages (/for/:slug): one real situation each, with the prompt to use, the form Relay builds, the rules it
   enforces and what to ask afterwards. Every page must describe only what Relay actually does today. */

export interface UseCase {
  slug: string;
  /** Short name for cards and links. */
  name: string;
  /** One line for cards. */
  summary: string;
  /** Page heading. */
  title: string;
  /** <title>, about 60 characters. */
  metaTitle: string;
  /** Meta description, about 150 characters. */
  description: string;
  /** The problem today, in the reader's words. */
  intro: string;
  /** What to say to the assistant. */
  prompt: string;
  /** The form Relay builds: [question, kind, note]. */
  fields: [string, string, string?][];
  /** Rules Relay keeps while the form runs. */
  rules: string[];
  /** What to ask afterwards, and what comes back. */
  asks: { q: string; a: string }[];
  /** Honest notes: limits and good practice. */
  tips: string[];
  related: string[];
}

export const USE_CASES: UseCase[] = [
  {
    slug: "event-rsvp",
    name: "Event RSVPs",
    summary: "Sign-ups with a seat limit, a deadline and a link to the venue.",
    title: "Event RSVPs you run from ChatGPT or Claude",
    metaTitle: "Event RSVP form with ChatGPT or Claude · Relay",
    description:
      "Create an event RSVP form by asking ChatGPT or Claude. Set seats and a deadline in one sentence, share one link, then ask who's coming.",
    intro:
      "Meetups, workshops, dinners and launches all need the same thing: who's coming, how many spots are left, and what you need to prepare. Usually that means a form builder, a spreadsheet and a lot of manual counting. With Relay, you describe the event to your assistant and ask it how sign-ups are going.",
    prompt:
      "Make an RSVP for our March meetup. Name, email, dietary needs and whether they're bringing a guest. 40 spots, close March 10th at 6pm, and after they sign up, link them to the venue map.",
    fields: [
      ["Name", "Short text"],
      ["Email", "Email", "checked for a valid address"],
      ["Dietary needs", "Multiple choice"],
      ["Bringing a guest?", "Single choice"],
      ["Guest's name", "Short text", "only shown if they're bringing a guest"],
    ],
    rules: [
      "Shows how many spots are left and closes by itself at 40 responses.",
      "Closes on March 10th at 6pm and tells late visitors why.",
      "After submitting, people see your thank-you message and a button to the venue map.",
    ],
    asks: [
      { q: "How many spots are left?", a: "An exact count of sign-ups and remaining spots, straight from Relay." },
      { q: "Anything new since yesterday?", a: "Only the responses you haven't seen yet. Relay remembers what you've already checked." },
      { q: "What dietary needs do we have?", a: "A count for each option, so you can order food with real numbers." },
      { q: "Export the guest list.", a: "A CSV link for Excel or Google Sheets, valid for 15 minutes." },
    ],
    tips: [
      "Counting a guest as a second spot? Ask for a separate RSVP per person, because the limit counts responses, not people.",
      "Want sign-ups in Slack or your own tools as they arrive? On a self-hosted Relay, a signed webhook can send each response there.",
    ],
    related: ["volunteer-signups", "course-feedback", "waitlist"],
  },
  {
    slug: "waitlist",
    name: "Waitlists and beta sign-ups",
    summary: "Collect interest for a launch and find out who to invite first.",
    title: "A product waitlist you manage by asking your AI assistant",
    metaTitle: "Waitlist and beta sign-up form with ChatGPT or Claude · Relay",
    description:
      "Build a waitlist or beta sign-up form by asking ChatGPT or Claude, embed it on your site, then ask your assistant who to invite first.",
    intro:
      "A waitlist is only useful if you can act on it: who signed up, what they need and who to invite first. Most waitlist forms stop at collecting emails. With Relay, your assistant builds the form, and later reads the answers with you to pick your first users.",
    prompt:
      "Make a beta waitlist for my app. Email, their role, team size, the tool they use today and what they'd want it to do. Use my brand colour #5B5BD6 and my logo at mysite.com/logo.png, and let it be embedded on mysite.com.",
    fields: [
      ["Email", "Email", "checked for a valid address"],
      ["Role", "Single choice"],
      ["Team size", "Single choice", "for example 1, 2–10, 11–50, 50+"],
      ["What do you use today?", "Short text"],
      ["What would you want it to do?", "Long text"],
    ],
    rules: [
      "Uses your colour (adjusted for readability) and your logo.",
      "Can be embedded only on the sites you list.",
      "Shows a thank-you message, with an optional button such as \"Follow us for updates\".",
    ],
    asks: [
      { q: "Any new sign-ups?", a: "The responses that arrived since you last checked, and the exact total." },
      { q: "What's the split by team size?", a: "A count for each option, calculated by Relay." },
      { q: "Who looks like a good first user? Draft them an invite.", a: "Your assistant reads the answers, picks candidates and drafts messages. You decide who gets them." },
    ],
    tips: [
      "Planning to cap the beta? Set a response limit so the form closes when you have enough people.",
      "Hosting Relay yourself? A signed webhook can send each new sign-up to your email tool or CRM.",
    ],
    related: ["lead-capture", "research-screener", "customer-feedback"],
  },
  {
    slug: "customer-feedback",
    name: "Customer feedback and NPS",
    summary: "Ask how likely customers are to recommend you, and why.",
    title: "Customer feedback and NPS surveys run from your AI assistant",
    metaTitle: "NPS and customer feedback survey with ChatGPT or Claude · Relay",
    description:
      "Create an NPS or customer feedback survey by asking ChatGPT or Claude. Relay calculates your score exactly; your assistant summarises the comments.",
    intro:
      "Customer feedback tends to end up in a spreadsheet nobody reads. The score is easy to work out, but the comments, where the real insight is, take time to go through. With Relay, the score is calculated for you, and your assistant reads every comment.",
    prompt:
      "Make a short customer feedback survey: how likely they are to recommend us from 0 to 10, what we do well, and what we should improve. Make the last two optional.",
    fields: [
      ["How likely are you to recommend us?", "0–10 scale"],
      ["What do we do well?", "Long text", "optional"],
      ["What should we improve?", "Long text", "optional"],
    ],
    rules: [
      "Anyone with the link can answer, without an account.",
      "Shows your thank-you message after submitting.",
      "You can close it at any time, or set a closing date.",
    ],
    asks: [
      { q: "What's our NPS?", a: "Your exact Net Promoter Score and the count for every score from 0 to 10, calculated by Relay." },
      { q: "What are the top complaints?", a: "Your assistant reads the \"improve\" answers and groups them into themes." },
      { q: "What do low scorers say compared with high scorers?", a: "Your assistant compares the comments of people who scored 0–6 with those who scored 9–10." },
    ],
    tips: [
      "Share the link where customers already are: a receipt, an email or a QR code at the counter.",
      "Ask for an email address only if you plan to follow up, and say so on the form.",
    ],
    related: ["course-feedback", "reader-survey", "team-pulse"],
  },
  {
    slug: "volunteer-signups",
    name: "Volunteer sign-ups",
    summary: "Fill shifts for an event or a regular activity without a spreadsheet.",
    title: "Volunteer sign-ups for nonprofits and community groups",
    metaTitle: "Volunteer sign-up form with ChatGPT or Claude · Relay",
    description:
      "Create volunteer sign-up forms by asking ChatGPT or Claude. Each shift closes when it's full, and your assistant tells you who's coming.",
    intro:
      "Volunteer coordinators juggle sign-up sheets, reminder messages and last-minute gaps. A form that closes when a shift is full and an assistant that can tell you who's on which shift saves hours every week. Relay is free for small groups, and open source if your organisation prefers to host it.",
    prompt:
      "Make volunteer sign-ups for the Saturday food drive: one form for the morning shift and one for the afternoon. Name, phone, and whether they've volunteered before. 15 people per shift, close Friday at noon.",
    fields: [
      ["Name", "Short text"],
      ["Phone", "Phone"],
      ["Have you volunteered with us before?", "Single choice"],
      ["Anything we should know?", "Long text", "optional"],
    ],
    rules: [
      "Each shift's form closes by itself at 15 people and shows how many spots are left.",
      "Both forms close on Friday at noon.",
      "After signing up, volunteers see where and when to arrive.",
    ],
    asks: [
      { q: "Which shift still needs people?", a: "Exact counts for each shift's form." },
      { q: "Who's new this time?", a: "Your assistant lists first-time volunteers so you can welcome them." },
      { q: "Export both lists so I can send reminders.", a: "A CSV link for each form." },
    ],
    tips: [
      "Use one form per shift: the limit applies to a whole form, not to one answer option.",
      "Relay doesn't send reminders itself. Export the list, or on a self-hosted Relay, use a webhook to send sign-ups to your messaging tool.",
    ],
    related: ["event-rsvp", "team-pulse", "course-feedback"],
  },
  {
    slug: "reader-survey",
    name: "Newsletter reader surveys",
    summary: "Find out what your readers want, without another tool to learn.",
    title: "Reader surveys for newsletters and creators",
    metaTitle: "Newsletter reader survey with ChatGPT or Claude · Relay",
    description:
      "Survey your newsletter readers by asking ChatGPT or Claude. Drop one link into your next post, then ask what topics readers want most.",
    intro:
      "Writers want to know what readers value, but setting up a survey and reading hundreds of answers takes time away from writing. With Relay, you describe the survey in one sentence, add the link to your next issue, and ask your assistant what readers said.",
    prompt:
      "Make a reader survey for my newsletter: how they found it, which topics they want more of, how often they read it, and how likely they are to recommend it from 0 to 10. Add an optional comment box.",
    fields: [
      ["How did you find the newsletter?", "Single choice"],
      ["Which topics do you want more of?", "Multiple choice"],
      ["How often do you read it?", "Single choice"],
      ["How likely are you to recommend it?", "0–10 scale"],
      ["Anything else?", "Long text", "optional"],
    ],
    rules: [
      "Readers answer without an account.",
      "Close it after a week, or when you've heard from enough people.",
      "The thank-you message can link back to your archive.",
    ],
    asks: [
      { q: "Which topics do readers want most?", a: "A count for each topic, exactly." },
      { q: "Where do most readers come from?", a: "The split by source, calculated by Relay." },
      { q: "What's my NPS, and what do the comments say?", a: "The exact score, and your assistant's summary of the comments." },
    ],
    tips: [
      "Keep it under five questions: response rates drop with every extra one.",
      "Run the same survey every few months and ask your assistant to compare the results.",
    ],
    related: ["customer-feedback", "research-screener", "waitlist"],
  },
  {
    slug: "job-applications",
    name: "Job applications",
    summary: "Collect applications and shortlist them with your assistant.",
    title: "Job application forms you shortlist with your AI assistant",
    metaTitle: "Job application form with ChatGPT or Claude · Relay",
    description:
      "Create a job application form by asking ChatGPT or Claude. Set a closing date, collect CV links, then ask your assistant to help shortlist.",
    intro:
      "Small teams hiring for one role don't need an applicant tracking system, but a shared inbox gets messy fast. With Relay, applications arrive in one place, close on time, and your assistant helps you read them. You still make every decision.",
    prompt:
      "Make an application form for a part-time designer. Name, email, a link to their portfolio, a link to their CV, years of experience, their earliest start date and why they want the role. Close on the 30th.",
    fields: [
      ["Name", "Short text"],
      ["Email", "Email", "checked for a valid address"],
      ["Portfolio", "Link"],
      ["CV", "Link", "a shared link, since Relay doesn't take file uploads"],
      ["Years of experience", "Number"],
      ["Earliest start date", "Date"],
      ["Why this role?", "Long text"],
    ],
    rules: [
      "Closes on the 30th and tells late applicants why.",
      "The thank-you message can say when you'll reply.",
      "You can add a question later; Relay refuses edits that would change the meaning of answers already given.",
    ],
    asks: [
      { q: "How many applications so far?", a: "An exact count, and how many are new since you last checked." },
      { q: "Who has 3+ years and can start this month?", a: "Your assistant filters the answers; the numbers come from Relay." },
      { q: "Summarise each candidate in two lines.", a: "A short summary per application for a first read. Read the full answers before deciding." },
    ],
    tips: [
      "Use your assistant to organise and summarise, not to reject people automatically. You stay responsible for hiring decisions.",
      "Tell applicants how their data will be used, and only ask for what you need.",
    ],
    related: ["research-screener", "lead-capture", "waitlist"],
  },
  {
    slug: "research-screener",
    name: "User research screeners",
    summary: "Recruit the right people for interviews and usability tests.",
    title: "User research screeners and interview recruitment",
    metaTitle: "User research screener survey with ChatGPT or Claude · Relay",
    description:
      "Build a research screener by asking ChatGPT or Claude. Stop at the number of responses you need, then ask your assistant who fits your criteria.",
    intro:
      "Recruiting interview participants means screening for the right people, stopping once you have enough, and following up quickly. Relay handles the form and the limits; your assistant helps you find the best matches. The counts come from Relay, so they're exact.",
    prompt:
      "Make a screener for 5 user interviews about expense tools. Role, company size, how often they file expenses, which tool they use, and an email to contact them. Close at 40 responses, and after they submit, link them to my calendar.",
    fields: [
      ["Role", "Single choice"],
      ["Company size", "Single choice"],
      ["How often do you file expenses?", "Single choice"],
      ["Which tool do you use?", "Short text"],
      ["Email", "Email", "for scheduling"],
    ],
    rules: [
      "Closes by itself at 40 responses.",
      "After submitting, people see a button to book a time in your calendar.",
      "Conditional questions can ask follow-ups only to the people they apply to.",
    ],
    asks: [
      { q: "Who matches: finance roles at 50+ person companies who file weekly?", a: "Your assistant filters the responses against your criteria." },
      { q: "What's the split by tool?", a: "Exact counts for each answer." },
      { q: "Draft invitations for the top five.", a: "Your assistant writes them; you review and send." },
    ],
    tips: [
      "Ask screening questions without hinting at the right answer, so people don't guess what you want.",
      "If your data must stay in-house, host Relay yourself: it's open source and free.",
    ],
    related: ["customer-feedback", "waitlist", "job-applications"],
  },
  {
    slug: "course-feedback",
    name: "Course and workshop feedback",
    summary: "Ratings and comments from participants, summarised for you.",
    title: "Course and workshop feedback forms for trainers and teachers",
    metaTitle: "Workshop and course feedback form with ChatGPT or Claude · Relay",
    description:
      "Collect course or workshop feedback by asking ChatGPT or Claude. Relay calculates average ratings exactly; your assistant summarises comments.",
    intro:
      "After a session, trainers want two things: an honest rating and specific comments they can act on. Relay gives you exact averages and lets your assistant read every comment, so you can improve the next session in minutes, not hours.",
    prompt:
      "Make a feedback form for today's workshop: overall rating from 1 to 5, how useful the content was from 1 to 5, the pace (too slow, right, too fast), the most useful part and one thing to change. Close it in three days.",
    fields: [
      ["Overall rating", "Rating 1–5"],
      ["How useful was the content?", "Rating 1–5"],
      ["The pace was…", "Single choice"],
      ["Most useful part", "Long text"],
      ["One thing to change", "Long text"],
    ],
    rules: [
      "Closes after three days.",
      "Participants answer without an account.",
      "The thank-you message can link to the slides or your next session.",
    ],
    asks: [
      { q: "What's the average rating?", a: "Exact averages and medians for each rating, from Relay." },
      { q: "Was the pace right?", a: "A count for each answer." },
      { q: "What should I change next time?", a: "Your assistant groups the suggestions into themes." },
    ],
    tips: [
      "Share the link in the last five minutes of the session: response rates are much higher than by email later.",
      "Running the same workshop again? Ask your assistant to compare this session with the last one.",
    ],
    related: ["customer-feedback", "event-rsvp", "team-pulse"],
  },
  {
    slug: "lead-capture",
    name: "Lead capture and enquiries",
    summary: "Qualify enquiries and send good leads straight to a booking link.",
    title: "Lead capture and enquiry forms with a next step built in",
    metaTitle: "Lead capture and enquiry form with ChatGPT or Claude · Relay",
    description:
      "Create a lead capture or consultation form by asking ChatGPT or Claude. Send people to your booking link, then ask your assistant who to follow up.",
    intro:
      "A contact form that just sends an email leaves the hard part to you: working out who's a good fit and replying quickly. Relay sends people straight to a next step, like booking a call, and your assistant helps you prioritise and draft follow-ups.",
    prompt:
      "Make an enquiry form for my consulting work. Name, email, company, budget range, what they need help with, and when they want to start. After they submit, show a button to book a call.",
    fields: [
      ["Name", "Short text"],
      ["Email", "Email", "checked for a valid address"],
      ["Company", "Short text"],
      ["Budget range", "Single choice"],
      ["What do you need help with?", "Long text"],
      ["When do you want to start?", "Single choice"],
    ],
    rules: [
      "After submitting, people see a \"Book a call\" button linking to your calendar.",
      "Can use your brand colour and logo, and be embedded on your site.",
      "On a self-hosted Relay, a signed webhook can send each enquiry to Slack, Zapier, n8n or your CRM.",
    ],
    asks: [
      { q: "Any new enquiries?", a: "Only the ones you haven't seen yet." },
      { q: "Who's the strongest lead? Draft a reply.", a: "Your assistant ranks the enquiries and drafts replies. You send them." },
      { q: "What's the split by budget?", a: "Exact counts for each range." },
    ],
    tips: [
      "Relay doesn't email you about new responses. Ask your assistant \"anything new?\" each morning, or use a webhook if you host Relay yourself.",
      "Ask fewer questions on enquiry forms than on surveys: every extra question loses some people.",
    ],
    related: ["waitlist", "job-applications", "customer-feedback"],
  },
  {
    slug: "team-pulse",
    name: "Team pulse surveys",
    summary: "Quick check-ins with your team, without names unless you ask.",
    title: "Team pulse surveys and internal polls",
    metaTitle: "Team pulse survey and internal poll with ChatGPT or Claude · Relay",
    description:
      "Run a team pulse survey or quick poll by asking ChatGPT or Claude. Get exact averages, and let your assistant summarise what the team said.",
    intro:
      "Managers want to know how the team is doing, but survey tools are heavy for a five-question check-in. With Relay, you describe the pulse survey, share one link in your team chat, and ask your assistant for the results.",
    prompt:
      "Make a monthly team pulse: how they feel about their workload from 1 to 5, how supported they feel from 1 to 5, what's going well, and what's getting in the way. Don't ask for names. Close it Friday.",
    fields: [
      ["Workload feels manageable", "Rating 1–5"],
      ["I feel supported", "Rating 1–5"],
      ["What's going well?", "Long text", "optional"],
      ["What's getting in the way?", "Long text", "optional"],
    ],
    rules: [
      "Asks only what you include. Without a name question, Relay doesn't record who answered.",
      "Closes on Friday.",
      "Your team answers without an account.",
    ],
    asks: [
      { q: "What are the averages this month?", a: "Exact averages for each rating." },
      { q: "What's getting in the way most?", a: "Your assistant groups the answers into themes." },
      { q: "Compare with last month.", a: "Your assistant compares this month's form with last month's." },
    ],
    tips: [
      "In a small team, answers can identify people even without names. Say so honestly, and share only summaries.",
      "Use the same questions every month so the numbers can be compared.",
    ],
    related: ["course-feedback", "customer-feedback", "volunteer-signups"],
  },
];

export const findUseCase = (slug: string) => USE_CASES.find((u) => u.slug === slug);
