// Learning center, FAQ hub, neighborhood pages and the plow-jobs page.
// Same rules as seo-content.mjs: plain facts, and anything about laws, fees or
// rates links to its source.
import { SIZES, estimateRange, estimateTotal } from "../src/lib/estimate.js";

const driveways = SIZES.map((s) => ({ label: `${s.label} driveway`, hint: s.hint, text: estimateRange(s.sqft).text }));
const R = (i) => estimateRange(SIZES[i].sqft).text;
const EX = estimateTotal(650);
const DRV = Math.round(EX.offer * 0.8) + 10;
const L = (slug, text) => `<a href="/${slug}/">${text}</a>`;

const SRC = {
  duluthSnow: ["City of Duluth: snow removal requirements", "https://duluthmn.gov/snow/snow-removal-requirements/"],
  duluthParking: ["City of Duluth: winter parking rules", "https://duluthmn.gov/snow/winter-parking-rules"],
  duluthLicense: ["City of Duluth: business licensing", "https://duluthmn.gov/city-clerk/licenses-permits/business-licensing/"],
  nws: ["National Weather Service Duluth: winter climate", "https://www.weather.gov/dlh/duluthwinterclimate"],
  superior: ["B105: Superior's sidewalk snow rule (ordinance 106-10)", "https://b105country.com/city-of-superior-explains-sidewalk-snow-removal-service/"],
  mndot: ["MnDOT: don't put snow on roads", "https://www.dot.state.mn.us/news/2025/12/11-d3-snow-on-roads.html"],
  cloquet: ["Pine Knot News: Cloquet winter parking", "https://www.pineknotnews.com/story/2026/01/30/news/no-overnight-parking-in-winter/14317.html"],
  llc: ["Minnesota LLC filing fees (2026)", "https://businessanywhere.io/minnesota-llc-cost/"],
  ein: ["IRS: get an EIN (free)", "https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number"],
  se: ["IRS: self-employment tax", "https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes"],
  est: ["IRS: estimated taxes", "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes"],
  mileage: ["IRS: 2026 standard mileage rate", "https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents"],
  mileageJuly: ["IFEBP: 2026 mid-year mileage rate increase", "https://www.ifebp.org/detail-pages/news/2026/07/14/irs-increases-2026-standard-mileage-rates"],
  mnSales: ["MN Revenue: snow plowing listed as non-taxable", "https://revenue.state.mn.us/revenue-notice/08-07-sales-and-use-tax-lawn-and-tree-services-revocation-revenue-notice-04-05"],
  wiSales: ["Wisconsin DOR: snow removal is not taxable", "https://WWW.REVENUE.WI.GOV/SalesUseTaxReport/13-3.pdf"],
};

