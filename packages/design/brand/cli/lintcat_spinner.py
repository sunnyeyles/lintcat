#!/usr/bin/env python3
"""LintCat terminal loaders - look, whiskers, blink. Stdlib only, Python 3.7+.

    python3 lintcat_spinner.py line  "reviewing 412 lines"
    python3 lintcat_spinner.py block "auditing dependency graph"

Or as a context manager in your own tool:

    from lintcat_spinner import LintCat
    with LintCat("mapping ./services", mode="line"):
        do_work()
"""
import sys
import time
import threading

TEAL = "\x1b[38;2;58;166;147m"
CREAM = "\x1b[38;2;245;239;227m"
DIM = "\x1b[2m"
RESET = "\x1b[0m"
HIDE = "\x1b[?25l"
SHOW = "\x1b[?25h"

LINE_FRAMES = [
    "=(\u25d4 \u25d4)=",
    "-(\u25d4 \u25d4)-",
    "~(\u25d4 \u25d4)~",
    "=(\u25d5 \u25d5)=",
    "-(\u25d5 \u25d5)-",
    "~(\u25d5 \u25d5)~",
    "=(\u203f \u203f)=",
    "=(\u25d4 \u25d4)=",
]

EYES_LEFT = "\u2588\u2588 \u2593\u2591 \u2593\u2591 \u2588\u2588"
EYES_RIGHT = "\u2588\u2588 \u2591\u2593 \u2591\u2593 \u2588\u2588"
EYES_SHUT = "\u2588\u2588 \u2584\u2584 \u2584\u2584 \u2588\u2588"
HEAD = "\u2588" * 11
NOSE = "\u2588\u2588\u2588\u2588 \u25ac \u2588\u2588\u2588\u2588"


def block_frame(i):
    eyes = EYES_SHUT if i % 8 == 7 else (EYES_LEFT if i % 8 < 3 else EYES_RIGHT)
    left_up = i % 4 < 2

    def pad(on, side):
        return ("= " if side == "l" else " =") if on else "  "

    return [
        "   \u2588\u2588     \u2588\u2588   ",
        "  " + HEAD + "  ",
        pad(left_up, "l") + eyes + pad(not left_up, "r"),
        pad(not left_up, "l") + NOSE + pad(left_up, "r"),
        "  " + HEAD + "  ",
    ]


class LintCat:
    def __init__(self, status="working", mode="line", interval=0.26, stream=sys.stdout):
        self.status = status
        self.mode = mode
        self.interval = interval
        self.stream = stream
        self._stop = threading.Event()
        self._thread = None

    def _loop(self):
        i = 0
        while not self._stop.is_set():
            if self.mode == "block":
                rows = block_frame(i)
                if i:
                    self.stream.write("\x1b[6A")
                for row in rows:
                    self.stream.write(CREAM + row + RESET + "\x1b[K\n")
                self.stream.write(DIM + self.status + RESET + "\x1b[K\n")
            else:
                frame = LINE_FRAMES[i % len(LINE_FRAMES)]
                self.stream.write("\r" + TEAL + frame + RESET + "  " + DIM + self.status + RESET + "\x1b[K")
            self.stream.flush()
            i += 1
            self._stop.wait(self.interval)

    def __enter__(self):
        if not self.stream.isatty():
            self.stream.write("lintcat: %s\n" % self.status)
            return self
        self.stream.write(HIDE)
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc):
        if self._thread:
            self._stop.set()
            self._thread.join()
            self.stream.write("\n" + SHOW)
            self.stream.flush()
        return False


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "line"
    status = sys.argv[2] if len(sys.argv) > 2 else "reviewing 412 lines"
    try:
        with LintCat(status, mode=mode):
            while True:
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
