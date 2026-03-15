---
'@tanstack/intent': patch
---

Replace bin.intent detection with tanstack-intent keyword check for package discovery. Remove the `add-library-bin` command and bin shim generation system — packages are now identified by having `"tanstack-intent"` in their keywords array, which was already required for registry discovery. Also fix `collectPackagingWarnings` to skip the `!skills/_artifacts` warning for monorepo packages.