// ============================================================ FAQ hub
const FAQ = {
  kind: "faq", slug: "faq", short: "FAQ", place: "Duluth",
  title: "Snow Plowing FAQ: Duluth, Superior & Hermantown | DRIFT",
  description: "Answers on booking a snow plow with DRIFT in the Twin Ports: prices, fees, scheduling, payments, hazards, cancellations, local snow rules and driving.",
  h1: "Questions, <em>answered</em>", h1Plain: "DRIFT frequently asked questions",
  lead: "Everything about booking a plow in Duluth, Superior, Hermantown, Proctor, Esko and Cloquet, and about driving for DRIFT. Can't find it? Email support@driftplowing.com.",
  sections: [
    { id: "booking", title: "Booking a plow", qs: [
      ["How do I book a snow plow with DRIFT?", "Open driftplowing.com, map your driveway on the satellite map once (outline where to plow and where the snow goes), and you'll get a recommended price. When it snows, tap once to send your request to local drivers. You'll see when one accepts and can watch them head over."],
      ["Do I need to download an app?", "No app store needed. DRIFT runs in your phone's browser, and you can add it to your home screen so it opens like a regular app and can send you notifications."],
      ["How fast can a plow get to me?", "Your request goes to drivers nearby right away. How fast depends on how many drivers are out and how busy the storm is. Offering a bit more than the recommended price usually gets you picked up first."],
      ["Can I schedule a plow before a storm?", "Yes. Pick a day and a 2-hour window up to 6 days ahead. Drivers add scheduled jobs to their routes the night before, and they have to check in before the window starts."],
      ["Do I have to be home?", "No. Your map shows the driver exactly what to plow, where to put the snow and what to avoid. You'll get before and after photos when it's done."],
      ["What happens if no driver takes my request?", "Your request stays open for 20 minutes. If nobody accepts, it expires and the hold on your card is released. You aren't charged."],
      ["Can I book for a parent or a second property?", "Yes. Add each address as its own property in the app and book whichever one needs plowing."],
    ] },
    { id: "pricing", title: "Prices and fees", qs: [
      ["How is my price set?", `When you outline your driveway, we measure the area and recommend a price based on its size, the slope and how much snow fell. You choose what to offer. Most two-car driveways in Duluth come in around ${R(1)} per storm. ${L("snow-plowing-cost-duluth", "See the full price guide")}.`],
      ["What fees are there?", "Your offer, plus a $10 call-out fee that goes straight to the driver and a $5 DRIFT booking fee. That's it. No subscription, no monthly fee."],
      ["Why does deeper snow cost more?", "It's a bigger, slower job. The recommended price goes up about 15% for 4–8 inches, 30% for 8–12 inches and 50% for a foot or more."],
      ["Can I offer less than the recommended price?", "Yes, down to $10. Lower offers can take longer to get picked up, especially in a big storm."],
      ["Are there surge prices?", "No. The price you offer is the price. You decide whether to offer more to get picked up faster."],
      ["Do I tip the driver?", "Tipping is optional and 100% of every tip goes to the driver."],
    ] },
    { id: "payments", title: "Payments and cancellations", qs: [
      ["When is my card charged?", "When you book, your card is held for the amount, not charged. It's charged only after the driver finishes the job."],
      ["How can I pay?", "Credit or debit card, Apple Pay and Google Pay. Payments are handled by Stripe and DRIFT never sees your full card number."],
      ["Can I cancel?", "Yes. You can cancel before a driver arrives at no charge. After a driver has arrived or started, you may be charged."],
      ["What if I'm not happy with the job?", "Report it in the app within 48 hours with photos. Every job also has before and after photos, which help sort things out quickly."],
    ] },
    { id: "property", title: "Your driveway, hazards and damage", qs: [
      ["Why do I have to mark hazards?", "Drivers can't see what's under the snow. Marking curbs, raised concrete, well caps, septic covers, landscaping and anything else a plow could hit is the best way to avoid damage. You only do it once."],
      ["Where does the snow go?", "Wherever you mark on your map. In Duluth it's against city rules to push snow into the street or alley, and Minnesota law doesn't allow snow on public roads, so mark a spot on your own property."],
      ["What if something gets damaged?", "Report it in the app right away, within 48 hours, with photos. Drivers are independent businesses, and anything you didn't mark on your map is at your own risk, which is why marking hazards matters."],
      ["My driveway is steep. Is that okay?", "Yes. Mark how steep it is when you set up and the recommended price goes up a little so drivers want the job."],
      ["Do you plow gravel driveways?", "Yes. Mark the surface as gravel so drivers know before they accept."],
    ] },
    { id: "services", title: "Services", qs: [
      ["What can I book?", `Driveway plowing, ${L("sidewalk-snow-removal-duluth", "sidewalk clearing")}, ${L("car-dig-out-duluth", "car dig-outs")} and ${L("jump-start-duluth", "jump-starts")}.`],
      ["Do you clear roofs?", "No. Roof snow removal isn't something DRIFT offers."],
      ["Do you plow parking lots or businesses?", "No. DRIFT is for homes: driveways, walks and the cars parked at them."],
    ] },
    { id: "areas", title: "Where we work", qs: [
      ["Where does DRIFT plow?", `${L("snow-plowing-duluth-mn", "Duluth")}, ${L("snow-removal-superior-wi", "Superior, WI")}, ${L("snow-plowing-hermantown-mn", "Hermantown")}, ${L("snow-plowing-proctor-mn", "Proctor")}, ${L("snow-plowing-esko-mn", "Esko")} and ${L("snow-plowing-cloquet-mn", "Cloquet")}.`],
      ["Do you cover my neighborhood in Duluth?", `Yes, every part of the city, from ${L("snow-plowing-duluth-mn/lakeside", "Lakeside")} to ${L("snow-plowing-duluth-mn/west-duluth", "West Duluth")}, ${L("snow-plowing-duluth-mn/park-point", "Park Point")} and ${L("snow-plowing-duluth-mn/duluth-heights", "Duluth Heights")}.`],
      ["I'm just outside your area. Can I still book?", "Type your address on the homepage and we'll tell you. If you're outside the area, check back. We add towns as more drivers join."],
    ] },
    { id: "drivers", title: "Your driver", qs: [
      ["Who does the plowing?", "Independent local plow operators who use DRIFT to find jobs. They're not DRIFT employees. DRIFT is the app that connects you, handles booking and payment, and gives you live tracking and photos."],
      ["What do drivers need to sign up?", "A photo of their driver's license, their vehicle registration, the gear they use, and a signed independent contractor agreement. DRIFT doesn't provide insurance for drivers."],
      ["Can I get the same driver every time?", "Yes. Tap the heart on your receipt to save a driver as a favorite. When you book and they're online, they get your job first for 2 minutes."],
      ["Can I talk to my driver?", "Yes. You can message or call your driver in the app once they accept."],
    ] },
    { id: "rules", title: "Local snow rules", kicker: "Duluth & Superior", qs: [
      ["How long do I have to clear my sidewalk in Duluth?", `24 hours after the snow stops, across the full width of the walk. Corner lots also have to clear the curb cuts. ${L("guides/duluth-sidewalk-snow-rules", "Read the full rules")}.`],
      ["What's the sidewalk rule in Superior, WI?", "Superior's ordinance gives property owners 24 hours after a snowfall to clear the sidewalk in front of their property."],
      ["When is alternate side parking changeover in Duluth?", `Every Sunday between 4 and 8 p.m. ${L("guides/duluth-winter-parking", "Here's how winter parking and snow emergencies work")}.`],
      ["Can I push snow into the street?", "No. Duluth doesn't allow snow in the street or alley, and Minnesota law prohibits putting snow on public roads."],
      ["Is there overnight parking in Cloquet in winter?", "Not on city streets or in alleys from midnight to 6 a.m., November 1 through March 31, according to local reporting on the city's rule."],
    ] },
    { id: "driving", title: "Driving for DRIFT", kicker: "For plow operators", qs: [
      ["How do I start driving for DRIFT?", `Go to the ${L("plow-jobs-duluth-mn", "plow jobs page")} or tap "Drive with us." You can see open jobs and what they pay before you fill anything out.`],
      ["How much do drivers make?", `80% of every offer, plus the full $10 call-out fee and 100% of tips. On a typical two-car driveway that's around $${DRV} per job before tips. ${L("learn/how-much-do-snow-plow-drivers-make-duluth", "See the math")}.`],
      ["How do I get paid?", "Through Stripe, straight to your bank. You can set up payouts as yourself or as your business."],
      ["Do I need my own insurance?", `Yes. DRIFT doesn't insure drivers, and many personal auto policies exclude plowing for pay. ${L("learn/snow-plow-insurance-minnesota", "Read about plow insurance")}.`],
      ["Can I choose which jobs I take?", "Always. You see the pay, the distance, the size and the property map before you accept, and you can set a home zone so you only get alerts for jobs near you."],
      ["Can I drop a job I scheduled?", "Free until 3 hours before the window. After that it counts as a late cancel on your record. During a live job you can report a problem and give it back before you start plowing."],
      ["I run a plow company with several trucks. Can we join?", "Yes. Each driver gets their own login and picks their own jobs, and you can get paid as your business."],
    ] },
  ],
};

