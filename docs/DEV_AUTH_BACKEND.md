# Development Auth Backend

This server exists only so the Viral AI Tool desktop app can test the real account/session flow before a production backend is deployed.

It is **not** a production server and is intentionally excluded from the Electron build files.

## Start the development backend

Open terminal 1:

```powershell
cd C:\Users\haiho\Desktop\Viral_AI_Tool
npm run dev:backend
```

The server binds only to:

```text
127.0.0.1:3000
```

It does not listen on the public network.

Development account:

```text
Email:    demo@viral-ai.local
Password: ViralAI123!
```

## Start the desktop app

Open terminal 2:

```powershell
cd C:\Users\haiho\Desktop\Viral_AI_Tool
npm start
```

In the app:

1. Open **Cài đặt**.
2. Find **Nhà phát triển → Kết nối Viral AI Cloud**.
3. Choose **Development — máy chủ thử nghiệm**.
4. Set Backend URL to `http://127.0.0.1:3000`.
5. Save.
6. Test the connection.
7. Open **Video AI**.
8. Choose **Cloud**.
9. Choose **Đăng nhập**.
10. Use the development account above.

Expected result after login:

- account identity is visible;
- plan is `Creator Pro`;
- Cloud allowance is 500 AI minutes;
- authentication/session refresh works;
- Speech Cloud remains marked as not configured because this development backend intentionally has no third-party speech provider.

## Security behavior being tested

- password is never persisted by the desktop renderer;
- access and refresh tokens are stored via Electron `safeStorage`;
- renderer never receives token values;
- access tokens expire after 15 minutes in the dev server;
- refresh tokens are rotated;
- logout revokes the active access and refresh session;
- changing the configured backend clears the previous local session;
- the app attempts to revoke the old remote session before switching endpoints;
- login attempts are rate-limited;
- the dev backend binds to loopback only.

## What this backend deliberately does not implement

- production database;
- email verification;
- password reset;
- MFA;
- subscription payments;
- production billing ledger;
- third-party Speech AI;
- horizontal scaling;
- persistent sessions across server restarts.

These belong to the production backend milestone and must not be simulated as complete.
