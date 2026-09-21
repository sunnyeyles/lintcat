# LintCat loaders

## Animated SVG (drop-in)
svg/lintcat-loader-colour.svg   full colour, navy body / teal accents / orange pupils
svg/lintcat-loader-navy.svg     single colour for light backgrounds
svg/lintcat-loader-cream.svg    single colour for dark backgrounds

100x100 viewBox, CSS animations inline, no external assets. Works as <img src>, CSS
background, or pasted inline. 2.4s loop: gaze left, gaze right, whiskers out of phase,
one-frame blink. Honours prefers-reduced-motion (animation stops, mark stays).

Inline in HTML/React: paste the file contents; the class names are prefixed lc- and
scoped to the four animations, so they will not collide.

loader-demo.html shows all three at 96 / 32 / 16px.

## Terminal
Three drop-in forms, same frames in each:

cli/lintcat-spinner.js  — Node 14+, zero dependencies.
cli/lintcat_spinner.py  — Python 3.7+, stdlib only, importable as a context manager:
                            with LintCat("mapping ./services"): do_work()
cli/lintcat-spinner.sh  — bash wrapper that animates while your command runs:
                            ./lintcat-spinner.sh "reviewing" -- pytest -q

  node cli/lintcat-spinner.js line  "reviewing 412 lines"   # one-line unicode face
  node cli/lintcat-spinner.js block "auditing dependency graph"  # five-row block art

Line mode needs a UTF-8 terminal and one carriage return per frame. Block mode repaints
six lines with a cursor-up escape. Both fall back to a single printed line when stdout
is not a TTY (CI logs).

Frame tables, if you want to port them:
  line:  =(o o)= -(o o)- ~(o o)~ =(o o)= -(o o)- ~(o o)~ =(_ _)= (eyes are U+25D4 / U+25D5 / U+203F)
  block: eye row swaps pupil blocks left/right, blink row uses U+2584; the "=" whisker
         alternates between the eye row and the nose row on each side.

## Lottie
Not included — the loop is pure rectangle transforms, so the SVG covers web and the
frame tables cover terminal. If you need Lottie for a native app, say so and I will
build the JSON to match.