// ============================================================ Learning center hub
const HUB = {
  kind: "hub", slug: "learn", short: "Learning center", place: "Duluth",
  title: "Snow Plowing Learning Center: Duluth & Twin Ports | DRIFT",
  description: "Guides for Twin Ports homeowners and plow operators: plowing prices, contracts vs per storm, snow rules, starting a plow business, insurance and taxes.",
  h1: "Learning <em>center</em>", h1Plain: "DRIFT learning center",
  lead: "Straight answers about snow removal in Duluth and the Twin Ports, for homeowners and for anyone with a plow on their truck.",
  groups: [
    { kicker: "For homeowners", title: "Getting plowed", lead: "Prices, contracts and how to get your driveway ready.", match: (p) => p.kind === "article" && p.cat === "For homeowners" || p.slug === "snow-plowing-cost-duluth" },
    { kicker: "Local rules", title: "Duluth & Superior rules", lead: "Sidewalk deadlines, winter parking and snow emergencies.", match: (p) => p.kind === "guide" && p.slug.startsWith("guides/") },
    { kicker: "For plow operators", title: "Plowing for pay", lead: "Starting a plow business in Minnesota, what it pays, insurance and taxes.", match: (p) => p.kind === "article" && p.cat === "For plow operators" },
  ],
};

// ============================================================ articles
const art = (o) => ({ kind: "article", place: "Duluth", crumbs: [["Home", "/"], ["Learn", "/learn/"], [o.short, null]], ...o });

