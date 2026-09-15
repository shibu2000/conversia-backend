/** Name and copy pools the seed draws from. */

export const FIRST_NAMES = [
  "Rahul", "Priya", "Amit", "Neha", "Vikram", "Ananya", "Arjun", "Kavya", "Rohit", "Divya",
  "Sarah", "James", "Emma", "Michael", "Olivia", "Daniel", "Sophia", "Thomas", "Isabella", "Lucas",
  "Chen", "Mei", "Hiroshi", "Yuki", "Carlos", "Sofia", "Mateo", "Camila", "Omar", "Layla",
  "Nina", "Felix", "Elena", "Marcus", "Zara", "Ibrahim", "Aisha", "Kwame", "Fatima", "Diego",
] as const;

export const LAST_NAMES = [
  "Sharma", "Patel", "Reddy", "Iyer", "Nair", "Kapoor", "Mehta", "Desai", "Bose", "Rao",
  "Chen", "Wang", "Tanaka", "Sato", "Garcia", "Martinez", "Silva", "Costa", "Hassan", "Ali",
  "Whitfield", "Brennan", "Okonkwo", "Lindqvist", "Moreau", "Rossi", "Novak", "Kowalski", "Dubois", "Fischer",
] as const;

export const COUNTRIES = [
  { name: "India", timezone: "Asia/Kolkata", locale: "en-US" },
  { name: "United States", timezone: "America/New_York", locale: "en-US" },
  { name: "United Kingdom", timezone: "Europe/London", locale: "en-GB" },
  { name: "Germany", timezone: "Europe/Berlin", locale: "de-DE" },
  { name: "Singapore", timezone: "Asia/Singapore", locale: "en-GB" },
  { name: "Australia", timezone: "Australia/Sydney", locale: "en-GB" },
] as const;

export const CUSTOMER_TAGS = [
  "vip", "repeat-buyer", "high-value", "at-risk", "newsletter", "wholesale", "enterprise", "referral",
] as const;

export const LEAD_INTERESTS = [
  "Bulk order pricing for 200+ units",
  "Wholesale account for a gym chain",
  "Corporate gifting programme for 150 staff",
  "Custom branding on water bottles",
  "Replacement stock for a retail partner",
  "Annual supply contract enquiry",
  "Trade pricing for a sports club",
  "Reseller enquiry for the Nordics",
] as const;

export const PRODUCT_SEEDS = [
  { name: "Trailstride Running Shoe", category: "Footwear", price: 10_499, keywords: ["cushioning", "road running", "flat feet"] },
  { name: "Summit Trekking Boot", category: "Footwear", price: 14_999, keywords: ["waterproof", "ankle support", "hiking"] },
  { name: "Pacer Race Flat", category: "Footwear", price: 8_999, keywords: ["lightweight", "racing", "marathon"] },
  { name: "Stormshell Rain Jacket", category: "Apparel", price: 7_499, keywords: ["waterproof", "packable", "commuting"] },
  { name: "Merino Base Layer", category: "Apparel", price: 3_999, keywords: ["merino wool", "thermal", "odour resistant"] },
  { name: "Trailwind Windbreaker", category: "Apparel", price: 5_499, keywords: ["windproof", "breathable", "trail"] },
  { name: "Pulse Fitness Tracker", category: "Electronics", price: 6_499, keywords: ["heart rate", "sleep tracking", "gps"] },
  { name: "Cadence Wireless Earbuds", category: "Electronics", price: 5_999, keywords: ["sweatproof", "noise cancelling", "workout"] },
  { name: "Beacon Bike Light", category: "Electronics", price: 2_499, keywords: ["rechargeable", "commuting", "visibility"] },
  { name: "Anchor Yoga Mat", category: "Fitness", price: 3_299, keywords: ["non-slip", "eco", "yoga"] },
  { name: "Flexroll Foam Roller", category: "Fitness", price: 1_899, keywords: ["recovery", "myofascial", "mobility"] },
  { name: "Kettle Pro 12kg", category: "Fitness", price: 4_299, keywords: ["home gym", "strength", "cast iron"] },
  { name: "Hydraflask 750ml", category: "Accessories", price: 1_499, keywords: ["insulated", "leakproof", "stainless"] },
  { name: "Summit Daypack 22L", category: "Accessories", price: 4_999, keywords: ["hiking", "hydration", "lightweight"] },
  { name: "Trailcap Running Cap", category: "Accessories", price: 999, keywords: ["breathable", "uv protection", "running"] },
  { name: "Gripper Training Gloves", category: "Accessories", price: 1_299, keywords: ["grip", "weightlifting", "padded"] },
] as const;

