// Words for DRIFT's search pages. One entry per page. Plain facts only:
// anything about city rules links to the city's own page in `sources`.
import { SIZES, estimateRange, sidewalkPrice, digoutPrice, jumpstartPrice } from "../src/lib/estimate.js";

export const SITE = "https://driftplowing.com";
export const UPDATED = { iso: "2026-10-21", label: "October 2026" };

const driveways = SIZES.map((s) => ({ label: `${s.label} driveway`, hint: s.hint, text: estimateRange(s.sqft).text }));
const from = (r) => `$${r.standardTotal}`;
const DRIVEWAY_FROM = `From ${estimateRange(SIZES[0].sqft).text.split("–")[0]}`;
const SIDEWALK = sidewalkPrice(60), DIGOUT = digoutPrice(), JUMP = jumpstartPrice();

const SRC = {
  duluthSnow: ["City of Duluth: snow removal requirements", "https://duluthmn.gov/snow/snow-removal-requirements/"],
  duluthParking: ["City of Duluth: winter parking rules", "https://duluthmn.gov/snow/winter-parking-rules"],
  nws: ["National Weather Service Duluth: winter climate", "https://www.weather.gov/dlh/duluthwinterclimate"],
  superior: ["B105: Superior's sidewalk snow rule (ordinance 106-10)", "https://b105country.com/city-of-superior-explains-sidewalk-snow-removal-service/"],
  mndot: ["MnDOT: don't put snow on roads", "https://www.dot.state.mn.us/news/2025/12/11-d3-snow-on-roads.html"],
  cloquet: ["Pine Knot News: Cloquet winter parking", "https://www.pineknotnews.com/story/2026/01/30/news/no-overnight-parking-in-winter/14317.html"],
};

const COMMON_FAQ = {
  contract: ["Do I need a seasonal contract?", "No. You book a plow when you want one and pay per storm. No contract, no monthly fee, and you're only charged after the job is done."],
  who: ["Who actually does the plowing?", "Independent local plow operators who use the DRIFT app to find work. DRIFT isn't the plow company. It's the app that connects you, handles booking and payment, and shows you the truck live with before and after photos."],
  price: ["How is the price set?", "You name it. DRIFT suggests a fair price from the size of the area you outline on the map, the slope and the snow depth. Offer more in a big storm and drivers pick you up faster. Total = your offer + a $10 call-out that goes to the driver + a $5 booking fee."],
};

const city = (o) => ({ kind: "city", prices: driveways, drivewayFrom: DRIVEWAY_FROM, ...o });

