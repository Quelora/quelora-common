# quelora-common

**Shared internal library for the [Quelora](https://github.com/Quelora) platform.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

`@quelora/common` is the foundation package consumed by every Quelora backend
service. It has no process of its own — it provides the shared building blocks.

## What's inside

| Layer | Contents |
|-------|----------|
| **Models** | 30 Mongoose schemas — `Profile`, `Post`, `Comment`, `Client`, `Activity`, reputation, stats, relations |
| **Services** | 27 business-logic services — auth, cache, client config, email, push, reputation, moderation, toxicity, geo, i18n, SSO |
| **Middlewares** | 11 Express middlewares — auth, rate limiting, captcha, geo extraction, cache invalidation, error handling |
| **Utilities** | Encryption (`cipher.js`, AES-256-CBC), password validation, plugin registry, feature loader |
| **Providers** | Pluggable adapters — LLM moderation (OpenAI, Gemini, Grok, DeepSeek), toxicity (Perspective, Detoxify), SSO (Google, Facebook, Apple, X) |
| **Infrastructure** | MongoDB connection singleton, Redis cache, BullMQ queue factory |

## Consumers

`quelora-public-api` · `quelora-dashboard-api` · `quelora-worker` · `quelora-jobs`

## Usage

This package is not published standalone; it is resolved as a workspace
dependency. Import modules by path:

```js
const Profile = require('@quelora/common/models/Profile');
const authService = require('@quelora/common/services/authService');
const { connectDB } = require('@quelora/common/db');
```

## Requirements

- Node.js 20+
- MongoDB 4.4+
- Redis 6+

## License

[AGPL-3.0-only](./LICENSE) — Copyright (C) 2026 Germán Zelaya.

Part of the **[Quelora](https://github.com/Quelora)** project.