export const TICKET_SCENARIOS = [
  {
    subject: "Wrong product received",
    category: "order_issue" as const,
    description:
      "Customer ordered the Trailstride Running Shoe in size 9 but received the Summit Trekking Boot in size 11. Photos of the packing slip and the item are attached.",
    customerMessage: "I ordered the Trailstride in size 9 but received the Summit boot in size 11. I need the right item before the weekend.",
    agentReply: "Thanks for flagging this. I have arranged a courier pickup for the wrong item and dispatched the correct size today — it should reach you in two working days.",
    resolution: "Correct item delivered and the wrong one collected. Customer confirmed.",
    internalNote: "Warehouse confirmed the picking error — third one this week from bay 4. Flagged to ops.",
  },
  {
    subject: "Package marked delivered but not received",
    category: "delivery" as const,
    description: "Tracking shows the parcel as delivered, but the customer has nothing. The courier says it was handed to a neighbour, which the customer disputes.",
    customerMessage: "The tracking says delivered but nothing arrived. I have checked with my neighbours and nobody has it.",
    agentReply: "I have opened an investigation with the courier. They have 48 hours to respond, and if they cannot locate it we will send a replacement at no cost to you.",
    resolution: "Courier could not locate the parcel. Replacement dispatched and delivered.",
    internalNote: "Second lost parcel on this route this month. Worth raising with the courier account manager.",
  },
  {
    subject: "Refund not credited after 10 days",
    category: "refund" as const,
    description: "Refund was approved 10 days ago after a return was received, but the amount has not appeared on the customer's card statement.",
    customerMessage: "It has been ten days since the refund was approved and there is still nothing on my card.",
    agentReply: "I can see the refund is stuck at the payment gateway rather than on our side. I have escalated it and pushed a manual reversal — it should settle within two working days.",
    resolution: "Manual reversal processed. Customer confirmed the credit appeared.",
    internalNote: "Gateway batch from the 2nd failed silently. Finance is reconciling the whole batch.",
  },
  {
    subject: "Item arrived damaged in transit",
    category: "product_defect" as const,
    description: "The product arrived with a visible crack in the housing. The outer box was undamaged, which suggests it was packed that way.",
    customerMessage: "The tracker arrived with a crack in the casing. The box was fine, so I think it was already broken.",
    agentReply: "You are right that the outer box being intact points to a packing issue rather than transit damage. A replacement is on its way and there is nothing to return.",
    resolution: "Replacement delivered. Faulty unit written off, no return required.",
    internalNote: "Third cracked housing from this batch. Quality flagged to the supplier.",
  },
  {
    subject: "Cannot apply discount code at checkout",
    category: "technical" as const,
    description: "The discount code shown on the homepage banner is rejected at checkout as expired, though the banner is still live.",
    customerMessage: "Your homepage is advertising SAVE20 but checkout says the code has expired. Which is right?",
    agentReply: "The banner was live past the promotion end date, which is on us. I have applied the 20% manually to your order and the banner has been pulled.",
    resolution: "Discount applied manually and the stale banner removed from the homepage.",
    internalNote: "Promo scheduler did not expire the banner. Raised with the web team.",
  },
  {
    subject: "Duplicate charge on my card",
    category: "billing" as const,
    description: "The customer's statement shows two identical authorisations for one order. Only one order exists in our system.",
    customerMessage: "I was charged twice for order #48812. Please sort this out.",
    agentReply: "Confirmed — the second authorisation was a duplicate and I have reversed it today. Depending on your bank it will clear in 3–5 working days.",
    resolution: "Duplicate authorisation reversed and confirmed by the customer.",
    internalNote: "Retry logic double-submitted on a timeout. Payments team is aware.",
  },
  {
    subject: "Size exchange request",
    category: "returns" as const,
    description: "Customer wants to exchange a pair of shoes for a half size up. The item is unworn with tags attached.",
    customerMessage: "These are slightly tight. Can I swap them for a half size up?",
    agentReply: "Of course — I have reserved the larger size and emailed you a prepaid return label. The exchange is free both ways.",
    resolution: "Exchange completed and the replacement delivered.",
    internalNote: "Customer between sizes; noted on their profile for future orders.",
  },
] as const;

