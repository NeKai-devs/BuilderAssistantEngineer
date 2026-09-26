# ADR-005: Structured request logging and request IDs

- Status: Accepted
- Date: 2026-09-26

## Context
Other services call this one. When a call fails, the calling team and whoever runs the service need to find that request in the logs. `gin.Logger()`, used in T-002, writes plain text with no request ID.

## Decision
- `log/slog` with `slog.NewJSONHandler(os.Stdout, nil)` is created in `main.go` and passed in as `handler.Deps.Logger`. A nil logger means discard: `slog.New(slog.NewTextHandler(io.Discard, nil))`. Don't use `slog.DiscardHandler`, which needs Go 1.24.
- Middleware order: `requestID` → `requestLogger` → JSON recovery → routes.
- `requestID`:
  - keeps an incoming `X-Request-ID` if it is 1-128 characters from `[A-Za-z0-9._-]`;
  - otherwise generates 16 random bytes with `crypto/rand`, hex-encoded;
  - stores the ID in the gin context under `"request_id"` and sets the response header.
- `requestLogger` writes one line per request: message `http_request`, at INFO, or ERROR for 5xx. Attributes: `method`, `path` (URL path only), `route` (`c.FullPath()`), `status`, `latency_ms`, `request_id`, `client_ip`.
- Recovery: a panic is logged at ERROR with `request_id`, and the client gets `500 {"error":{"code":"internal",...}}`.
- Never log request or response bodies, emails, or query strings.

## Alternatives considered
- **`gin.Logger()`.** Rejected: plain text, no request ID, and not machine-readable.
- **zap or zerolog.** Rejected: an extra dependency, and we don't need their speed. slog is in the standard library.
- **OpenTelemetry traces and metrics.** Deferred: we don't know of a collector, and it is not needed for the first deliverable.

## Consequences
- Log lines can be read by any JSON log pipeline, and calling teams can pass their own IDs through.
- The `route` attribute keeps the number of distinct values low if these logs are ever turned into metrics.
