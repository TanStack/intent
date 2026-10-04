---
'@tanstack/intent': patch
---

Start each command faster. The command-line parser processed the arguments one time for each registered command; Intent now gives it only the command being run. A call saves between 0.1 and 0.2 ms.
