/* CHROMATICA — the argument, walked.
 *
 * The about panel held nine hundred words explaining what the field is and why
 * it looks the way it does, in a box 420px wide, and nobody read them. The
 * field itself makes the argument perfectly well — colour at its highest in the
 * fourteenth century, collapsing through the Baroque, recovering only two
 * thirds of the way by 1900 — but only if you already know to look for it, and
 * only if you know how to drive the controls that show it.
 *
 * So the argument drives them for you. Each step sets the state of the field
 * and says one sentence; the field recomposes underneath. Nothing here is a
 * second rendering or a special mode: every step is exactly a state you could
 * reach by hand, which means it is also a permalink, and the last step leaves
 * you in the field with the controls where the story left them.
 *
 * Every number in these sentences is measured off the built dataset, not
 * written down from memory — see tests/story.test.mjs, which recomputes the
 * curve and fails if the prose and the data have drifted apart. The figures as
 * of the five-collection build: the curve peaks at 27.0 around 1339, bottoms
 * at 15.0 around 1672, and ends at 17.0, which is 63% of the peak.
 */

/** @typedef {{title: string, text: string, state: object}} Step */

/* `state` is applied by main.js and is deliberately a plain description rather
   than a function: it is the same set of things the URL carries, so a step is
   a view someone could have arrived at and can hand on. */
export const STEPS = [
  {
    title: "EVERY DOT IS A MEASUREMENT",
    text: "Seven thousand paintings, reduced to the colours they are actually "
      + "made of. Each particle is one colour, taken by k-means from the "
      + "photograph of one real work in five open-access collections. Nothing "
      + "was chosen, corrected or invented. Left to right is the year; up and "
      + "down is how light the colour is.",
    state: { mode: "all", chrono: true, nat: -1, query: "" },
  },
  {
    title: "COLOUR PEAKS EARLY",
    text: "The most saturated painting in six centuries is the earliest. "
      + "Around 1339 the mean chroma of the collection reaches 27 — gold "
      + "ground, vermilion, ultramarine ground from lapis, laid on in flat "
      + "unmixed areas. The three most colourful painters here are all "
      + "Sienese and Florentine, and nothing since has come close.",
    state: { mode: "time", year: 1339, chrono: true, nat: -1, query: "" },
  },
  {
    title: "THEN IT GOES OUT",
    text: "By the 1670s the same measurement has fallen to 15, its lowest in "
      + "the whole span, and the field has sunk down the lightness axis with "
      + "it. This is the century of the dark ground: the canvas primed brown "
      + "or black, colour emerging from shadow rather than sitting on gold. "
      + "The collapse is the largest single movement in the data.",
    state: { mode: "time", year: 1672, chrono: true, nat: -1, query: "" },
  },
  {
    title: "THE DUTCH ARE THE FLOOR",
    text: "Of the twelve schools here the Dutch are the most muted, and it is "
      + "not close. Their palette is the Baroque argument in one tradition — "
      + "and this is the corner of the field the Rijksmuseum was added to "
      + "measure properly rather than through whatever four American museums "
      + "happened to own.",
    state: { mode: "all", chrono: true, natName: "Dutch", query: "" },
  },
  {
    title: "AND IT ONLY HALF COMES BACK",
    text: "The nineteenth century recovers, and stops well short: 17 at the "
      + "end of the span, about two thirds of the medieval figure. What does "
      + "return in full is light — the field climbs back up the vertical axis "
      + "to where it began. Brighter, and still not as coloured.",
    state: { mode: "time", year: 1890, chrono: true, nat: -1, query: "" },
  },
  {
    title: "THE SAME COLOURS, READ BY HUE",
    text: "Nothing is refiltered here and nothing is recomputed: the same "
      + "particles walk to a second pair of axes. This is the CIE L*a*b* "
      + "plane itself, so neutrals fall in the middle and saturated colours "
      + "reach the rim. How little of it is filled is the same fact the curve "
      + "was making, seen from above.",
    state: { mode: "all", chrono: false, nat: -1, query: "" },
  },
  {
    title: "IT STOPS AT 1910",
    text: "The field ends rather than fades. That is a copyright boundary and "
      + "not an aesthetic one: works after about 1910 are almost never in the "
      + "public domain, so the twentieth century cannot be shown here "
      + "honestly. What you have been looking at is a survey of what five "
      + "museums hold and have released — not of art history.",
    state: { mode: "all", chrono: true, nat: -1, query: "" },
  },
];