export const CONVERSATION_OPENERS: Record<string, string[]> = {
  faq: [
    "What's your return window? I bought a pair of shoes that don't fit.",
    "How long does delivery take to Bengaluru?",
    "Is shipping free if I only order one item?",
  ],
  product_discovery: [
    "Which running shoe would you recommend for flat feet?",
    "I'm looking for a waterproof jacket for cycling to work. What do you have?",
  ],
  order_status: [
    "Hi, I ordered last Tuesday and the tracking hasn't moved in three days. Can you check?",
    "Where is my order? It was supposed to arrive yesterday.",
  ],
  support_issue: ["The earbuds I received only work on one side.", "My package is marked delivered but I never received it."],
  lead_capture: ["I need 150 units for a corporate gift. Is there a bulk discount?", "I'd like to set up a wholesale account for my gym."],
  booking: ["Do you do gait analysis in store? I'd like to book a slot."],
  pricing: ["How much is the Pulse tracker, and is there a discount this month?"],
  complaint: ["I was charged twice for order #48812. This is the third time I've asked about it."],
  small_talk: ["Hi there!"],
  unknown: ["I have a question about something on your site."],
};

export const FAQ_TREE = {
  support: [
    {
      name: "Shipping",
      children: [
        {
          name: "Delivery",
          questions: [
            {
              q: "How long does delivery take?",
              a: "Standard delivery is 3–5 working days within India and 7–12 working days internationally. Orders placed after 2 pm IST ship the next working day.",
              keywords: ["delivery time", "how long", "shipping duration", "when will it arrive"],
              priority: 10,
            },
            {
              q: "Do you offer express delivery?",
              a: "Yes, express delivery (1–2 working days) is available in 42 pin codes for ₹199. You will see the option at checkout if your address qualifies.",
              keywords: ["express", "fast delivery", "next day", "urgent"],
              priority: 8,
            },
            {
              q: "Can I change my delivery address after ordering?",
              a: "You can change the address any time before the order ships. Open the order page and choose Edit address. Once it has shipped, contact us and we will try to redirect it with the courier.",
              keywords: ["change address", "wrong address", "redirect"],
              priority: 6,
            },
          ],
        },
        {
          name: "Charges",
          questions: [
            {
              q: "How much does shipping cost?",
              a: "Shipping is free on orders above ₹1,500. Below that, a flat ₹99 applies. Express delivery is ₹199 where available.",
              keywords: ["shipping cost", "delivery charge", "how much", "fee"],
              priority: 9,
            },
            {
              q: "Is shipping free?",
              a: "Shipping is free on all orders above ₹1,500. There is no minimum for exchanges — those are always free both ways.",
              keywords: ["free shipping", "free delivery", "minimum order"],
              priority: 9,
            },
          ],
        },
        {
          name: "International",
          questions: [
            {
              q: "Which countries do you ship to?",
              a: "We ship to 34 countries across Asia, Europe, the Middle East and Australia. You can see the full list at checkout once you select your country.",
              keywords: ["international", "countries", "ship abroad", "overseas"],
              priority: 5,
            },
            {
              q: "Who pays customs duty on international orders?",
              a: "Customs duty and any import taxes are the recipient's responsibility and are collected by the courier on delivery. The amount varies by country.",
              keywords: ["customs", "duty", "import tax"],
              priority: 4,
            },
          ],
        },
      ],
    },
    {
      name: "Returns",
      children: [
        {
          name: "Return Policy",
          questions: [
            {
              q: "What is your return policy?",
              a: "You can return any unworn item with its tags attached within 30 days of delivery for a full refund. Items marked final sale are excluded. Returns are free within India.",
              keywords: ["return policy", "returns", "30 days", "send back"],
              priority: 10,
            },
            {
              q: "What is the return period?",
              a: "30 days from the date of delivery, not the date of order. If the 30th day falls on a public holiday you get until the next working day.",
              keywords: ["return period", "return window", "deadline"],
              priority: 10,
            },
          ],
        },
        {
          name: "Exchange",
          questions: [
            {
              q: "How do I exchange for a different size?",
              a: "Open the order page, choose Exchange, and pick the size you want. We reserve the new size immediately and send a prepaid return label for the original. Exchanges are free both ways.",
              keywords: ["exchange", "different size", "wrong size", "swap"],
              priority: 8,
            },
          ],
        },
        {
          name: "Refund",
          questions: [
            {
              q: "Where is my refund?",
              a: "Refunds are issued to the original payment method 5–7 working days after the returned item reaches our warehouse. You will get an email the moment we receive it.",
              keywords: ["refund", "money back", "refund status"],
              priority: 10,
            },
          ],
        },
      ],
    },
    {
      name: "Payment",
      questions: [
        {
          q: "What payment methods do you accept?",
          a: "We accept UPI, all major credit and debit cards, net banking, and cash on delivery on orders under ₹10,000. We do not currently support instalment plans.",
          keywords: ["payment methods", "how to pay", "cards", "upi", "cod"],
          priority: 9,
        },
        {
          q: "Is cash on delivery available?",
          a: "Cash on delivery is available on orders under ₹10,000 to serviceable pin codes. There is a ₹49 handling fee, and COD orders cannot be modified after placement.",
          keywords: ["cod", "cash on delivery", "pay on delivery"],
          priority: 7,
        },
        {
          q: "Can I pay in instalments?",
          a: "We are working on no-cost EMI and expect it in the next quarter. For now, orders must be paid in full.",
          keywords: ["emi", "instalments", "pay later"],
          status: "draft" as const,
          priority: 2,
        },
      ],
    },
    {
      name: "Orders",
      children: [
        {
          name: "Tracking",
          questions: [
            {
              q: "How do I track my order?",
              a: "Every order gets a tracking link by email and SMS when it ships. You can also open the order page and choose Track shipment for live courier updates.",
              keywords: ["track", "tracking", "where is my order", "shipment status"],
              priority: 10,
            },
          ],
        },
        {
          name: "Changes",
          questions: [
            {
              q: "Can I cancel my order?",
              a: "You can cancel free of charge any time before the order ships, from the order page. Once it has shipped, refuse the delivery or start a return instead.",
              keywords: ["cancel", "cancel order", "stop order"],
              priority: 8,
            },
          ],
        },
      ],
    },
  ],
  sales: [
    {
      name: "Wholesale",
      questions: [
        {
          q: "Do you offer bulk or wholesale pricing?",
          a: "Yes. Wholesale pricing starts at 100 units per SKU, with better tiers at 250 and 500 units. Accounts need a GST number and are approved within two working days.",
          keywords: ["bulk", "wholesale", "volume discount", "trade price"],
          priority: 10,
        },
        {
          q: "How do I open a wholesale account?",
          a: "Share your business name, GST number and expected monthly volume and our sales team will set the account up. You will get a dedicated account manager and net-30 terms after the first three orders.",
          keywords: ["wholesale account", "trade account", "business account"],
          priority: 8,
        },
      ],
    },
    {
      name: "Corporate Gifting",
      questions: [
        {
          q: "Can you do custom branding on products?",
          a: "We can add logos to caps, bottles and bags with a 200-unit minimum. Lead time is 3–4 weeks including a physical sample for approval.",
          keywords: ["custom branding", "logo", "corporate gifts", "personalised"],
          priority: 7,
        },
      ],
    },
  ],
  product: [
    {
      name: "Sizing",
      questions: [
        {
          q: "How does your sizing run?",
          a: "Our footwear runs true to the size chart on each product page. Customers between two sizes are generally happier going up, especially in the Summit boot.",
          keywords: ["sizing", "size chart", "fit", "true to size"],
          priority: 9,
        },
      ],
    },
    {
      name: "Warranty",
      questions: [
        {
          q: "Do your products have a warranty?",
          a: "Everything carries a two-year warranty against manufacturing defects from the date of purchase. Normal wear, misuse and accidental damage are not covered.",
          keywords: ["warranty", "guarantee", "defect", "two years"],
          priority: 9,
        },
        {
          q: "How do I make a warranty claim?",
          a: "Send us the order reference and photos of the issue. A specialist reviews it within one working day and arranges either a repair or a replacement.",
          keywords: ["warranty claim", "faulty", "broken", "repair"],
          priority: 6,
        },
      ],
    },
  ],
};

