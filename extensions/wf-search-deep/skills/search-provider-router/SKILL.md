---
name: search-provider-router
description: Select healthy search providers from the extension catalog without embedding credentials or backend addresses.
---

# Search provider router

Read `search-providers.json`, classify providers as configured, credential-
required, user-hosted, or probe-required, and choose the strongest available
combination for the question. Hosted API keys and self-hosted endpoints come
from the user's environment; the skill never writes their values into the
extension or project.
