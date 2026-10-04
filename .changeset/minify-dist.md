---
'@tanstack/intent': patch
---

Minify the published build. The `dist` directory shrinks from 729 kB to 437 kB (40% smaller), and commands behave and print the same as before. Function and class names are kept, so a stack trace from installed code still names each function, but its positions now point into minified lines. The hook script that `intent hooks install` writes does not change.