const ARTICLES = [
  art({
    slug: "learn/how-to-start-a-snow-plow-business-duluth-mn", cat: "For plow operators", audience: "driver",
    short: "Start a plow business in Duluth", cardText: "Truck, plow, LLC, insurance, taxes and finding customers, step by step.",
    title: "How to Start a Snow Plow Business in Duluth, MN (2026 Guide)",
    description: "Step-by-step: how to start a snow plowing business in Duluth, Minnesota. Equipment, forming an LLC ($155 online), insurance, taxes, pricing and finding customers.",
    h1: "How to start a snow plow business in <em>Duluth, MN</em>", h1Plain: "How to start a snow plow business in Duluth, MN",
    lead: "Got a truck that can take a plow? Here's how to turn it into a real side business in Duluth: the gear, the paperwork, insurance, taxes and where the customers come from.",
    facts: [["$155", "To form a Minnesota LLC online ($135 by mail)"], ["$0", "Minnesota LLC annual renewal fee (still required)"], ["86\"", "Normal Duluth snowfall per winter (NWS)"]],
    body: `
<h2 id="equipment">1. The truck and the plow</h2>
<p>Most people start with a half-ton or three-quarter-ton pickup and a straight or V-plow sized for that truck. Before you buy, check your truck's owner's manual or the plow maker's fit guide: plows are rated for specific trucks, and an overloaded front end is hard on steering and suspension.</p>
<p>Duluth adds two things to think about: <b>hills</b> and <b>tight spaces</b>. Good winter tires, ballast in the bed, and a plow you can angle into narrow driveways matter more here than raw blade width.</p>
<h2 id="llc">2. Set up the business</h2>
<p>You can plow as a sole proprietor under your own name, but many people form an LLC to keep business and personal money separate. In Minnesota an LLC costs <b>$155 to file online or in person, or $135 by mail</b>, and the annual renewal is free but has to be filed every year or the LLC is dissolved.</p>
<p>An EIN (employer identification number) from the IRS is free and lets you open a business bank account without using your Social Security number on everything.</p>
<p>The City of Duluth's business licensing page lists specific licensed trades (tree service, wrecker services and others) and doesn't list snow plowing. Call the City Clerk at (218) 730-5500 to confirm for your situation.</p>
<h2 id="insurance">3. Get the right insurance</h2>
<p>This is the step people skip and regret. Many personal auto policies exclude plowing and other business use, which can leave you personally on the hook for an accident or damage. Talk to an agent about <b>commercial auto</b> and <b>general liability</b> coverage. ${L("learn/snow-plow-insurance-minnesota", "More on plow insurance")}.</p>
<h2 id="pricing">4. Price your jobs</h2>
<p>Price by the work, not a flat guess: area, slope, snow depth and drive time all matter. ${L("learn/how-to-price-snow-plowing-jobs", "Here's how to price snow plowing jobs")}. On DRIFT, customers see a recommended price from their mapped driveway and you see the pay before you accept.</p>
<h2 id="customers">5. Find customers</h2>
<p>The hard part of a plow business isn't plowing, it's filling the route. You can knock doors, post in neighborhood groups and sign seasonal contracts, or you can pick up on-demand jobs. With DRIFT you go online when it snows, see open jobs near you with the pay, distance and a map of the driveway, and take the ones that fit. Customers can save you as a favorite, so good work turns into regulars.</p>
<h2 id="taxes">6. Taxes</h2>
<p>Plowing income is taxable income. Snow plowing isn't subject to sales tax in Minnesota or Wisconsin, but you'll owe income tax and self-employment tax on your profit, and you can deduct business miles. ${L("learn/snow-plowing-taxes-minnesota-wisconsin", "Read the tax guide")}.</p>
<h2 id="safety">7. Safety and good habits</h2>
<ul><li>Walk new properties in daylight before the first storm if you can, or study the customer's map and hazard pins.</li><li>Keep the blade up a little on gravel.</li><li>Never push snow into the street. Duluth doesn't allow it and Minnesota law prohibits snow on public roads.</li><li>Take before and after photos on every job.</li></ul>
<div class="callout"><p><b>Not legal or tax advice.</b> Rules change. Check with the Minnesota Secretary of State, the City of Duluth, an insurance agent and a tax pro for your situation.</p></div>`,
    faq: [
      ["Do I need a license to plow snow in Duluth?", "The City of Duluth's business licensing page doesn't list snow plowing among its licensed businesses. Confirm with the City Clerk at (218) 730-5500."],
      ["How much does it cost to form an LLC in Minnesota?", "$155 online or in person, or $135 by mail. The annual renewal is free but required."],
      ["Do I charge sales tax on snow plowing in Minnesota?", "Minnesota lists snow plowing as a non-taxable service. Check with the Department of Revenue or a tax pro if you sell other services too."],
    ],
    related: ["learn/how-much-do-snow-plow-drivers-make-duluth", "learn/snow-plow-insurance-minnesota", "learn/snow-plowing-taxes-minnesota-wisconsin", "plow-jobs-duluth-mn"],
    sources: [SRC.llc, SRC.ein, SRC.duluthLicense, SRC.mnSales, SRC.mndot, SRC.nws],
  }),
  art({
    slug: "learn/how-much-do-snow-plow-drivers-make-duluth", cat: "For plow operators", audience: "driver",
    short: "What plow drivers make", cardText: "The real per-job math on DRIFT, and the costs to subtract.",
    title: "How Much Do Snow Plow Drivers Make in Duluth? (Per-Job Math)",
    description: "What a snow plow driver can make per job and per storm in Duluth with DRIFT: 80% of the offer plus a $10 call-out and all tips, with real examples and costs.",
    h1: "How much do snow plow drivers <em>make in Duluth?</em>", h1Plain: "How much do snow plow drivers make in Duluth?",
    lead: "No hype: here's exactly how DRIFT pay works, what a typical driveway pays, and what to subtract for fuel and costs.",
    facts: [["80%", "Of every offer goes to the driver"], ["+$10", "Call-out fee on every job"], ["100%", "Of tips go to the driver"]],
    body: `
<h2 id="split">How pay works</h2>
<p>Customers name their price. On every job, the driver gets <b>80% of the offer</b>, the full <b>$10 call-out fee</b>, and <b>every dollar of tips</b>. You see your exact pay before you accept.</p>
<table><tr><th>Typical two-car driveway</th><th></th></tr>
<tr><td>Customer's offer (recommended)</td><td>$${EX.offer}</td></tr>
<tr><td>Your 80%</td><td>$${Math.round(EX.offer * 0.8)}</td></tr>
<tr><td>Call-out fee</td><td>$10</td></tr>
<tr><td><b>You make, before tips</b></td><td><b>$${DRV}</b></td></tr></table>
<h2 id="storm">What a storm night can look like</h2>
<p>Pay per storm depends on how many jobs you do per hour, which mostly comes down to drive time between jobs. Jobs close together go fast. Here's the math at an average of about $${DRV} per job:</p>
<table><tr><th>Hours out</th><th>Jobs per hour</th><th>Jobs</th><th>Before costs</th></tr>
${[[4, 2], [6, 2], [6, 3], [8, 2.5]].map(([h, r]) => `<tr><td>${h}</td><td>${r}</td><td>${Math.round(h * r)}</td><td>$${(Math.round(h * r) * DRV).toLocaleString()}</td></tr>`).join("")}</table>
<p>These are examples, not promises. Real pay depends on how many customers book in your area and which jobs you take. Use the calculator on the <a href="/drive.html">Drive page</a> to try your own numbers.</p>
<h2 id="costs">What to subtract</h2>
<ul><li><b>Fuel</b>, and more of it than normal driving.</li><li><b>Wear</b>: plowing is hard on transmissions, front ends and the blade's cutting edge.</li><li><b>Insurance</b> that actually covers plowing for pay.</li><li><b>Taxes</b>: plan to set aside part of every payout. The DRIFT app logs your miles on jobs, which can lower your tax bill.</li></ul>
<h2 id="more">How to make more</h2>
<ul><li><b>Set a tight home zone</b> so you're not driving across town between jobs.</li><li><b>Build a scheduled route</b> the night before a storm.</li><li><b>Earn regulars</b>: customers who favorite you get you first for 2 minutes.</li><li><b>Level up</b>: Elite drivers get a head start on new jobs in their zone.</li></ul>`,
    faq: [["Do drivers set their own prices?", "Customers make an offer based on a recommended price. You decide which offers to take."], ["When do I get paid?", "Your pay is sent to your Stripe account when a job is completed, then to your bank on Stripe's payout schedule."]],
    related: ["learn/how-to-start-a-snow-plow-business-duluth-mn", "learn/snow-plowing-taxes-minnesota-wisconsin", "plow-jobs-duluth-mn"],
  }),
  art({
    slug: "learn/snow-plow-insurance-minnesota", cat: "For plow operators", audience: "driver",
    short: "Snow plow insurance in Minnesota", cardText: "Why personal auto often won't cover plowing for pay, and what to ask an agent.",
    title: "Snow Plow Insurance in Minnesota: What Side-Gig Plowers Need",
    description: "Plowing for pay in Minnesota? Many personal auto policies exclude it. What commercial auto and general liability cover, and what to ask your insurance agent.",
    h1: "Snow plow insurance <em>in Minnesota</em>", h1Plain: "Snow plow insurance in Minnesota",
    lead: "If you plow for money, your personal policy may not cover you. Here's what to know before your first paid job.",
    body: `
<h2 id="gap">The gap most people miss</h2>
<p>Many personal auto policies exclude business use, and plowing often gets called out specifically. If you hit a garage door, a car or a person while plowing for pay, you could find out after the fact that you're not covered.</p>
<h2 id="types">The coverage to ask about</h2>
<h3>Commercial auto</h3>
<p>Covers the truck while you're using it for business, including accidents on the road between jobs. Ask whether the plow attachment itself is covered.</p>
<h3>General liability</h3>
<p>Covers damage you cause to someone else's property or injuries on the job site, like a clipped mailbox, a cracked curb or a gouged lawn. This is the one that matters most when the blade is down.</p>
<h3>Equipment</h3>
<p>Some policies cover the plow and other gear against damage or theft.</p>
<h2 id="ask">Questions to ask your agent</h2>
<ul><li>Does my policy cover plowing snow for pay, through an app?</li><li>Am I covered driving between jobs, not just while plowing?</li><li>What are the limits for property damage and injury?</li><li>Is the plow covered?</li><li>Does it matter if I'm an LLC or a sole proprietor?</li></ul>
<h2 id="drift">What DRIFT does and doesn't do</h2>
<p>DRIFT doesn't provide insurance for drivers. Drivers are independent businesses and are responsible for their own coverage. You can compare snow-plowing business coverage online at <a href="https://www.nextinsurance.com/" target="_blank" rel="noopener noreferrer">NEXT Insurance</a> or ask a local agent.</p>
<div class="callout"><p><b>Not insurance advice.</b> Talk to a licensed insurance agent about your truck, your work and your state.</p></div>`,
    related: ["learn/how-to-start-a-snow-plow-business-duluth-mn", "learn/how-much-do-snow-plow-drivers-make-duluth"],
  }),
  art({
    slug: "learn/how-to-price-snow-plowing-jobs", cat: "For plow operators", audience: "driver",
    short: "How to price plowing jobs", cardText: "Area, slope, depth and drive time: pricing that's fair and profitable.",
    title: "How to Price Snow Plowing Jobs (Area, Slope, Depth & Drive Time)",
    description: "How to price residential snow plowing jobs fairly: square footage, slope, snow depth, drive time and minimums, with DRIFT's pricing model as a worked example.",
    h1: "How to price <em>snow plowing jobs</em>", h1Plain: "How to price snow plowing jobs",
    lead: "Guessing loses money on big driveways and loses customers on small ones. Here's how to price by the work.",
    body: `
<h2 id="area">Start with the area</h2>
<p>The plowed area drives the time on site. DRIFT measures it from the customer's outline on a satellite map and recommends a price from a base plus a per-square-foot rate. Past a point, the rate per square foot drops by half so big driveways don't get priced out.</p>
<table><tr><th>Driveway</th><th>Typical recommended total per storm</th></tr>${driveways.map((d) => `<tr><td>${d.label}</td><td>${d.text}</td></tr>`).join("")}</table>
<p>Totals include the $10 call-out fee (which goes to the driver) and DRIFT's $5 booking fee.</p>
<h2 id="slope">Add for slope</h2>
<p>Steep driveways take longer and need more care on the way down. In the app, a moderate or steep slope raises the recommended price.</p>
<h2 id="depth">Add for snow depth</h2>
<p>Deep snow is heavier and slower. A simple rule: about +15% for 4–8 inches, +30% for 8–12 inches and +50% for a foot or more.</p>
<h2 id="drive">Count the drive</h2>
<p>A $50 job 15 minutes away can pay worse per hour than a $40 job next door. Group jobs by area, and on DRIFT set a home zone so you mostly see jobs near you.</p>
<h2 id="minimum">Have a minimum</h2>
<p>Every stop costs you time to get there, set up and leave. A call-out fee or minimum covers it. On DRIFT, every job includes a $10 call-out that goes entirely to the driver.</p>`,
    related: ["learn/how-much-do-snow-plow-drivers-make-duluth", "snow-plowing-cost-duluth"],
  }),
  art({
    slug: "learn/snow-plowing-taxes-minnesota-wisconsin", cat: "For plow operators", audience: "driver",
    short: "Snow plowing taxes (MN & WI)", cardText: "Sales tax vs income tax, self-employment tax, 1099s and the mileage deduction.",
    title: "Snow Plowing Taxes in MN & WI: Sales Tax, 1099s, Mileage",
    description: "Do you charge sales tax on snow plowing in Minnesota or Wisconsin? What income and self-employment tax you owe, 1099s, quarterly payments and the 2026 mileage rate.",
    h1: "Snow plowing taxes in <em>MN &amp; WI</em>", h1Plain: "Snow plowing taxes in Minnesota and Wisconsin",
    lead: "Two different taxes get mixed up: sales tax (what you charge customers) and income tax (what you owe on your profit). Here's the difference.",
    facts: [["$0", "Sales tax on snow plowing in MN and WI"], ["15.3%", "Self-employment tax rate (Social Security + Medicare)"], ["76¢", "IRS mileage rate per business mile from July 1, 2026"]],
    body: `
<h2 id="sales">Sales tax: plowing isn't taxable</h2>
<p>Minnesota lists snow shoveling and plowing as non-taxable services, and Wisconsin's Department of Revenue says the sale of snow removal services is not taxable. Supplies you buy for the business, like fuel and blades, still get sales tax at the store.</p>
<h2 id="income">Income tax: yes, it's income</h2>
<p>What you earn plowing is business income. You report it on your federal return and your Minnesota or Wisconsin return, and you only pay tax on your <b>profit</b>: what you earned minus your business expenses.</p>
<h2 id="se">Self-employment tax</h2>
<p>As an independent contractor, no one is withholding Social Security and Medicare for you, so you pay self-employment tax on your profit. The rate is <b>15.3%</b> (12.4% Social Security plus 2.9% Medicare).</p>
<h2 id="1099">1099s and quarterly payments</h2>
<p>DRIFT pays drivers through Stripe, and you'll get a 1099 for your earnings. If you expect to owe a meaningful amount, the IRS expects estimated tax payments during the year rather than all at once in April.</p>
<h2 id="mileage">The mileage deduction</h2>
<p>Business miles are deductible. The IRS standard mileage rate for 2026 was <b>72.5¢ a mile</b> from January 1, raised to <b>76¢ a mile from July 1, 2026</b>. The DRIFT driver app logs miles on each job and lets you download the year as a spreadsheet.</p>
<div class="callout"><p><b>Not tax advice.</b> Talk to a tax pro about your situation, especially if you sell other services too.</p></div>`,
    related: ["learn/how-much-do-snow-plow-drivers-make-duluth", "learn/how-to-start-a-snow-plow-business-duluth-mn"],
    sources: [SRC.mnSales, SRC.wiSales, SRC.se, SRC.est, SRC.mileage, SRC.mileageJuly],
  }),
  art({
    slug: "learn/per-storm-vs-seasonal-snow-plowing-contract", cat: "For homeowners",
    short: "Per storm vs seasonal contract", cardText: "Which costs less in a Duluth winter, and when a contract makes sense.",
    title: "Per-Storm vs Seasonal Snow Plowing Contract in Duluth",
    description: "Seasonal snow plowing contract or pay per storm? How to compare them in Duluth, where snowfall swings from light winters to 100+ inches.",
    h1: "Per storm vs <em>seasonal contract</em>", h1Plain: "Per-storm vs seasonal snow plowing contract",
    lead: "A seasonal contract is a bet on how much it'll snow. Here's how to figure out which way to go in Duluth.",
    facts: [["86\"", "Normal Duluth snowfall per winter (NWS)"], ["135\"+", "Duluth's snowiest winter on record"]],
    body: `
<h2 id="how">How each one works</h2>
<p><b>Seasonal contract:</b> one price for the winter, usually paid up front or in installments, and the company plows when snow passes a trigger depth. <b>Per storm:</b> you pay only when you book a plow.</p>
<h2 id="math">The math</h2>
<p>Divide a contract price by the number of times you'd realistically need plowing. Duluth averages about 86 inches of snow a season, but it swings a lot, and the record is over 135 inches. In a light winter, a contract can work out to a lot per plow. In a huge winter it can be a good deal.</p>
<p>Per storm, most two-car driveways come in around ${R(1)} with DRIFT, and you decide each time whether it's worth it or whether you'll grab the shovel.</p>
<h2 id="contract">When a contract makes sense</h2>
<ul><li>You want zero decisions all winter.</li><li>You need plowing on every snowfall, even small ones, no matter what.</li><li>You found a contract with a fair per-visit price and a low trigger depth.</li></ul>
<h2 id="perstorm">When per storm makes sense</h2>
<ul><li>You clear small snows yourself and want help with the big ones.</li><li>You don't want to pay for snow that doesn't fall.</li><li>You want to see the driver coming, get photos, and never sign anything.</li></ul>
<p>With DRIFT you can also ${L("faq", "schedule a plow before a storm")}, so you get some of the "it just happens" feeling of a contract without paying for a whole season.</p>`,
    related: ["snow-plowing-cost-duluth", "learn/get-your-driveway-ready-for-winter"],
    sources: [SRC.nws],
  }),
  art({
    slug: "learn/get-your-driveway-ready-for-winter", cat: "For homeowners",
    short: "Get your driveway ready for winter", cardText: "Stakes, hazards, where the snow goes: prep that prevents damage.",
    title: "Get Your Driveway Ready for Snow Plowing (Duluth Checklist)",
    description: "A pre-winter checklist for Duluth homeowners: mark driveway edges, flag hazards, plan where the snow goes and avoid plow damage to curbs, lawns and landscaping.",
    h1: "Get your driveway <em>ready for winter</em>", h1Plain: "How to get your driveway ready for snow plowing",
    lead: "Ten minutes in the fall saves a cracked curb, a torn-up lawn or a buried well cap in January.",
    body: `
<h2 id="edges">Mark the edges</h2>
<p>Once the snow is down, nobody can see where the driveway ends and the lawn begins. Driveway stakes or reflective markers along the edges (and at any sharp turns) keep the blade on the pavement.</p>
<h2 id="hazards">Flag anything a plow could hit</h2>
<ul><li>Curbs and raised or broken concrete</li><li>Well caps, septic and valve covers</li><li>Landscape edging, rocks and lighting</li><li>Sprinkler heads and anything left outside</li></ul>
<p>On DRIFT you mark these once on your property map with pins, lines and areas, and every driver sees them before they accept.</p>
<h2 id="pile">Decide where the snow goes</h2>
<p>Pick a spot on your own property with room for a whole winter of piles, away from where melt will run back across the driveway and refreeze. In Duluth, snow can't go into the street or alley.</p>
<h2 id="clear">Clear the way before a storm</h2>
<ul><li>Move cars to one side of the driveway or off it if you can.</li><li>Bring in trash cans, hoses and decorations.</li><li>Don't forget the sidewalk: Duluth gives you 24 hours after the snow stops. ${L("guides/duluth-sidewalk-snow-rules", "See the rules")}.</li></ul>
<h2 id="map">Map it once</h2>
<p><a href="/?go=book">Map your driveway on DRIFT</a> before the first storm. When it snows, booking is one tap.</p>`,
    related: ["learn/when-to-plow-during-a-snowstorm", "guides/duluth-sidewalk-snow-rules"],
    sources: [SRC.duluthSnow],
  }),
  art({
    slug: "learn/when-to-plow-during-a-snowstorm", cat: "For homeowners",
    short: "When to plow in a snowstorm", cardText: "During the storm or after? Timing for Duluth's long lake-effect storms.",
    title: "When Should You Plow Your Driveway During a Snowstorm?",
    description: "Should you plow during a snowstorm or wait until it's over? Timing tips for Duluth's long lake-effect storms, deep snow, city plow berms and sidewalks.",
    h1: "When to plow <em>during a snowstorm</em>", h1Plain: "When should you plow your driveway during a snowstorm?",
    lead: "Plow too early and you'll do it twice. Wait too long and it's heavy, packed and harder to clear. Here's how to time it.",
    body: `
<h2 id="depth">Watch the depth</h2>
<p>A few inches is easy to clear any time. Past about 8 inches, snow gets heavy and slow to move, and the cost goes up with it. If a long storm is going to drop a foot or more, one clearing partway through and another at the end can be easier on everyone than one giant job.</p>
<h2 id="leave">Plow before you need to leave</h2>
<p>If you have to get out in the morning, book or schedule a plow for the early window rather than waiting for the storm to fully end. With DRIFT you can schedule a 2-hour window up to 6 days ahead.</p>
<h2 id="berm">Wait for the city plow, if you can</h2>
<p>City plows push a ridge of snow across the end of driveways. If the street hasn't been plowed yet, clearing the end of your driveway now means doing it again later.</p>
<h2 id="refreeze">Don't let it sit and pack down</h2>
<p>Snow that gets driven on or sits through a thaw and refreeze turns into ice that a plow can't scrape off. Clearing within a day keeps it from turning into a skating rink.</p>
<h2 id="sidewalk">Remember the sidewalk clock</h2>
<p>In Duluth and Superior you have 24 hours after the snow stops to clear the sidewalk. Add it to the same booking.</p>`,
    related: ["learn/get-your-driveway-ready-for-winter", "car-dig-out-duluth"],
    sources: [SRC.duluthSnow, SRC.superior],
  }),
  art({
    slug: "learn/snowblower-vs-plow-service", cat: "For homeowners",
    short: "Snowblower or plow service?", cardText: "Time, hills, storage and upkeep: how to decide.",
    title: "Snowblower vs Plow Service in Duluth: How to Decide",
    description: "Buy a snowblower or pay for a plow service? Compare time, effort, hills, storage, upkeep and cost for a Duluth driveway.",
    h1: "Snowblower <em>or plow service?</em>", h1Plain: "Snowblower vs plow service",
    lead: "Both work. The right one depends on your driveway, your schedule and how many winters you plan to spend at the end of a handle.",
    body: `
<h2 id="time">Time</h2>
<p>A snowblower on a two-car driveway can mean an hour or more in a deep storm, plus the end-of-driveway berm the city plow leaves behind. A plow truck clears the same driveway in a fraction of that.</p>
<h2 id="hills">Hills</h2>
<p>Duluth's steep driveways are hard work with a snowblower, especially going uphill in heavy snow. A plow pushes it downhill to wherever you've marked.</p>
<h2 id="cost">Cost</h2>
<p>A snowblower is an up-front purchase plus gas, oil, shear pins, belts and storage. A plow service is pay as you go. With DRIFT, most two-car driveways come in around ${R(1)} per storm, and you only book the storms you don't want to handle.</p>
<h2 id="both">The best answer is often both</h2>
<p>Lots of people blow out the small snows themselves and book a plow for the big ones, the heavy wet ones, or when they're out of town. That's exactly what per-storm booking is for.</p>`,
    related: ["learn/per-storm-vs-seasonal-snow-plowing-contract", "snow-plowing-cost-duluth"],
  }),
];

