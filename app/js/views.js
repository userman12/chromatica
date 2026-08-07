/* CHROMATICA — the four readings, and which controls belong to each.
 *
 * The interface did not become hard to hold because there are too many
 * controls. There are eight. It became hard to hold because all eight were
 * offered at once, at one rank, with nothing saying which belonged together —
 * so the state you were in was the product of five independent variables and
 * no part of the screen named it.
 *
 * A reading is the answer: one question at the top, a handful of answers, and
 * each answer brings its own controls and puts the others away. What is *not*
 * happening here is a mode system in the usual sense. There is one dataset, one
 * field, one set of measurements; a reading only decides which of them is in
 * front of you and which controls can act. Leave the tables and the field is
 * exactly where you left it, still narrowed to whatever you had narrowed it to.
 *
 * The story is the one exception, and it is not an accident: setting the field
 * is what a step *is*, so entering it does discard what you were looking at.
 * That is announced rather than done quietly — see setView in main.js.
 *
 * Controls are put away with `visibility`, never with `hidden`. The field is a
 * canvas that fills whatever the two bars leave it, so a control that stops
 * taking up space resizes the picture, and the whole cloud jumps at the moment
 * you press a reading. This is the same rule the play button has always
 * followed; the readings only make it apply to more things.
 */

/** @typedef {"field"|"tables"|"story"} ViewName */

export const VIEWS = {
  field: {
    label: "FIELD",
    title: "Every measured colour, placed by date and lightness or by hue",
    /* The field's own controls: they change how it is drawn, which is what a
       control under a picture should do. */
    controls: ["cursor", "find", "school", "layout", "timelapse", "timeline"],
  },
  tables: {
    label: "TABLES",
    title: "Rank painters, schools and museums by the same measurements",
    /* None of the field's controls. The tables are read, not steered — and the
       field is still behind them, so leaving a search box live over a panel
       that does not use it is an invitation to type into nothing. */
    controls: [],
  },
  story: {
    label: "STORY",
    title: "Seven steps through what the field is showing",
    /* The story drives the field itself, so its controls are inert on purpose:
       changing school halfway through a step would leave the sentence on
       screen describing something that is no longer there. The timeline stays,
       because watching the lit window move is half of what several steps are
       saying. */
    controls: ["cursor", "timeline"],
  },
};

export const VIEW_NAMES = Object.keys(VIEWS);

/** Every control a reading can claim, and the element that carries it. */
export const CONTROLS = {
  cursor: "cursor",
  find: "findWrap",
  school: "schoolWrap",
  layout: "btnLayout",
  timelapse: "timelapseWrap",
  timeline: "timelineWrap",
};

/**
 * Show the controls this reading claims and put the rest away.
 *
 * @param {ViewName} view
 * @param {(id: string) => HTMLElement | null} byId
 */
export function applyView(view, byId) {
  const claimed = new Set((VIEWS[view] ?? VIEWS.field).controls);
  for (const [name, id] of Object.entries(CONTROLS)) {
    const node = byId(id);
    if (node) node.classList.toggle("is-vacant", !claimed.has(name));
  }
}
