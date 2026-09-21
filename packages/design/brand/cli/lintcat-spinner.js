#!/usr/bin/env node
// LintCat terminal loaders — look, whiskers, blink. Node 14+, no dependencies.
// usage: node lintcat-spinner.js [line|block] "status text"

const TEAL = '\x1b[38;2;58;166;147m';
const CREAM = '\x1b[38;2;245;239;227m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

// --- one-line unicode face -------------------------------------------------
const LINE_FRAMES = [
  '=(\u25d4 \u25d4)=',
  '-(\u25d4 \u25d4)-',
  '~(\u25d4 \u25d4)~',
  '=(\u25d5 \u25d5)=',
  '-(\u25d5 \u25d5)-',
  '~(\u25d5 \u25d5)~',
  '=(\u203f \u203f)=',
  '=(\u25d4 \u25d4)='
];

// --- five-row block art ----------------------------------------------------
const EYES_LEFT  = '\u2588\u2588 \u2593\u2591 \u2593\u2591 \u2588\u2588';
const EYES_RIGHT = '\u2588\u2588 \u2591\u2593 \u2591\u2593 \u2588\u2588';
const EYES_SHUT  = '\u2588\u2588 \u2584\u2584 \u2584\u2584 \u2588\u2588';
const HEAD = '\u2588'.repeat(11);
const NOSE = '\u2588\u2588\u2588\u2588 \u25ac \u2588\u2588\u2588\u2588';

function blockFrame(i) {
  const eyes = i === 7 ? EYES_SHUT : (i % 8 < 3 ? EYES_LEFT : EYES_RIGHT);
  const leftUp = i % 4 < 2;
  const pad = (on, side) => (on ? (side === 'l' ? '= ' : ' =') : '  ');
  return [
    '   \u2588\u2588     \u2588\u2588   ',
    '  ' + HEAD + '  ',
    pad(leftUp, 'l') + eyes + pad(!leftUp, 'r'),
    pad(!leftUp, 'l') + NOSE + pad(leftUp, 'r'),
    '  ' + HEAD + '  '
  ];
}

function run(mode, status) {
  const interval = 260;
  let i = 0;
  const tty = process.stdout.isTTY;
  if (!tty) { console.log('lintcat: ' + status); return; }
  process.stdout.write(HIDE);

  const tick = () => {
    if (mode === 'block') {
      const rows = blockFrame(i % 8);
      if (i > 0) process.stdout.write('\x1b[6A');
      process.stdout.write(rows.map(r => CREAM + r + RESET + '\x1b[K\n').join(''));
      process.stdout.write(DIM + status + RESET + '\x1b[K\n');
    } else {
      process.stdout.write('\r' + TEAL + LINE_FRAMES[i % LINE_FRAMES.length] + RESET + '  ' + DIM + status + RESET + '\x1b[K');
    }
    i++;
  };

  tick();
  const timer = setInterval(tick, interval);
  const stop = () => { clearInterval(timer); process.stdout.write('\n' + SHOW); process.exit(0); };
  process.on('SIGINT', stop);
  return stop;
}

const mode = process.argv[2] === 'block' ? 'block' : 'line';
const status = process.argv[3] || 'reviewing 412 lines';
run(mode, status);
