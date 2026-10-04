---
'@tanstack/intent': patch
---

Print the installed version for `intent --version` and `intent -v`. The CLI had no version flag, so both printed the help text and exited with code 1. They now print the version alone and exit with code 0, and `intent --help` lists the flag.
