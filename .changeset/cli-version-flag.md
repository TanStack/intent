---
'@tanstack/intent': patch
---

Print the installed version for `intent --version`. The CLI had no version flag, so it printed the help text and exited with code 1. It now prints the version alone and exits with code 0.