export const PAGES = [
  // ---------------- cities ----------------
  city({
    slug: "snow-plowing-duluth-mn", short: "Duluth, MN", place: "Duluth", geoRegion: "US-MN", areaServed: [["Duluth", "MN"]],
    title: "Snow Plowing Duluth MN | On-Demand, No Contract | DRIFT",
    description: "On-demand snow plowing in Duluth, MN. Map your driveway, name your price, track a local plow live and pay only when it's done. No seasonal contract.",
    h1: "Snow plowing in <em>Duluth, MN</em>", h1Plain: "Snow plowing in Duluth, MN", serviceName: "Driveway snow plowing in Duluth, MN",
    lead: "Book a local plow for your driveway in about a minute, any time it snows. Name your price, watch the truck come up the hill, and pay only when it's cleared. No seasonal contract.",
    priceFrom: estimateRange(SIZES[0].sqft).lo,
    localTitle: "Plowing built for <em>Duluth</em>",
    local: `
<p>Duluth gets about <b>86 inches of snow</b> in a normal winter, and the record is more than 135. A seasonal contract charges the same either way. With DRIFT you pay for the storms that actually happen.</p>
<p><b>Hills are part of the price, not a surprise.</b> When you set up, you mark how steep your driveway is. Steeper drives get a slightly higher suggested price so drivers want the job. Mark retaining walls, curbs, wells and spots that ice over too. The driver sees all of it before they accept.</p>
<p><b>Tell them where the snow goes.</b> You draw where to plow and where to pile it on a satellite map. It's against city rules to push snow into the street or alley, so the pile goes in your yard where you choose.</p>
<p><b>Don't forget the sidewalk.</b> Duluth requires sidewalks to be cleared within 24 hours after it stops snowing. Add sidewalk clearing to the same booking. <a href="/guides/duluth-sidewalk-snow-rules/">Read Duluth's sidewalk rules</a>.</p>
<p><b>Parked on the street?</b> During a snow emergency your car has to move. <a href="/guides/duluth-winter-parking/">Here's how winter parking works</a>, and a clear driveway gives you somewhere to put it.</p>`,
    facts: [["86\"", "Normal Duluth snowfall per winter (NWS)"], ["24 hrs", "To clear your sidewalk after snow stops"], ["$0", "Contract or monthly fee"]],
    areas: ["Lakeside", "Lester Park", "Congdon", "Woodland", "Hunters Park", "Kenwood", "Chester Park", "Endion", "Hillside", "Park Point", "Duluth Heights", "Piedmont", "Lincoln Park", "West Duluth", "Denfeld", "Spirit Valley", "Morgan Park", "Fond du Lac", "Gary–New Duluth"],
    faq: [
      ["How much does it cost to plow a driveway in Duluth?", `Most single-car driveways come in around ${driveways[0].text} and most two-car driveways around ${driveways[1].text} per storm, including fees. Steep drives and deep snow cost a bit more. You can offer whatever you want. <a href="/snow-plowing-cost-duluth/">See the full price guide</a>.`],
      ["How fast can a plow get to me?", "Your request goes to drivers nearby right away and you see when one accepts and how far away they are. On a big storm night it depends on how many drivers are out. Offering a little more gets you picked up first, and you can also schedule a plow ahead of time for a 2-hour window."],
      COMMON_FAQ.contract, COMMON_FAQ.who,
      ["Can I schedule plowing before a storm?", "Yes. Pick a day and a 2-hour window up to 6 days ahead. Your card is held when you book and charged only when the job is done."],
    ],
    sources: [SRC.nws, SRC.duluthSnow, SRC.duluthParking],
  }),
  city({
    slug: "snow-removal-superior-wi", short: "Superior, WI", place: "Superior", geoRegion: "US-WI", areaServed: [["Superior", "WI"]],
    title: "Snow Removal Superior WI | Driveway Plowing On Demand | DRIFT",
    description: "On-demand snow removal in Superior, WI. Book a local plow for your driveway, garage apron or sidewalk, name your price, and pay only when it's done. No contract.",
    h1: "Snow removal in <em>Superior, WI</em>", h1Plain: "Snow removal in Superior, WI", serviceName: "Snow removal in Superior, WI",
    lead: "Driveways, garage aprons and sidewalks cleared by local plow operators across the bridge. Book in a minute, track the truck, and pay only when it's done.",
    priceFrom: estimateRange(SIZES[0].sqft).lo,
    localTitle: "Clearing snow in <em>Superior</em>",
    local: `
<p>Superior sits right on the lake, so it gets the same lake-effect storms as Duluth. DRIFT works the same on both sides of the bridge.</p>
<p><b>Garage off the alley?</b> Outline the alley apron in front of your garage along with the driveway, and mark where the snow can go. Drivers see your outline before they accept, so there's no back-and-forth.</p>
<p><b>Sidewalks have a deadline.</b> Superior's ordinance gives property owners <b>24 hours</b> after a snowfall to clear the sidewalk in front of their property. The city only clears a short priority route itself. Add the sidewalk to your booking and it's handled on the same trip. <a href="/sidewalk-snow-removal-duluth/">More on sidewalk clearing</a>.</p>
<p><b>Pay per storm.</b> Light winter? You pay less. Big one? Book as many times as you need. There's never a contract.</p>`,
    facts: [["24 hrs", "To clear your sidewalk after a snowfall (Superior ordinance 106-10)"], ["1 app", "Same drivers and booking on both sides of the bridge"], ["$0", "Contract or monthly fee"]],
    areas: ["Billings Park", "North End", "East End", "South End", "Allouez", "Itasca", "Central Superior"],
    faq: [
      ["Do you plow in Superior, Wisconsin?", "Yes. DRIFT covers Superior along with Duluth, Hermantown, Proctor, Esko and Cloquet. Drivers on both sides of the bridge get your request."],
      ["How much does snow removal cost in Superior?", `Most single-car driveways are around ${driveways[0].text} and two-car driveways around ${driveways[1].text} per storm, including fees. Sidewalks are priced by length. You choose what to offer.`],
      ["When do I have to shovel my sidewalk in Superior?", "Superior's ordinance requires property owners to clear the sidewalk within 24 hours of a snowfall. Check with the city for the latest rules."],
      COMMON_FAQ.contract, COMMON_FAQ.who,
    ],
    sources: [SRC.superior],
  }),
  city({
    slug: "snow-plowing-hermantown-mn", short: "Hermantown, MN", place: "Hermantown", geoRegion: "US-MN", areaServed: [["Hermantown", "MN"]],
    title: "Snow Plowing Hermantown MN | Driveway Plowing On Demand | DRIFT",
    description: "Driveway snow plowing in Hermantown, MN on demand. Long driveway? Outline it once, name your price each storm, track your plow live, pay only when it's done.",
    h1: "Snow plowing in <em>Hermantown, MN</em>", h1Plain: "Snow plowing in Hermantown, MN",
    lead: "Bigger lots and longer driveways, plowed by local operators when you need it. Outline it once and book every storm in a tap.",
    priceFrom: estimateRange(SIZES[0].sqft).lo,
    localTitle: "Long driveways, <em>fair prices</em>",
    local: `
<p>A lot of Hermantown driveways are longer and wider than in town. That's exactly what DRIFT's pricing is built for: you outline the area on a satellite map and the suggested price comes from the actual square footage, with a lower rate per square foot on big driveways so they don't get priced out.</p>
<p><b>Keep snow off the road.</b> Minnesota law prohibits putting snow on public roads, ditches and rights-of-way. When you set up, mark where the pile should go on your property and the driver follows it.</p>
<p><b>Gravel or paved, mark it.</b> Tell drivers about gravel, culverts, mailboxes and anything hiding under the snow. Pins on the map show them exactly where.</p>`,
    facts: [["½ rate", "Per sq ft once a big driveway's price passes $50"], ["1 min", "To book once your driveway is mapped"], ["$0", "Contract or monthly fee"]],
    faq: [
      ["How much does it cost to plow a long driveway in Hermantown?", `Long or extra-wide driveways usually come in around ${driveways[2].text} and very large ones around ${driveways[3].text} per storm, including fees. The rate per square foot drops on big driveways.`],
      ["Where should the snow go?", "Wherever you mark on your property map. State law doesn't allow plowing snow onto the road or into the ditch, so mark a spot in your yard."],
      COMMON_FAQ.contract, COMMON_FAQ.who,
    ],
    sources: [SRC.mndot],
  }),
  city({
    slug: "snow-plowing-cloquet-mn", short: "Cloquet, MN", place: "Cloquet", geoRegion: "US-MN", areaServed: [["Cloquet", "MN"], ["Scanlon", "MN"]],
    title: "Snow Plowing Cloquet MN | On-Demand Driveway Plowing | DRIFT",
    description: "On-demand driveway snow plowing in Cloquet, MN. Name your price, track your local plow live and pay only when it's done. No contract.",
    h1: "Snow plowing in <em>Cloquet, MN</em>", h1Plain: "Snow plowing in Cloquet, MN",
    lead: "Local plow operators for your driveway when the snow piles up. Book in a minute, pay per storm.",
    priceFrom: estimateRange(SIZES[0].sqft).lo,
    localTitle: "Plowing in <em>Cloquet</em>",
    local: `
<p><b>Overnight parking is off-limits all winter.</b> From November 1 through March 31, Cloquet doesn't allow parking on city streets or in alleys between midnight and 6 a.m. That makes a cleared driveway a must. Book a plow before the evening and you've got room for every car.</p>
<p><b>Mark the hazards once.</b> Curbs, mailboxes, landscaping edges and soft spots get pinned on your map, so every driver knows where they are, storm after storm.</p>
<p><b>No contract.</b> Pay only for the storms you need plowed.</p>`,
    facts: [["Nov 1 – Mar 31", "No overnight street parking, midnight to 6 a.m."], ["1 min", "To book once your driveway is mapped"], ["$0", "Contract or monthly fee"]],
    faq: [
      ["Can I park on the street overnight in Cloquet in winter?", "Not from November 1 through March 31 between midnight and 6 a.m., according to local reporting on the city's rule. Check with the city for current details."],
      ["How much does driveway plowing cost in Cloquet?", `Most driveways come in between ${driveways[0].text} and ${driveways[1].text} per storm, including fees. You choose your offer.`],
      COMMON_FAQ.contract, COMMON_FAQ.who,
    ],
    sources: [SRC.cloquet],
  }),
  city({
    slug: "snow-plowing-proctor-mn", short: "Proctor, MN", place: "Proctor", geoRegion: "US-MN", areaServed: [["Proctor", "MN"]],
    title: "Snow Plowing Proctor MN | Driveway Plowing On Demand | DRIFT",
    description: "On-demand driveway snow plowing in Proctor, MN. Local plow operators, your price, live tracking, pay only when it's done. No contract.",
    h1: "Snow plowing in <em>Proctor, MN</em>", h1Plain: "Snow plowing in Proctor, MN",
    lead: "Driveway plowing from local operators, booked in a minute. Name your price, track the truck, pay when it's clear.",
    priceFrom: estimateRange(SIZES[0].sqft).lo,
    localTitle: "Plowing in <em>Proctor</em>",
    local: `
<p>Proctor sits up the hill from West Duluth, close enough that drivers working Duluth's west end can get to you fast.</p>
<p><b>Set it up once.</b> Outline your driveway and where the snow goes, mark curbs and hazards, and pick how steep the drive is. After that, every storm is one tap.</p>
<p><b>Keep snow off the street.</b> Minnesota law doesn't allow snow to be pushed onto public roads, so mark a pile spot on your own property.</p>`,
    facts: [["1 min", "To book once your driveway is mapped"], ["Live", "Watch your plow on the map"], ["$0", "Contract or monthly fee"]],
    faq: [
      ["How much does driveway plowing cost in Proctor?", `Most single-car driveways are around ${driveways[0].text} and two-car driveways around ${driveways[1].text} per storm, including fees.`],
      COMMON_FAQ.contract, COMMON_FAQ.who, COMMON_FAQ.price,
    ],
    sources: [SRC.mndot],
  }),
  city({
    slug: "snow-plowing-esko-mn", short: "Esko, MN", place: "Esko", geoRegion: "US-MN", areaServed: [["Esko", "MN"], ["Thomson Township", "MN"]],
    title: "Snow Plowing Esko MN | Long & Rural Driveway Plowing | DRIFT",
    description: "On-demand snow plowing for Esko, MN driveways, including long, rural and gravel drives. Name your price, track your plow, pay only when it's done.",
    h1: "Snow plowing in <em>Esko, MN</em>", h1Plain: "Snow plowing in Esko, MN",
    lead: "Long, rural and gravel driveways plowed by local operators. Outline it once, book every storm in a tap.",
    priceFrom: estimateRange(SIZES[0].sqft).lo,
    localTitle: "Rural driveways, <em>handled</em>",
    local: `
<p><b>Gravel driveway?</b> Mark it as gravel when you set up. Drivers plowing gravel keep the blade up a little so they don't tear up the surface, and the suggested price accounts for it.</p>
<p><b>Big driveway, fair price.</b> The suggested price comes from the area you outline, and the rate per square foot drops once a big driveway passes $50, so long country drives don't get priced out.</p>
<p><b>Snow stays off the road.</b> Minnesota law doesn't allow snow on public roads or in the ditch. Mark where the pile goes and the driver follows your map.</p>`,
    facts: [["½ rate", "Per sq ft once a big driveway's price passes $50"], ["Gravel", "Marked on your map so drivers adjust"], ["$0", "Contract or monthly fee"]],
    faq: [
      ["Do you plow gravel driveways?", "Yes. Mark the surface as gravel when you set up your property so drivers know before they accept."],
      ["How much does it cost to plow a long driveway in Esko?", `Long driveways usually run about ${driveways[2].text} and very large ones about ${driveways[3].text} per storm, including fees.`],
      COMMON_FAQ.contract, COMMON_FAQ.who,
    ],
    sources: [SRC.mndot],
  }),

  // ---------------- services ----------------
  {
    kind: "service", slug: "sidewalk-snow-removal-duluth", short: "Sidewalk snow removal", cardTitle: "Sidewalks", cardText: "Walks and steps cleared before the city's 24-hour deadline.", cardPrice: `Around $${SIDEWALK.standardTotal}–$${SIDEWALK.total} for 60 ft`,
    place: "Duluth", areaServed: [["Duluth", "MN"], ["Superior", "WI"], ["Hermantown", "MN"]], serviceType: "Sidewalk snow removal",
    title: "Sidewalk Snow Removal Duluth MN | Beat the 24-Hour Rule | DRIFT",
    description: "Sidewalk snow shoveling and blowing in Duluth and Superior. Clear your walk before the 24-hour deadline. Book in a minute, pay only when it's done.",
    h1: "Sidewalk snow removal in <em>Duluth</em>", h1Plain: "Sidewalk snow removal in Duluth", cta: "Get my sidewalk cleared",
    lead: "Duluth gives you 24 hours after it stops snowing to clear your sidewalk. A local driver with a snowblower can have it done in one trip.",
    prices: [60, 120, 200, 300].map((ft, i) => ({ label: `${ft} ft of sidewalk`, hint: ["Typical city lot", "Corner lot", "Long frontage", "Large or commercial-size"][i], text: `$${sidewalkPrice(ft).standardTotal}–$${sidewalkPrice(ft).total}` })),
    pricesFine: "Sidewalk prices come from the length of walk you mark on the map. Add it to a driveway plow and one driver does both.",
    drivewayFrom: DRIVEWAY_FROM,
    localTitle: "The <em>24-hour</em> rule",
    local: `
<p>In Duluth, property owners have to clear snow and ice from the sidewalk <b>within 24 hours of the end of a snowfall</b>, across the full width of the walk on every side of the property. Corner lots also have to clear the curb cuts down to the street.</p>
<p>If a walk isn't cleared, the city can send a compliance letter, then have a contractor clear it and bill the property owner. You also can't shovel or blow the snow into the street or alley.</p>
<p>Superior has a similar rule: clear the sidewalk in front of your property within 24 hours of a snowfall.</p>
<p><a href="/guides/duluth-sidewalk-snow-rules/">Read the full guide to Duluth's sidewalk rules</a>.</p>`,
    facts: [["24 hrs", "After snow stops, in Duluth and Superior"], ["Full width", "Every side of the property, plus corner curb cuts"]],
    faq: [
      ["How long do I have to clear my sidewalk in Duluth?", "24 hours after the snowfall ends. If more snow falls, the city pushes re-checks back to 24 hours after the latest snowfall ends."],
      ["What happens if I don't clear it?", "The city can send a compliance letter. If it still isn't cleared, a contractor can clear it and the cost is charged to the property owner."],
      ["Can someone clear my sidewalk and driveway in one trip?", "Yes. Add the sidewalk when you book and the same driver handles both."],
    ],
    sources: [SRC.duluthSnow, SRC.superior],
  },
  {
    kind: "service", slug: "car-dig-out-duluth", short: "Car dig-outs", cardTitle: "Car dig-outs", cardText: "Freed from the berm the city plow left behind.", cardPrice: `Around $${DIGOUT.standardTotal}–$${DIGOUT.total}`,
    place: "Duluth", areaServed: [["Duluth", "MN"], ["Superior", "WI"]], serviceType: "Vehicle snow dig-out",
    title: "Car Dig-Out Duluth MN | Snowed-In Car Help | DRIFT",
    description: "Snowed in on a Duluth street? Book a local driver to dig out your car and clear the plow berm. Flat price, pay when you're free.",
    h1: "Car dig-outs in <em>Duluth</em>", h1Plain: "Car dig-outs in Duluth", cta: "Dig my car out",
    lead: "The city plow came through and buried your car in a wall of snow. Book a local driver with a snowblower or shovel and get out.",
    prices: [{ label: "One car", hint: "Street or lot", text: `$${DIGOUT.standardTotal}–$${DIGOUT.total}` }, { label: "Plus driveway", hint: "Add a plow", text: "Book both" }, { label: "Deep berm", hint: "12\"+ snow", text: "Offer more" }, { label: "Flat price", hint: "Not by the hour", text: "No surprises" }],
    pricesFine: "Dig-outs are a flat suggested price. You can offer more after a big storm to get picked up first.",
    drivewayFrom: DRIVEWAY_FROM,
    localTitle: "Snowed in <em>after the plow?</em>",
    local: `
<p>After a big storm the city plows push a hard ridge of snow along the curb, right where cars are parked. On a hill that ridge can be impossible to drive through.</p>
<p>Book a dig-out and a local driver clears around the car and breaks through the berm so you can get out. If you need to move the car for a snow emergency, <a href="/guides/duluth-winter-parking/">here's how Duluth's winter parking works</a>.</p>`,
    facts: [["Flat", "Suggested price, set before you book"], ["Live", "See your driver on the map"]],
    faq: [["How much does a car dig-out cost?", `About $${DIGOUT.standardTotal}–$${DIGOUT.total} suggested, including fees. You can offer more after a big storm.`], COMMON_FAQ.who],
    sources: [SRC.duluthParking],
  },
  {
    kind: "service", slug: "jump-start-duluth", short: "Jump-starts", cardTitle: "Jump-starts", cardText: "Dead battery at -20°? Someone nearby can help.", cardPrice: `Around $${JUMP.standardTotal}–$${JUMP.total}`,
    place: "Duluth", areaServed: [["Duluth", "MN"], ["Superior", "WI"], ["Hermantown", "MN"]], serviceType: "Roadside jump-start",
    title: "Jump-Start Service Duluth MN | Dead Battery Help | DRIFT",
    description: "Dead battery in the cold? Book a local driver with jumper cables or a jump pack in Duluth, Superior and Hermantown. Flat price, track them live.",
    h1: "Jump-starts in <em>Duluth</em>", h1Plain: "Jump-starts in Duluth", cta: "Get a jump-start",
    lead: "Car won't start on a below-zero morning? A local driver with a jump pack can come to you. Flat price, live tracking.",
    prices: [{ label: "Jump-start", hint: "At your home or work", text: `$${JUMP.standardTotal}–$${JUMP.total}` }, { label: "Flat price", hint: "Set before you book", text: "No surprises" }, { label: "Live", hint: "Track them in the app", text: "On the way" }, { label: "Tip", hint: "100% goes to the driver", text: "Optional" }],
    pricesFine: "If the battery is done for good, a jump only gets you to the shop. If someone's hurt or you're stuck on a highway, call 911.",
    drivewayFrom: DRIVEWAY_FROM,
    localTitle: "Cold-weather <em>battery help</em>",
    local: `
<p>Car batteries lose a lot of their power in deep cold, so the first sub-zero mornings of the season are when they quit. DRIFT drivers with a roadside kit can take jump-start jobs between plowing runs.</p>
<p>Book it like a plow: tell us where the car is, see the flat price, and watch the driver come to you.</p>`,
    facts: [["Flat", "Suggested price, set before you book"], ["Live", "See your driver on the map"]],
    faq: [["How much is a jump-start?", `About $${JUMP.standardTotal}–$${JUMP.total} suggested, including fees.`], COMMON_FAQ.who],
  },

  // ---------------- guides ----------------
  {
    kind: "guide", slug: "guides/duluth-sidewalk-snow-rules", short: "Duluth sidewalk snow rules",
    crumbs: [["Home", "/"], ["Guides", null], ["Sidewalk snow rules", null]],
    place: "Duluth", title: "Duluth Sidewalk Snow Rules (2026): The 24-Hour Rule",
    description: "How Duluth's sidewalk snow removal rule works: 24 hours after snow ends, full width, corner curb cuts, what happens if you don't, and Superior's rule too.",
    h1: "Duluth sidewalk <em>snow rules</em>", h1Plain: "Duluth sidewalk snow rules", cta: "Get my sidewalk cleared",
    lead: "Duluth gives property owners 24 hours after it stops snowing to clear the sidewalk. Here's exactly what that means, and what happens if you miss it.",
    localKicker: "The rules", localTitle: "What Duluth <em>requires</em>",
    local: `
<h3>The deadline: 24 hours after the snow stops</h3>
<p>Property owners have to clear snow and ice from the sidewalk <b>within 24 hours of the end of a snowfall</b>. If another snowfall comes in, the city pushes re-checks back to 24 hours after the latest snow ends.</p>
<h3>How much you have to clear</h3>
<ul><li>The <b>full width</b> of the sidewalk</li><li>On <b>every side</b> of your property that has a sidewalk</li><li>On corner lots, the <b>curb cuts</b> at the corner and crosswalks, down to the street gutter</li></ul>
<h3>Where the snow can go</h3>
<p>Not in the street or the alley. That's against city rules. Pile it on your yard.</p>
<h3>If you don't clear it</h3>
<p>The city can send a compliance letter. If the walk still isn't cleared when an inspector comes back, a contractor clears it and <b>the cost is charged to the property owner</b>, and unpaid charges can end up on your property taxes.</p>
<h3>Superior, WI</h3>
<p>Superior's ordinance (106-10) also gives owners <b>24 hours</b> after a snowfall to clear the sidewalk in front of their property.</p>
<h3>Can't do it yourself?</h3>
<p>Book a sidewalk clearing on DRIFT. A local driver with a snowblower handles it, and you can add your driveway to the same trip. <a href="/sidewalk-snow-removal-duluth/">See sidewalk prices</a>.</p>`,
    facts: [["24 hrs", "After snow stops"], ["Full width", "All sides + corner curb cuts"], ["No", "Snow in the street or alley"]],
    drivewayFrom: DRIVEWAY_FROM,
    faq: [
      ["How long do I have to shovel my sidewalk in Duluth?", "24 hours after the snowfall ends."],
      ["Do I have to clear the curb cut on a corner lot?", "Yes. Corner lots have to clear the curb cuts at the corner and crosswalks down to the street gutter."],
      ["Can I blow snow into the street in Duluth?", "No. It's against city rules to put snow in the street or alley."],
    ],
    sources: [SRC.duluthSnow, SRC.superior],
  },
  {
    kind: "guide", slug: "guides/duluth-winter-parking", short: "Duluth winter parking & snow emergencies",
    crumbs: [["Home", "/"], ["Guides", null], ["Winter parking", null]],
    place: "Duluth", title: "Duluth Winter Parking Rules & Snow Emergencies (2026 Guide)",
    description: "Duluth's alternate side parking changeover, what happens in a snow emergency, the free parking lots, and how to avoid a ticket or tow.",
    h1: "Duluth winter parking &amp; <em>snow emergencies</em>", h1Plain: "Duluth winter parking and snow emergencies",
    lead: "Alternate side parking, snow emergency routes and free lots. Here's how Duluth's winter parking works so your car doesn't end up in the impound lot.",
    localKicker: "The rules", localTitle: "How it <em>works</em>",
    local: `
<h3>Alternate side parking</h3>
<p>Every week, cars switch to the other side of the street during a changeover window on <b>Sunday between 4 and 8 p.m.</b> Parking on both sides is allowed only during that window. The city publishes a schedule each season showing which side is which.</p>
<h3>Snow emergencies</h3>
<p>When the city declares a snow emergency, you have to keep cars off designated snow emergency routes so plows can get through. Free public lots open from <b>4 p.m. on day one to 8 p.m. on day two</b>, first come, first served. You can stay parked there until two hours after the emergency ends.</p>
<h3>Tickets and towing</h3>
<p>Breaking the rules can mean a ticket and a tow to the impound lot. If your car was towed, the city's number is (218) 730-5400.</p>
<h3>The easy fix: a clear driveway</h3>
<p>The simplest way to stay out of all of it is to park off the street. If your driveway is buried, <a href="/snow-plowing-duluth-mn/">book a plow on DRIFT</a> and have it cleared before the emergency starts. Already buried by the city plow? <a href="/car-dig-out-duluth/">Book a car dig-out</a>.</p>`,
    facts: [["Sun 4–8 pm", "Weekly alternate side changeover"], ["Free lots", "4 pm day 1 to 8 pm day 2 of an emergency"], ["(218) 730-5400", "Towed vehicle line"]],
    drivewayFrom: DRIVEWAY_FROM,
    faq: [
      ["When is alternate side parking changeover in Duluth?", "Every Sunday between 4 p.m. and 8 p.m. Both sides are allowed only during that window."],
      ["Where can I park during a Duluth snow emergency?", "In the free public lots the city opens, from 4 p.m. on day one to 8 p.m. on day two. Spaces are first come, first served."],
      ["What number do I call if my car was towed in Duluth?", "The city lists (218) 730-5400."],
    ],
    sources: [SRC.duluthParking],
  },
  {
    kind: "guide", slug: "snow-plowing-cost-duluth", short: "How much snow plowing costs",
    crumbs: [["Home", "/"], ["Guides", null], ["Snow plowing cost", null]],
    place: "Duluth", title: "How Much Does Snow Plowing Cost in Duluth? (2026 Prices)",
    description: "Real per-storm snow plowing prices in Duluth, MN by driveway size, plus what makes it cost more, and per-storm vs. seasonal contracts.",
    h1: "What snow plowing <em>costs in Duluth</em>", h1Plain: "What snow plowing costs in Duluth",
    lead: "Per-storm prices for driveway plowing in Duluth by size, what pushes the price up, and how it compares to a seasonal contract.",
    prices: driveways, pricesKicker: "2026 prices", pricesTitle: "Per storm, by driveway size",
    localKicker: "What changes the price", localTitle: "Why prices <em>vary</em>",
    local: `
<h3>Size</h3>
<p>The biggest factor is how much area gets plowed. On DRIFT you outline it on a satellite map and the suggested price comes from the real square footage. The rate per square foot drops by half once a big driveway's price passes $50.</p>
<h3>Slope</h3>
<p>This is Duluth: steep driveways take longer and need more care, so the suggested price goes up a bit when you mark a moderate or steep slope.</p>
<h3>Snow depth</h3>
<p>Deeper snow is a bigger job. The suggested price goes up about 15% for 4–8 inches, 30% for 8–12 inches and 50% for a foot or more.</p>
<h3>Per storm vs. a seasonal contract</h3>
<p>Duluth averages about 86 inches of snow a winter, but it swings a lot from year to year. The snowiest winter on record topped 135 inches. A seasonal contract charges the same no matter what. Paying per storm means a light winter costs you less, and you're never locked in.</p>
<h3>What's included in the price</h3>
<p>Your offer, a <b>$10 call-out fee</b> that goes to the driver, and a <b>$5 booking fee</b>. Drivers keep 80% of your offer plus the call-out and every tip. You're charged only after the job is done.</p>`,
    facts: [["86\"", "Normal Duluth snowfall per winter (NWS)"], ["135\"+", "Duluth's snowiest winter on record"], ["+15–50%", "For deep snow (4\"+)"]],
    drivewayFrom: DRIVEWAY_FROM,
    faq: [
      ["How much does it cost to plow a driveway in Duluth?", `Most single-car driveways come in around ${driveways[0].text} and two-car driveways around ${driveways[1].text} per storm, including fees.`],
      ["Is a seasonal snow plowing contract worth it in Duluth?", "It depends on the winter. A contract costs the same whether it's a light or heavy year. Paying per storm means you only pay for the snow that actually falls and you're never locked in."],
      COMMON_FAQ.price,
    ],
    sources: [SRC.nws],
  },
];
