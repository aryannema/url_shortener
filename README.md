# URL Shortener API

A production-ready REST API for shortening URLs, built with Node.js and PostgreSQL. Users can register, create short links, track every click on their links, and manage their URLs — all behind JWT-based authentication.

**Live API:** https://urlshortener-production-71f0.up.railway.app

**Try it instantly:** Import `url-shortener.postman_collection.json` into Postman — every route is pre-configured with example bodies and the token is saved automatically after login.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [Authentication & Security](#authentication--security)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Testing](#testing)

---

## Tech Stack

| Technology | Role | Why |
|---|---|---|
| **Node.js + Express** | HTTP server & routing | Minimal overhead, wide ecosystem, non-blocking I/O suits a high-throughput redirect service |
| **PostgreSQL** | Primary database | ACID transactions, strong foreign key enforcement, and reliable UUID support |
| **Drizzle ORM** | Database access layer | Type-safe queries written in plain JavaScript — no magic, no hidden N+1 queries, migrations are just SQL files |
| **Zod** | Runtime validation | Validates and parses request bodies at the boundary; separates "is the shape correct" from business logic |
| **jsonwebtoken** | Auth tokens | Industry-standard JWT — stateless, no server-side session storage needed |
| **nanoid** | Short code generation | URL-safe, collision-resistant, smaller output than UUID — perfect for short codes |
| **express-rate-limit** | Abuse prevention | In-memory rate limiting per IP without needing Redis for a single-instance deployment |
| **Vitest + Supertest** | Integration testing | Vitest's native ESM support; Supertest fires real HTTP requests against the live Express app |
| **Docker Compose** | Local database | Reproducible Postgres environment without a local install |

---

## Architecture

```
Client
  │
  ▼
Express App (app.js)
  │
  ├── authenticationMiddleware  ← runs on EVERY request
  │     Reads Authorization header, verifies JWT,
  │     attaches decoded payload to req.user
  │
  ├── /user  (user.routes.js)
  │     POST /user/signup  ← authRateLimit
  │     POST /user/login   ← authRateLimit
  │
  └── /  (url.routes.js)
        POST /shorten         ← ensureAuthenticated, shortenRateLimit
        GET  /codes           ← ensureAuthenticated
        PATCH /:id            ← ensureAuthenticated
        DELETE /:id           ← ensureAuthenticated
        GET  /:id/stats       ← ensureAuthenticated
        GET  /:shortCode      ← public (records click, then redirects)
```

**Two-layer auth design:**

- `authenticationMiddleware` — global, passive. Runs on every request. If a valid token is present it attaches the user to `req.user`; if no token is present it does nothing and doesn't block. This keeps public routes (like `/:shortCode` redirects) accessible without a token while still making `req.user` available if one happens to be sent.
- `ensureAuthenticated` — active guard placed on individual protected routes. Checks that `req.user` was populated by the global middleware and returns 401 if not. This separation means route handlers never need to think about token parsing — they just trust `req.user`.

---

## Database Schema

Three tables with a clear ownership chain: users own URLs, URLs own clicks.

```
users
  id          UUID          PK  defaultRandom()
  first_name  VARCHAR(55)   NOT NULL
  last_name   VARCHAR(55)
  email       VARCHAR(255)  NOT NULL  UNIQUE
  password    TEXT          NOT NULL  (HMAC-SHA256 hash — never the plaintext)
  salt        TEXT          NOT NULL  (random 256-byte hex, unique per user)
  created_at  TIMESTAMP     NOT NULL  defaultNow()
  updated_at  TIMESTAMP               ($onUpdate hook)

urls
  id          UUID          PK  defaultRandom()
  code        VARCHAR(155)  NOT NULL  UNIQUE  (the short code, e.g. "abc123")
  target_url  TEXT          NOT NULL          (the destination)
  user_id     UUID          NOT NULL  FK → users.id
  created_at  TIMESTAMP     NOT NULL  defaultNow()
  updated_at  TIMESTAMP               ($onUpdate hook)

clicks
  id          UUID          PK  defaultRandom()
  url_id      UUID          NOT NULL  FK → urls.id  ON DELETE CASCADE
  user_agent  TEXT
  ip_address  VARCHAR(45)             (supports both IPv4 and IPv6)
  clicked_at  TIMESTAMP     NOT NULL  defaultNow()
```

**Key decisions:**

- `ON DELETE CASCADE` on `clicks.url_id` — deleting a URL automatically removes all its click history. No orphaned rows, no manual cleanup needed.
- `updatedAt` uses Drizzle's `$onUpdate(() => new Date())` hook — the timestamp is set automatically on every update without any application-level code.
- `ip_address` is `VARCHAR(45)` — the maximum length of an IPv6 address is 39 characters, but 45 leaves room for IPv4-mapped IPv6 notation (`::ffff:255.255.255.255`).
- Passwords are never stored. Only the HMAC-SHA256 hash and the random salt are persisted.

---

## Authentication & Security

### Password Hashing

Passwords are hashed using **HMAC-SHA256** with a per-user random salt, via Node's built-in `crypto` module — zero external dependencies for this critical path.

**On signup:**
```
salt        = randomBytes(256).toString("hex")   ← 512-char hex string, unique per user
hash        = HMAC-SHA256(password, salt)
stored      = { salt, hash }                     ← plaintext password is immediately discarded
```

**On login:**
```
salt        = fetched from DB for this user's email
hash        = HMAC-SHA256(input_password, salt)
authorized? = hash === stored_hash
```

The per-user salt makes precomputed rainbow table attacks impossible — two users with the same password produce completely different hashes. If the database is ever leaked, an attacker must brute-force each user's hash individually.

### JWT Sessions

After a successful login the server creates a signed JWT:

```
payload  = { id: user.id }
token    = jwt.sign(payload, JWT_SECRET)
```

The client stores this token and sends it on every subsequent request:
```
Authorization: Bearer <token>
```

The server verifies the signature against `JWT_SECRET`. If valid, the payload is trusted and `req.user` is set. The database is never consulted during authentication — the JWT is self-contained proof of identity, which keeps latency low on every request.

**JWT structure:**
```
eyJhbGciOiJIUzI1NiJ9   ← Header (algorithm)
.eyJpZCI6IjEyMyJ9      ← Payload (base64, NOT encrypted — don't store secrets here)
.SflKxwRJSMeKKF2QT4   ← Signature (HMAC of header + payload using JWT_SECRET)
```

Anyone can decode the header and payload. The signature is what makes it tamper-proof — changing the payload invalidates the signature, and without `JWT_SECRET` a valid new signature cannot be forged.

### Ownership Enforcement

Every mutating operation (`PATCH`, `DELETE`, stats) filters by **both** `id` AND `userId`:

```js
.where(and(eq(urlsTable.id, req.params.id), eq(urlsTable.userId, req.user.id)))
```

A logged-in user cannot update, delete, or read stats for URLs they don't own — even if they know or guess the UUID. The query simply returns no rows, and the route returns 404 (not 403, which would confirm the resource exists).

### Rate Limiting

Two limiters protect against brute-force attacks and spam:

| Limiter | Applied to | Limit | Why |
|---|---|---|---|
| `authRateLimit` | `POST /user/signup`, `POST /user/login` | 10 req / 15 min per IP | Prevents credential stuffing and account enumeration via repeated login attempts |
| `shortenRateLimit` | `POST /shorten` | 20 req / min per IP | Prevents spam URL creation |

Responses include standard `RateLimit-*` headers (RFC draft-8) so API clients can implement backoff without trial and error.

Both limiters use the `skip` option to bypass themselves when `NODE_ENV === "test"`, ensuring the test suite isn't blocked by its own rapid requests.

---

## Project Structure

```
.
├── app.js                        # Express app setup — no server.listen here
├── index.js                      # Entrypoint — imports app, calls listen
├── drizzle.config.js             # Drizzle Kit configuration (migrations, studio)
├── vitest.config.js              # Test runner configuration
├── docker-compose.yml            # Local Postgres instance
│
├── db/
│   └── index.js                  # Drizzle client — single shared instance
│
├── models/
│   ├── user.model.js             # users table schema
│   ├── url.model.js              # urls table schema
│   ├── click.model.js            # clicks table schema
│   └── index.js                  # Re-exports all models (required by drizzle.config.js)
│
├── routes/
│   ├── user.routes.js            # POST /user/signup, POST /user/login
│   └── url.routes.js             # All URL endpoints
│
├── middlewares/
│   ├── auth.middleware.js        # authenticationMiddleware + ensureAuthenticated
│   └── rate-limit.middleware.js  # authRateLimit + shortenRateLimit
│
├── services/
│   └── user.service.js           # getUserByEmail — DB query isolated from route logic
│
├── utils/
│   ├── hash.js                   # hashPasswordWithSalt
│   └── token.js                  # createUserToken + validateUserToken
│
├── validation/
│   ├── request.validation.js     # Zod schemas for all request bodies
│   └── token.validation.js       # Zod schema for JWT payload shape
│
└── tests/
    ├── auth.test.js              # Integration tests: signup & login flows
    ├── url.test.js               # Integration tests: all URL endpoints
    ├── helpers.js                # Shared test helpers: createUserAndLogin, createShortURL
    └── setup.js                  # cleanDB — truncates all tables between tests
```

**Why `app.js` and `index.js` are separate:**
`app.js` exports the configured Express app without calling `app.listen`. `index.js` imports it and starts the server. This pattern lets the test suite import the app and issue HTTP requests via Supertest without binding to a real port or needing to manage server lifecycle in tests.

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- Docker (for the local database)

### 1. Clone and install

```bash
git clone <repo-url>
cd url_shorten
pnpm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
DATABASE_URL=postgres://postgres:admin@localhost:5432/postgres
JWT_SECRET=replace_this_with_a_long_random_string
PORT=8000

POSTGRES_USER=postgres
POSTGRES_PASSWORD=admin
POSTGRES_DB=postgres
```

### 3. Start the database

```bash
docker compose up -d
```

### 4. Push the schema

This creates all three tables in the database. Run this after any schema change too.

```bash
pnpm db:push
```

### 5. Start the server

```bash
pnpm dev       # development — restarts on file change (node --watch)
pnpm start     # production
```

Server starts at `http://localhost:8000`.

---

## Environment Variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgres://postgres:admin@localhost:5432/postgres` |
| `JWT_SECRET` | Yes | Secret for signing JWTs. Use a long random string in production. | `a8f3d...long...string` |
| `PORT` | No | HTTP port (defaults to 8000) | `8000` |
| `POSTGRES_USER` | Yes* | Postgres user — read by Docker Compose | `postgres` |
| `POSTGRES_PASSWORD` | Yes* | Postgres password — read by Docker Compose | `admin` |
| `POSTGRES_DB` | Yes* | Postgres database name — read by Docker Compose | `postgres` |

*Required only when using the provided `docker-compose.yml`.

> **Security:** Never commit `.env` to version control. Add it to `.gitignore`.

---

## API Reference

**Base URL:** `http://localhost:8000`

All request and response bodies use `Content-Type: application/json`.

Protected routes require the header:
```
Authorization: Bearer <token>
```

---

### Auth

#### `POST /user/signup`

Creates a new user account.

**Rate limit:** 10 requests / 15 minutes per IP.

**Request body:**

```json
{
  "firstName": "Aryan",
  "lastName": "Nema",
  "email": "aryan@example.com",
  "password": "supersecret"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `firstName` | string | Yes | — |
| `lastName` | string | No | — |
| `email` | string | Yes | Valid email format, must be unique |
| `password` | string | Yes | Minimum 3 characters |

**Response `201 Created`:**

```json
{
  "data": {
    "userId": "b3d2a1c0-1234-5678-abcd-ef0123456789"
  }
}
```

**Errors:**

| Status | Condition |
|---|---|
| `400` | Validation failed (missing fields, invalid email) |
| `400` | `"User with email already exists"` |
| `429` | Rate limit exceeded |

---

#### `POST /user/login`

Authenticates a user and returns a JWT.

**Rate limit:** 10 requests / 15 minutes per IP (shared counter with `/user/signup`).

**Request body:**

```json
{
  "email": "aryan@example.com",
  "password": "supersecret"
}
```

**Response `200 OK`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImIzZDJhMWMwIn0.abc123"
}
```

Store this token and pass it as `Authorization: Bearer <token>` on all subsequent requests to protected endpoints.

**Errors:**

| Status | Condition |
|---|---|
| `400` | Validation failed |
| `400` | `"Invalid password"` |
| `404` | No account with that email |
| `429` | Rate limit exceeded |

---

### URLs

#### `POST /shorten`

Creates a new short URL.

**Auth:** Required  
**Rate limit:** 20 requests / minute per IP.

**Request body:**

```json
{
  "url": "https://some-very-long-website.com/with/a/deep/path?and=query&params=too",
  "code": "mylink"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | Yes | Must be a valid URL including the protocol (`https://`) |
| `code` | string | No | Custom short code. If omitted, a random 6-character code is generated by `nanoid` |

**Response `201 Created`:**

```json
{
  "id": "a1b2c3d4-0000-1111-2222-333344445555",
  "shortCode": "mylink",
  "targetURL": "https://some-very-long-website.com/with/a/deep/path?and=query&params=too"
}
```

Save the `id` — it's required for update, delete, and stats endpoints.

**Errors:**

| Status | Condition |
|---|---|
| `400` | Invalid URL format |
| `401` | Not authenticated |
| `429` | Rate limit exceeded |

---

#### `GET /codes`

Returns all short URLs belonging to the authenticated user.

**Auth:** Required

**Response `200 OK`:**

```json
{
  "codes": [
    {
      "id": "a1b2c3d4-...",
      "code": "mylink",
      "target_url": "https://example.com",
      "user_id": "b3d2a1c0-...",
      "created_at": "2026-06-13T07:00:00.000Z",
      "updated_at": null
    }
  ]
}
```

**Errors:**

| Status | Condition |
|---|---|
| `401` | Not authenticated |

---

#### `PATCH /:id`

Updates an existing short URL. Only the owner can update it. At least one of `url` or `code` must be provided.

**Auth:** Required

**URL parameter:** `id` — the UUID returned by `POST /shorten`.

**Request body:**

```json
{
  "url": "https://new-destination.com",
  "code": "newcode"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | No* | New destination URL |
| `code` | string | No* | New short code |

\* At least one field must be present.

**Response `200 OK`:**

```json
{
  "id": "a1b2c3d4-...",
  "shortCode": "newcode",
  "targetURL": "https://new-destination.com"
}
```

**Errors:**

| Status | Condition |
|---|---|
| `400` | Neither `url` nor `code` was provided |
| `400` | Invalid URL format |
| `401` | Not authenticated |
| `404` | URL not found, or belongs to a different user |

---

#### `DELETE /:id`

Deletes a short URL. Only the owner can delete it. All associated click records are removed automatically via `ON DELETE CASCADE`.

**Auth:** Required

**URL parameter:** `id` — the UUID of the URL.

**Response `200 OK`:**

```json
{
  "deleted": true
}
```

**Errors:**

| Status | Condition |
|---|---|
| `401` | Not authenticated |

---

#### `GET /:id/stats`

Returns click analytics for a specific URL. Only the owner can access this.

**Auth:** Required

**URL parameter:** `id` — the UUID of the URL.

**Response `200 OK`:**

```json
{
  "totalClicks": 42,
  "clicks": [
    {
      "clickedAt": "2026-06-13T08:30:00.000Z",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "ipAddress": "203.0.113.42"
    },
    {
      "clickedAt": "2026-06-13T09:15:00.000Z",
      "userAgent": "curl/7.88.1",
      "ipAddress": "198.51.100.5"
    }
  ]
}
```

A click record is created on every visit to `GET /:shortCode`, capturing the visitor's user agent and IP address.

**Errors:**

| Status | Condition |
|---|---|
| `401` | Not authenticated |
| `404` | URL not found, or belongs to a different user |

---

#### `GET /:shortCode`

Redirects the visitor to the original URL. This is the only public endpoint — no authentication required.

Every request records a click entry (timestamp, user agent, IP) before issuing the redirect.

**URL parameter:** `shortCode` — the short code (e.g. `mylink`).

**Response `302 Found`:**

```
Location: https://original-destination.com
```

**Errors:**

| Status | Condition |
|---|---|
| `404` | Short code does not exist |

---

## Testing

The test suite uses **Vitest** as the runner and **Supertest** to issue real HTTP requests against the Express app. Tests hit a live PostgreSQL database — no mocking — which means they catch issues that mock-based tests miss: schema mismatches, FK constraint violations, and query correctness.

### Run tests

```bash
# Make sure the database is running first
docker compose up -d

pnpm test          # single run
pnpm test:watch    # re-run on file change
```

### Test isolation

Each test calls `cleanDB()` in `beforeEach`, which truncates the `clicks`, `urls`, and `users` tables in the correct dependency order (clicks first, then urls, then users — respecting FK constraints). Every test starts from an empty database.

Test files run **sequentially** (`fileParallelism: false` in `vitest.config.js`). Running files in parallel caused race conditions where one file's `cleanDB` deleted rows another file's test had just created mid-operation.

Rate limiting is disabled in the test environment via the `skip` option, which returns `true` when `NODE_ENV === "test"`. The real limits still apply in production.

### Coverage

| Area | Tests | What's verified |
|---|---|---|
| Signup | 3 | Creates account, rejects duplicates, rejects missing fields |
| Login | 3 | Returns JWT, rejects wrong password, rejects unknown email |
| Shorten | 3 | Creates URL, respects custom code, blocks unauthenticated requests |
| List URLs | 1 | Returns only the requesting user's URLs, not others' |
| Update URL | 3 | Updates successfully, blocks wrong owner (returns 404), rejects empty body |
| Delete URL | 2 | Deletes for owner, does not affect another user's URL |
| Redirect | 2 | 302 to correct destination, 404 for unknown code |
| Stats | 2 | Click count increments on redirect, blocks access for wrong owner |
