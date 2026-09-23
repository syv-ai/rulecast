---
"@syv-ai/rulecast": patch
---

Published through npm trusted publishing.

Releases are now authorised by the release workflow's own OIDC identity rather than by a long-lived npm token, and every published tarball carries a provenance attestation tying it to the workflow run that built it. There is no npm publish token in the repository.