// ============================================================ Duluth neighborhoods
const hood = (o) => ({
  kind: "hood", prices: driveways, place: "Duluth", geoRegion: "US-MN",
  crumbs: [["Home", "/"], ["Duluth, MN", "/snow-plowing-duluth-mn/"], [o.short, null]],
  areaServed: [[o.short, "hood"]], priceFrom: estimateRange(SIZES[0].sqft).lo,
  serviceName: `Snow plowing in ${o.short}, Duluth`, related: ["snow-plowing-duluth-mn", "guides/duluth-sidewalk-snow-rules"],
  sources: [SRC.duluthSnow, SRC.duluthParking],
  ...o,
});
const HOOD_FAQ = (n) => [
  [`Do you plow in ${n}?`, `Yes. Map your driveway once and book a local plow any time it snows in ${n}.`],
  [`How much does plowing cost in ${n}?`, `Most single-car driveways come in around ${R(0)} and two-car driveways around ${R(1)} per storm, including fees. Steep drives and deep snow cost a bit more.`],
];
const HOODS = [
  hood({
    slug: "snow-plowing-duluth-mn/park-point", short: "Park Point",
    title: "Snow Plowing on Park Point, Duluth | DRIFT",
    description: "On-demand driveway plowing on Park Point (Minnesota Point) in Duluth. Map your driveway once, book any storm, track your plow over the bridge.",
    h1: "Snow plowing on <em>Park Point</em>", h1Plain: "Snow plowing on Park Point",
    lead: "Out past the Aerial Lift Bridge, driveways are close to the lake and the wind. Map yours once and book a plow any storm.",
    localTitle: "Plowing <em>past the bridge</em>",
    local: `<p>Park Point is a long, narrow sandbar, and every trip on or off it goes across the Aerial Lift Bridge. During the shipping season the bridge lifts for boats, which can add a few minutes for a driver coming from the mainland. The live map shows you exactly where yours is.</p>
<p><b>Wind moves snow around out here.</b> Mark where you want it piled, away from where it'll blow back across the driveway.</p>
<p><b>Sand and soft edges.</b> Pin the edges of your driveway, any landscaping and anything low to the ground so the blade stays on the pavement.</p>`,
    faq: HOOD_FAQ("Park Point"),
  }),
  hood({
    slug: "snow-plowing-duluth-mn/hillside", short: "Hillside",
    title: "Snow Plowing Hillside, Duluth | Steep Driveways | DRIFT",
    description: "Driveway and sidewalk snow plowing in Duluth's Central and East Hillside, built for steep driveways, alleys and the 24-hour sidewalk rule.",
    h1: "Snow plowing in the <em>Hillside</em>", h1Plain: "Snow plowing in the Hillside",
    lead: "Steep streets, tight alley garages and stairs to the sidewalk. Mark it once and book a plow that knows what it's getting into.",
    localTitle: "Built for <em>steep</em>",
    local: `<p>The Central and East Hillside climb straight up from the lake, and plenty of driveways and alley aprons are steep. When you set up, mark how steep yours is. The recommended price goes up a little so drivers want the job, and they see the slope before they accept.</p>
<p><b>Garage off the alley?</b> Outline the alley apron along with any parking pad, and mark where the snow can go. Snow can't be pushed into the alley or the street.</p>
<p><b>Sidewalks and steps.</b> Duluth gives you 24 hours after the snow stops to clear the full width of your sidewalk. Add it to the same booking.</p>`,
    faq: HOOD_FAQ("the Hillside"),
  }),
  hood({
    slug: "snow-plowing-duluth-mn/duluth-heights", short: "Duluth Heights",
    title: "Snow Plowing Duluth Heights | On-Demand | DRIFT",
    description: "On-demand driveway plowing in Duluth Heights and over the hill. Map your driveway once, name your price, track your plow live.",
    h1: "Snow plowing in <em>Duluth Heights</em>", h1Plain: "Snow plowing in Duluth Heights",
    lead: "Up over the hill it's often colder, and wider driveways mean bigger jobs. Map yours and get a fair recommended price every storm.",
    localTitle: "Plowing <em>over the hill</em>",
    local: `<p>Duluth Heights sits up on the hill above downtown, near Miller Hill. It's often colder up here than down by the lake, so snow can pile up faster than people expect.</p>
<p><b>Bigger driveways, fair price.</b> The recommended price comes from the area you outline, and the rate per square foot drops on big driveways so they don't get priced out.</p>
<p><b>Schedule ahead.</b> If you need out early, schedule a 2-hour window the night before.</p>`,
    faq: HOOD_FAQ("Duluth Heights"),
  }),
  hood({
    slug: "snow-plowing-duluth-mn/lakeside", short: "Lakeside",
    title: "Snow Plowing in Lakeside & Lester Park, Duluth | DRIFT",
    description: "On-demand driveway and sidewalk plowing in Lakeside and Lester Park in Duluth's east end. Map it once, book any storm, pay when it's done.",
    h1: "Snow plowing in <em>Lakeside</em>", h1Plain: "Snow plowing in Lakeside and Lester Park",
    lead: "Driveways, alley garages and sidewalks in Duluth's east end, cleared by local plow operators when you need it.",
    localTitle: "Plowing the <em>east end</em>",
    local: `<p>Lakeside and Lester Park are mostly homes with driveways, alley garages and sidewalks out front, which means two clocks start when it snows: getting the car out, and the 24-hour sidewalk rule.</p>
<p><b>Do both in one trip.</b> Add sidewalk clearing to your driveway booking and the same driver handles both.</p>
<p><b>Alley garages.</b> Outline the apron in front of the garage and mark where the snow goes. It can't go in the alley.</p>`,
    faq: HOOD_FAQ("Lakeside and Lester Park"),
  }),
  hood({
    slug: "snow-plowing-duluth-mn/west-duluth", short: "West Duluth",
    title: "Snow Plowing West Duluth | Spirit Valley & Denfeld | DRIFT",
    description: "On-demand driveway plowing in West Duluth, Spirit Valley, Denfeld and nearby. Map your driveway, name your price, pay only when it's done.",
    h1: "Snow plowing in <em>West Duluth</em>", h1Plain: "Snow plowing in West Duluth",
    lead: "Spirit Valley, Denfeld and the neighborhoods around them. Book a local plow any storm, no contract.",
    localTitle: "Plowing <em>West Duluth</em>",
    local: `<p>West Duluth's grid of streets and alleys means a lot of garages and parking pads off the alley. Outline exactly what you want cleared, including the alley apron, and drivers see it before they accept.</p>
<p><b>Street parking.</b> During a snow emergency, cars have to come off the snow emergency routes. A cleared driveway gives you somewhere to park. ${L("guides/duluth-winter-parking", "Here's how winter parking works")}.</p>`,
    faq: HOOD_FAQ("West Duluth"),
  }),
  hood({
    slug: "snow-plowing-duluth-mn/woodland", short: "Woodland",
    title: "Snow Plowing in Woodland & Hunters Park, Duluth | DRIFT",
    description: "On-demand driveway plowing in Woodland and Hunters Park in Duluth. Steep and long driveways welcome. Map it once, book any storm.",
    h1: "Snow plowing in <em>Woodland</em>", h1Plain: "Snow plowing in Woodland and Hunters Park",
    lead: "Longer, steeper driveways up the hill. Mark the slope and the hazards once and every storm is one tap.",
    localTitle: "Plowing <em>up the hill</em>",
    local: `<p>Woodland and Hunters Park have plenty of driveways that are longer or steeper than in town. Both are built into the price: the area comes from your outline and the slope from what you mark.</p>
<p><b>Mark what's under the snow.</b> Retaining walls, rocks, landscaping and the edges of the driveway get pinned on your map so drivers know before they start.</p>`,
    faq: HOOD_FAQ("Woodland and Hunters Park"),
  }),
];