export const POLICY_DOCUMENTS: Record<string, string> = {
  "return-policy.pdf": `RETURN AND EXCHANGE POLICY

1. Return window
Items may be returned within 30 days of delivery provided they are unworn and in original packaging with tags attached. Refunds are issued to the original payment method within 5-7 working days of the item reaching our warehouse.

2. Exclusions
Sale items marked "final sale" are exempt from the standard return window. Underwear, swimwear and nutrition products cannot be returned once opened, for hygiene reasons.

3. Exchanges
Exchanges for a different size or colour are free and do not count against the return allowance. We reserve the replacement stock as soon as the exchange is requested and hold it for 14 days.

4. Return shipping
Returns within India are free using the prepaid label supplied on the order page. International returns are at the customer's cost unless the item is faulty or was sent in error.`,
  "shipping-policy.pdf": `SHIPPING POLICY

Domestic delivery
Standard delivery within India is 3-5 working days. International delivery is 7-12 working days depending on customs clearance. Orders placed after 14:00 IST ship the following working day.

Charges
Shipping is free on orders above Rs 1,500. Below that a flat Rs 99 applies. Express delivery is available in 42 pin codes at Rs 199 and arrives in 1-2 working days.

Tracking
A tracking link is sent by email and SMS at dispatch. If tracking shows no movement for three working days, we open an investigation with the courier.`,
  "warranty-terms.docx": `WARRANTY TERMS

Coverage
All products carry a two-year warranty against manufacturing defects from the date of purchase. Normal wear, misuse and damage from accidents are excluded.

Footwear
Sole separation, upper delamination and stitching failure are covered. Outsole wear from normal use is not, as tread depth is a consumable.

Claim process
Submit photographs and the order reference. A specialist reviews within one working day.`,
  "wholesale-guide.pdf": `WHOLESALE AND TRADE GUIDE

Minimums and tiers
Wholesale pricing starts at 100 units per SKU with tiered discounts at 100, 250 and 500 units.

Account approval
Accounts require a GST number and are approved within two working days.

Payment terms
First three orders are prepaid. Net-30 terms are available thereafter subject to a credit check.`,
};
