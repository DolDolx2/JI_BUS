# JI BUS API Gateway (Vercel)

Back-end only. The existing app remains hosted at GitHub Pages; do not change its API calls until the gateway is secured and validated.

## Vercel project

- Project: `ji-bus-api`
- Root Directory: `vercel-api`
- Region: `icn1`
- Framework: Other (no framework)
- Production branch: `main`

## Secrets

Add in Vercel > Project > Settings > Environment Variables (Production):

- `TAGO_API_KEY`: Public Data Portal service key for TAGO
- `KMA_API_KEY`: Public Data Portal service key for KMA VilageFcstInfoService_2.0

**Never commit the secret values** or paste them into chat. Use the API key's correct *decoded* value exactly once; URLSearchParams encodes it for transport.

## Endpoints (after deployment)

- `GET /api/health`: configuration availability only, no secret values
- `GET /api/bus?service=stop&method=getSttnNoList&nodeNm=...`: allowlisted TAGO request
- `GET /api/temperature?lat=36.71&lon=127.43`: KMA ultra-short-term observed temperature `T1H`

## Production launch gate

1. GitHub integration in Vercel must be connected by the account owner.
2. Add secrets in Vercel Environment Variables.
3. Configure Vercel Firewall/WAF rate limiting, usage alerts and upstream API quotas. **CORS is not authorization and does not prevent direct scripted abuse.**
4. Validate server endpoints and KMA API issuance delays/baseTime. Observe errors, cache, and data quality.
5. Update the GitHub Pages frontend in a *separate PR* only after proven back-end readiness.
6. Remove the user's local API key entry only after successful user acceptance testing.

This is a foundation, **not a production-ready public proxy**. The in-process gateway has no durable distributed rate limiter and must not be opened to uncontrolled traffic.