// ============================================================ plow jobs (driver recruiting)
const JOBS = {
  kind: "jobs", audience: "driver", slug: "plow-jobs-duluth-mn", short: "Plow jobs in Duluth", place: "Duluth",
  title: "Snow Plow Jobs in Duluth, MN | Plow on Your Schedule | DRIFT",
  description: "Have a plow? Pick up paid driveway plowing jobs in Duluth, Superior and Hermantown with DRIFT. See the pay before you accept. 80% of the offer + $10 call-out + tips.",
  h1: "Snow plow jobs in <em>Duluth, MN</em>", h1Plain: "Snow plow jobs in Duluth, MN",
  lead: "Have a truck with a plow? Pick up paid driveway jobs around Duluth, Superior and Hermantown when it snows, and only the ones worth it to you.",
  cta: "See open jobs",
  jobPosting: {
    title: "Snow Plow Driver (Independent Contractor)",
    datePosted: "2026-10-21", validThrough: "2027-04-30T23:59",
    towns: [["Duluth", "MN"], ["Hermantown", "MN"], ["Superior", "WI"]],
    description: "<p>Have a truck with a plow? Pick up paid residential driveway and sidewalk snow removal jobs around Duluth, Hermantown, Superior, Cloquet, Proctor and Esko through the DRIFT app. This is independent contractor work: you choose when you go online and which jobs you take.</p><p><b>How it works:</b> homeowners map their driveway, mark hazards and where the snow goes, and post a job. You see the pay, the distance, the size and the property map before you accept. Plow it, take before and after photos, and get paid through Stripe.</p><p><b>Pay:</b> 80% of the customer's offer, plus the full $10 call-out fee and 100% of tips. Pay varies by job.</p><p><b>What you need:</b> a truck with a plow (or a snowblower for sidewalk jobs), a driver's license and vehicle registration, your own insurance that covers plowing for pay, and a smartphone.</p><p>Free to sign up. You can see open jobs before you fill anything out.</p>",
  },
  facts: [["80%", "Of every offer, plus a $10 call-out"], ["100%", "Of tips go to you"], ["$0", "To sign up"]],
  body: `
<h2 id="what">What the work is</h2>
<p>Homeowners map their driveway, mark hazards and where the snow goes, and post a job when it snows. You see the pay, the distance, the size and the property map before you accept. Plow it, snap before and after photos, and you're paid through Stripe.</p>
<h2 id="pay">What it pays</h2>
<p>You get 80% of the customer's offer, the full $10 call-out fee and every tip. On a typical two-car driveway that's around $${DRV} before tips. ${L("learn/how-much-do-snow-plow-drivers-make-duluth", "See the per-storm math")}.</p>
<h2 id="need">What you need</h2>
<ul><li>A truck with a plow (or a snowblower for sidewalk jobs)</li><li>A driver's license and vehicle registration</li><li>Your own insurance that covers plowing for pay. ${L("learn/snow-plow-insurance-minnesota", "Read about plow insurance")}</li><li>A smartphone</li></ul>
<h2 id="how">How it works for drivers</h2>
<ul><li><b>Look first:</b> see open jobs and pay before any paperwork.</li><li><b>Home zone:</b> only get alerts for jobs near you.</li><li><b>Storm mode:</b> build a route the night before a storm.</li><li><b>Regulars:</b> customers who favorite you get you first.</li><li><b>Problems:</b> car in the driveway? Report it and give the job back with no penalty before you start.</li><li><b>Taxes:</b> miles on every job are logged for you.</li></ul>
<h2 id="companies">Running a plow company?</h2>
<p>Fill the gaps between contract stops. Each driver gets their own login, and you can get paid as your business.</p>`,
  faq: [
    ["Is DRIFT hiring snow plow drivers in Duluth?", "DRIFT works with independent plow operators, not employees. Sign up, see open jobs, and take the ones you want."],
    ["Do I need my own plow?", "Yes, for driveway jobs. Sidewalk jobs can be done with a snowblower."],
    ["Can I plow for DRIFT as a side job?", "Yes. Go online when it snows and you're free, and offline whenever you want."],
  ],
  related: ["learn/how-to-start-a-snow-plow-business-duluth-mn", "learn/how-much-do-snow-plow-drivers-make-duluth", "learn/snow-plow-insurance-minnesota"],
};

export const LEARN_PAGES = [FAQ, HUB, ...ARTICLES, ...HOODS, JOBS];
