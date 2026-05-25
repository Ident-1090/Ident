# Writing rules for the Ident docs

These docs explain the design of Ident to a reader. They are not a code tour.
Anyone who needs implementation detail can read the source. Keep these rules in
mind for every page.

## Audience and altitude

- Write for two readers: an operator deciding how to run Ident, and a prospective
  contributor trying to understand the system before changing it.
- Explain design choices and the reasons behind them. State what the system does
  and why it works that way.
- Stay above the line of fine implementation detail: no function or symbol names,
  no internal constants or magic numbers, no struct or field listings, no file
  paths or line numbers, no code snippets. A developer who wants those should open
  the code.
- The docs are orientation, not a substitute for the source. Do not aim to be a
  complete or authoritative specification of behavior, and do not frame a page as
  something a reader can rely on instead of reading the code. Someone integrating
  with or building on Ident is still expected to read the relevant code; give them
  the shape and the things worth knowing, and point them at the code for specifics.
- Some code-shape context is welcome where it helps a reader build a mental model:
  the rough shape of a piece of data (what a record holds, conceptually), the
  cadence of an operation, how layers fit together. Keep it conceptual, not a
  transcription of the code.
- Name the concrete mechanism when it adds understanding, instead of a vague verb.
  Prefer `watches files with filesystem notifications ([fsnotify](link))` over a
  bare "watches files", and link the library or standard once. Give the name and
  the link, not a paragraph explaining how it works.
- User-facing names are fine where they help: environment variables and config
  options that appear in the README, public endpoint paths, and product behavior.
- The "no code snippets" rule is about implementation code. How-to pages (install,
  configuration) should include the shell commands and config an operator actually
  runs; those are instructions, not implementation detail.
- Don't leave a page thin. Give enough context to actually understand the design.
  If a page is only a few sentences, it is probably missing the reasoning.

## Tone

- Describe choices the way an engineer would: objectively, as tradeoffs with
  reasons. Do not sell the design or imply it is the obviously smartest option.
- Be honest about certainty. Where something is provisional, unsettled, or likely
  to change, say so. Do not write with false confidence about parts that are
  still in flux.
- When you mention alternatives that were not taken, present them neutrally, with
  the case each one gets wrong, and note the chosen approach's own limitations
  too. The point is to inform, not to justify.

## Structure

- Each section should add something the others do not. Do not restate the same
  point in an intro and again in its own section.
- When you add, remove, or rename a page, update everything that lists it in the
  same change: the sidebar in `.vitepress/config.ts`, the overview page
  (`index.md`), and any cross-links from other pages. A page that appears in one
  of those but not the others is a drift bug; check all three before finishing.

## Third-party projects

- Name a specific third-party project (a decoder, feeder, platform, or image) only
  where the reference is required: the decoder-integration pages, and config values
  a reader must type verbatim, such as the accepted `IDENT_UPSTREAM_TYPE` values.
- Everywhere else, describe them generically ("the decoder", "your receiver stack",
  "a feeder"). Do not list product names in prose that does not need them.

## Accuracy

- Check every claim against the code on this branch before you write it. If a
  source finding disagrees with the code, the code wins.
- Do not describe planned or unmerged work as if it ships today. If something is
  a future direction, say so plainly and keep it in its own short section.
- Prefer fewer, correct statements over broad ones you cannot verify.

## Style

Follow the conventions in
[Wikipedia's guide to the signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
and avoid the patterns it lists.

In short:

- No puffery or inflated significance. Do not write that something "stands as a
  testament", "plays a crucial role", "underscores its importance", or "reflects
  a broader" anything.
- No tacked-on interpretation. Avoid trailing "-ing" clauses that editorialize
  ("..., ensuring reliability", "..., highlighting its value").
- Drop the AI-vocabulary words: crucial, pivotal, vibrant, robust, seamless,
  showcase, leverage, underscore, delve, tapestry, realm, landscape (figurative),
  testament, garner, foster, intricate.
- Avoid the "not just X, but Y" and "it is not A, it is B" parallelisms.
- Do not overuse boldface or the rule of three. Use em dashes sparingly, where a
  comma or period would not do.
- Use plain section titles in sentence case. Prefer "is" and "has" over "serves
  as" and "boasts".
- Write concrete, specific sentences. Cut hedging and filler.

When in doubt, write the plainest sentence that is true.
