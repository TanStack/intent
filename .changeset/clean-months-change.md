---
'@tanstack/intent': patch
---

Improve the maintainer skill-authoring workflow:

    - Add `validate --set-version <version>`, which stamps `metadata.library_version` across matched skills via YAML surgery (preserving comments, line endings, and body) and then re-validates.
    - Correct the `generate-skill` meta-skill so it no longer emits slash-path `name` values that fail validation, and the `skill-staleness-check` meta-skill so it points at the real `intent stale` command instead of a non-existent script.
