/* KRONOS authentication. Uses the public Supabase browser key only.
   Configure window.KRONOS_AUTH_CONFIG in auth-config.js before this script. */
(() => {
  "use strict";
  const cfg = window.KRONOS_AUTH_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const views = { auth: $("#auth-view"), otp: $("#otp-view"), recovery: $("#recovery-view") };
  const state = { mode: "signin", pendingEmail: "", pendingName: "", resendUntil: 0, timer: null, recoveryMode: "request" };
  $("#year").textContent = new Date().getFullYear();

  let supabase = null;
  const missingConfig = !cfg.url || !cfg.anonKey || !window.supabase?.createClient;
  if (!missingConfig) {
    try { supabase = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); }
    catch (e) { console.error("KRONOS Supabase initialization failed", e); }
  }

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => el.hidden = key !== name);
    hideMessages();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function message(id, text, kind = "error") {
    const el = $(id); el.textContent = text; el.className = "message" + (kind === "success" ? " success" : kind === "info" ? " info" : ""); el.hidden = !text;
  }
  function hideMessages() { $$(".message").forEach(el => { el.hidden = true; el.textContent = ""; }); }
  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    if (label) { const span = button.querySelector("span"); if (span) span.textContent = label; }
  }
  function friendlyError(error) {
    const raw = String(error?.message || error || "Something went wrong.");
    if (/rate limit|email rate|too many requests/i.test(raw)) return "Too many email requests were made. Please wait before trying again.";
    if (/invalid login credentials/i.test(raw)) return "That email and password combination wasn't recognized.";
    if (/email not confirmed/i.test(raw)) return "Please verify your email before signing in. Request a new confirmation code if needed.";
    if (/invalid.*(otp|token)|token.*(invalid|expired)|otp.*expired/i.test(raw)) return "That code is invalid or expired. Check your email or request a new code.";
    if (/password.*(least|short|characters)/i.test(raw)) return "Choose a stronger password that meets the password requirements.";
    if (/fetch|network|failed to connect/i.test(raw)) return "Couldn't connect to authentication. Check your internet connection and try again.";
    return raw;
  }
  function requireClient() {
    if (!supabase) throw new Error("Supabase is not configured. Add your existing project URL and publishable/anon key in auth-config.js.");
    return supabase;
  }
  function switchMode(mode) {
    state.mode = mode;
    $("#tab-signin").classList.toggle("active", mode === "signin");
    $("#tab-signup").classList.toggle("active", mode === "signup");
    $("#tab-signin").setAttribute("aria-selected", String(mode === "signin"));
    $("#tab-signup").setAttribute("aria-selected", String(mode === "signup"));
    const signup = mode === "signup";
    $("#name-field").hidden = !signup;
    $("#confirm-field").hidden = !signup;
    $("#terms-row").hidden = !signup;
    $("#strength").hidden = !signup;
    $("#forgot-link").hidden = signup;
    $("#full-name").required = signup;
    $("#confirm-password").required = signup;
    $("#heading-title").innerHTML = signup ? "Create account<span>.</span>" : "Sign in<span>.</span>";
    $("#step-label").textContent = signup ? "START YOUR KRONOS JOURNEY" : "WELCOME BACK";
    $("#heading-subtitle").textContent = signup ? "Create your account to enter the KRONOS platform." : "Pick up where your market research left off.";
    $("#password").autocomplete = signup ? "new-password" : "current-password";
    $("#submit-label").textContent = signup ? "Create account" : "Sign in";
    $("#switch-copy").innerHTML = signup ? 'Already have an account? <button class="inline-button" type="button" data-mode="signin">Sign in</button>' : 'New to KRONOS? <button class="inline-button" type="button" data-mode="signup">Create an account</button>';
    hideMessages();
    $("#auth-form").reset();
    $("#password").type = "password"; $("#confirm-password").type = "password";
  }
  document.addEventListener("click", e => {
    const modeButton = e.target.closest("[data-mode]");
    if (modeButton) { switchMode(modeButton.dataset.mode); showView("auth"); }
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const input = $("#" + toggle.dataset.toggle);
      input.type = input.type === "password" ? "text" : "password";
      toggle.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
    }
    if (e.target.closest('[data-action="back-auth"]')) { showView("auth"); switchMode("signin"); }
  });

  function passwordScore(value) {
    let score = 0;
    if (value.length >= 8) score++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    return score;
  }
  $("#password").addEventListener("input", e => {
    if (state.mode !== "signup") return;
    const score = passwordScore(e.target.value);
    const width = ["0%","25%","50%","75%","100%"][score];
    $(".strength-track i").style.width = width;
    $("#strength-text").textContent = !e.target.value ? "Password strength" : ["Too weak","Weak","Fair","Good","Strong"][score];
  });
  function clearErrors() { $$(".field-error").forEach(el => el.textContent = ""); }
  function validateEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

  $("#auth-form").addEventListener("submit", async e => {
    e.preventDefault(); hideMessages(); clearErrors();
    const button = $("#submit-button");
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    const name = $("#full-name").value.trim();
    const confirm = $("#confirm-password").value;
    if (!validateEmail(email)) { $("#email-error").textContent = "Enter a valid email address."; return; }
    if (!password) { $("#password-error").textContent = "Enter your password."; return; }
    if (state.mode === "signup") {
      if (!name) { $("#name-error").textContent = "Enter your full name."; return; }
      if (password.length < 8) { $("#password-error").textContent = "Use at least 8 characters."; return; }
      if (password !== confirm) { $("#confirm-error").textContent = "Your passwords do not match."; return; }
      if (!$("#terms").checked) { message("#auth-message", "Please accept the Terms and Privacy Policy to continue."); return; }
    }
    setBusy(button, true, state.mode === "signup" ? "Creating account..." : "Signing in...");
    try {
      const client = requireClient();
      if (state.mode === "signup") {
        const redirect = new URL("/login.html", location.origin).href;
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { emailRedirectTo: redirect, data: { full_name: name, name } }
        });
        if (error) throw error;
        if (data.session && data.user) {
          // Supabase may return a session immediately when email confirmation is disabled.
          location.assign(cfg.dashboardPath || "/dashboard");
          return;
        }
        if (data.user && !data.session) {
          state.pendingEmail = email; state.pendingName = name;
          $("#otp-email").textContent = email;
          $$(".otp-digit").forEach(input => input.value = "");
          showView("otp"); $("#otp-1").focus(); startResendCooldown(30);
          message("#otp-message", "Your account was created. Enter the six-digit code from your email.", "info");
          return;
        }
        throw new Error("Supabase did not return a user. Check your project configuration and try again.");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error("Sign-in did not establish a session. Please try again.");
        location.assign(cfg.dashboardPath || "/dashboard");
      }
    } catch (error) { message("#auth-message", friendlyError(error)); }
    finally { setBusy(button, false, state.mode === "signup" ? "Create account" : "Sign in"); }
  });

  const otpInputs = $$(".otp-digit");
  otpInputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && i < otpInputs.length - 1) otpInputs[i + 1].focus();
      $("#otp-error").textContent = "";
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !input.value && i > 0) { otpInputs[i - 1].focus(); }
      if (e.key === "ArrowLeft" && i > 0) otpInputs[i - 1].focus();
      if (e.key === "ArrowRight" && i < otpInputs.length - 1) otpInputs[i + 1].focus();
    });
    input.addEventListener("paste", e => {
      const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      if (digits.length) {
        e.preventDefault();
        otpInputs.forEach((el, idx) => el.value = digits[idx] || "");
        otpInputs[Math.min(digits.length, 5)].focus();
      }
    });
  });
  function startResendCooldown(seconds) {
    state.resendUntil = Date.now() + seconds * 1000;
    clearInterval(state.timer);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((state.resendUntil - Date.now()) / 1000));
      $("#resend-button").disabled = remaining > 0;
      $("#resend-button").style.opacity = remaining > 0 ? ".5" : "1";
      $("#resend-timer").textContent = remaining ? `You can request another code in ${remaining}s.` : "";
      if (!remaining) clearInterval(state.timer);
    };
    tick(); state.timer = setInterval(tick, 1000);
  }
  $("#otp-form").addEventListener("submit", async e => {
    e.preventDefault(); $("#otp-error").textContent = ""; message("#otp-message", "");
    const token = otpInputs.map(i => i.value).join("");
    if (token.length !== 6) { $("#otp-error").textContent = "Enter all six digits."; return; }
    const button = $("#verify-button"); setBusy(button, true);
    try {
      const client = requireClient();
      const { data, error } = await client.auth.verifyOtp({ email: state.pendingEmail, token, type: "signup" });
      if (error) throw error;
      if (!data.session || !data.user) throw new Error("Email verified, but no session was returned. Try signing in with your email and password.");
      location.assign(cfg.dashboardPath || "/dashboard");
    } catch (error) { message("#otp-message", friendlyError(error)); }
    finally { setBusy(button, false); }
  });
  $("#resend-button").addEventListener("click", async () => {
    if (Date.now() < state.resendUntil) return;
    const button = $("#resend-button"); button.disabled = true;
    try {
      const client = requireClient();
      const { error } = await client.auth.resend({ type: "signup", email: state.pendingEmail, options: { emailRedirectTo: new URL("/login.html", location.origin).href } });
      if (error) throw error;
      startResendCooldown(60); message("#otp-message", "If this address can receive a confirmation code, a new email has been requested.", "success");
    } catch (error) { message("#otp-message", friendlyError(error)); startResendCooldown(30); }
  });

  $("#forgot-link").addEventListener("click", () => {
    $("#recovery-step").textContent = "ACCOUNT RECOVERY";
    $("#recovery-title").innerHTML = "Reset password<span>.</span>";
    $("#recovery-subtitle").textContent = "Enter your email and we'll send you a secure recovery link.";
    $("#recovery-email-field").hidden = false; $("#new-password-field").hidden = true; $("#new-confirm-field").hidden = true;
    $("#recovery-button-label").textContent = "Send recovery link"; state.recoveryMode = "request";
    $("#recovery-form").reset(); showView("recovery");
  });
  $("#recovery-form").addEventListener("submit", async e => {
    e.preventDefault(); message("#recovery-message", "");
    const button = $("#recovery-button"); setBusy(button, true);
    try {
      const client = requireClient();
      if (state.recoveryMode === "request") {
        const email = $("#recovery-email").value.trim().toLowerCase();
        if (!validateEmail(email)) throw new Error("Enter a valid email address.");
        const redirectTo = new URL("/login.html?flow=recovery", location.origin).href;
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        message("#recovery-message", "If an account exists for that address, a password-reset email has been requested. Open the link in that email to continue.", "success");
      } else {
        const password = $("#new-password").value;
        if (password.length < 8) throw new Error("Use at least 8 characters for your new password.");
        if (password !== $("#new-confirm").value) throw new Error("Your new passwords do not match.");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        message("#recovery-message", "Your password has been updated. You can now sign in with your new password.", "success");
        $("#recovery-button-label").textContent = "Password updated";
        setTimeout(() => { showView("auth"); switchMode("signin"); }, 1600);
      }
    } catch (error) { message("#recovery-message", friendlyError(error)); }
    finally { setBusy(button, false); }
  });

  function handleRecoveryUrl() {
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const recovery = params.get("flow") === "recovery" || hash.get("type") === "recovery";
    if (!recovery) return;
    state.recoveryMode = "update";
    $("#recovery-step").textContent = "SECURE YOUR ACCOUNT";
    $("#recovery-title").innerHTML = "Choose a new<br>password<span>.</span>";
    $("#recovery-subtitle").textContent = "Set a new password for your KRONOS account.";
    $("#recovery-email-field").hidden = true; $("#new-password-field").hidden = false; $("#new-confirm-field").hidden = false;
    $("#recovery-button-label").textContent = "Update password";
    showView("recovery");
    // Supabase JS detects recovery tokens in the URL and establishes the recovery session.
  }
  handleRecoveryUrl();

  // Friendly diagnostic rather than silently pretending authentication is configured.
  if (missingConfig || !supabase) {
    message("#auth-message", "Supabase is not configured yet. Add your existing project URL and publishable/anon key to auth-config.js, then reload this page.");
  }

  // Optional session restoration: redirect only when a real session exists.
  if (supabase && !location.search.includes("flow=recovery")) {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session && !location.hash.includes("type=recovery")) {
        // Do not redirect away from OTP/recovery views; only restore ordinary auth entry.
        if (!state.pendingEmail && !location.search.includes("flow=recovery")) {
          // Existing session is intentionally left on the page unless a dashboard path is configured.
          if (cfg.redirectAuthenticatedUsers === true) location.assign(cfg.dashboardPath || "/dashboard");
        }
      }
    }).catch(err => console.warn("Could not restore KRONOS session", err));
  }
})();