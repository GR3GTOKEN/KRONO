KRONOS auth rebuild files

Files:
- login.html
- auth.css
- auth-config.js
- auth.js

Integration:
1. Copy these files into the directory from which the existing FastAPI app serves its static HTML/CSS/JS. The paths in login.html currently use root paths (/auth.css, /auth-config.js, /auth.js), so they should be served at the site root.
2. In auth-config.js, replace the two placeholder strings with the EXISTING Supabase project URL and public publishable/anon key. Never use a service_role key in browser code.
3. Set dashboardPath to the real existing dashboard route. The default /dashboard is only a placeholder if your app uses a different path.
4. In Supabase Authentication settings, make sure email/password signup is enabled, email confirmation is enabled as desired, and the email confirmation template contains {{ .Token }} for six-digit OTP. Configure allowed redirect URLs for the actual local and production URLs.
5. Ensure the existing FastAPI static-file serving exposes these files at /login.html, /auth.css, /auth-config.js and /auth.js. Do not open login.html with file://.
6. This is a frontend replacement. Existing protected backend routes must still enforce authentication server-side; browser UI alone does not protect server resources.

Note: Supabase's default email sending can be rate-limited. Do not repeatedly request signup/resend emails during testing.
