# Fico — Backend

Node.js + Express + TypeScript API for Fico, Your Daily Financial Companion.
MongoDB (via Mongoose) for persistence; Argon2id password hashing with opaque
httpOnly cookie sessions for authentication.

See the [root README](../README.md) for the project overview and usage terms,
and [`Plan/`](../Plan/) for the product specification, architecture, and
roadmap.

## API surface

| Method | Route                | Auth | Description                    |
| ------ | -------------------- | ---- | ---------------------------- |
| GET    | `/api/health`        | no   | Service health check          |
| POST   | `/api/auth/register` | no   | Create an account and sign in |
| POST   | `/api/auth/login`    | no   | Sign in                       |
| POST   | `/api/auth/logout`   | yes  | Revoke the current session    |
| GET    | `/api/auth/me`       | yes  | Get the current user          |
| PATCH  | `/api/auth/me`       | yes  | Update username / email       |
| DELETE | `/api/auth/me`       | yes  | Disable the account           |

`register` and `login` accept an optional `deviceId` and return
`session: { expiresAt }` alongside `user`; `me` returns the same `session`
object. Sessions are opaque tokens in an httpOnly cookie, hashed at rest, with
sliding renewal past the halfway point of their lifetime.

## Structure

```
src/
├── config/       Database connection
├── controllers/  Request handlers
├── middleware/   Auth, error handling, rate limiting
├── models/       Mongoose schemas (User, Session)
├── routes/       Express routers
├── utils/        Password hashing, session helpers
├── validation/   Zod schemas
├── app.ts        Express app wiring
└── server.ts     Entry point
```
