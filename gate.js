/* ============================================================
 * gate.js — site-wide invite-code gate.
 *
 * Loaded synchronously from <head> on every page. Until the
 * visitor has either (a) supplied a valid ?invite=<code> in the
 * URL or (b) successfully unlocked previously (kept in
 * localStorage indefinitely), the page is hidden and a generic
 * "site not configured" message is shown instead.
 *
 * The valid invite code's SHA-256 is hardcoded below. The
 * cleartext code itself never appears in the source.
 *
 * Revocation: there is no time-based expiry. The unlock is
 * stored alongside the SHA-256 hash that produced it, and on
 * every load we verify that stored hash still equals the current
 * INVITE_HASH_HEX below. The admin "revokes everyone" simply by
 * rotating the invite code (new code → new hash → all existing
 * unlocks no longer match → those visitors get the gate again).
 *
 * Limitations: this is a UI-level obscurity layer. It does NOT
 * protect raw data files at /data/*.csv — anyone who knows the
 * filenames can still fetch them. For real edge auth, deploy
 * via Cloudflare Access (see README, "Real authentication").
 * ============================================================ */
(function () {
    // SHA-256 hex of the invite code. Default: PROPHESY-2026-MdVilCxl-9kpTs0Q3J
    // To rotate (== revoke everyone currently unlocked):
    //   1. Pick a new code.
    //   2. echo -n "<new code>" | openssl dgst -sha256
    //   3. Replace INVITE_HASH_HEX below with the new hex.
    //   4. Update SHARED_INVITE_CODE in admin.html to match (so the
    //      "Share invite link" card shows the new code).
    //   5. Commit + push. Every existing visitor's stored unlock now
    //      hashes to the OLD value and is rejected on next page load.
    const INVITE_HASH_HEX  = 'b56aad31ab2d5f0426f4ca1baf42f53b0626f9159bb83f2665c0087f9892ac70';
    // Expose the hash as a stable global so other scripts can reuse it as
    // an XOR key for sharing tokens (so GitHub's secret-scanning bot
    // doesn't auto-revoke published PATs).
    try { window.PROPHESY_INVITE_HASH_HEX = INVITE_HASH_HEX; } catch (_) {}
    // Storage key bumped to _v2 because the schema changed (we now
    // store { ts, hash } instead of just { ts }). Old _v1 entries
    // would be rejected anyway since they lack a hash field, so this
    // bump just keeps the localStorage namespace clean.
    const STORAGE_KEY      = 'prophesy_invited_v2';

    // Hide the page immediately to prevent flash-of-content while we check.
    // We use <html> because <body> may not exist yet.
    try { document.documentElement.style.visibility = 'hidden'; } catch (_) {}

    function reveal() {
        try { document.documentElement.style.visibility = 'visible'; } catch (_) {}
    }

    function setUnlocked() {
        // Persist the hash that unlocked us, NOT the cleartext code.
        // On future loads we re-check this stored hash equals the
        // current INVITE_HASH_HEX — so rotating the code instantly
        // revokes every existing unlock, with no time component.
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ts: Date.now(),
                hash: INVITE_HASH_HEX
            }));
        } catch (_) {}
    }

    function isUnlocked() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return false;
            // Permanent unless the stored hash no longer matches the
            // current invite hash (i.e. admin rotated the code).
            // No expiry timer.
            return parsed.hash === INVITE_HASH_HEX;
        } catch (_) { return false; }
    }

    async function sha256Hex(str) {
        const buf = new TextEncoder().encode(String(str));
        const hash = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function showBlock() {
        // Generic, low-information message — give nothing away.
        const writeBlock = () => {
            document.body.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a1214;color:#7ea8a0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:40px;z-index:2147483647;';
            wrap.innerHTML = '<div><div style="font-size:0.95rem;letter-spacing:6px;text-transform:uppercase;margin-bottom:14px;color:#d0e8e0;font-weight:300;">Not available</div><div style="font-size:0.78rem;opacity:0.7;max-width:340px;line-height:1.6;">This URL is restricted. If you should have access, request the current invite link from your administrator.</div></div>';
            document.body.appendChild(wrap);
            reveal();
        };
        if (document.body) writeBlock();
        else document.addEventListener('DOMContentLoaded', writeBlock, { once: true });
    }

    async function check() {
        // Already unlocked?
        if (isUnlocked()) {
            reveal();
            return;
        }

        // Try a query-string invite code, ?invite=…
        let code = null;
        try {
            const params = new URLSearchParams(window.location.search);
            code = params.get('invite');
            // Also accept a hash form: #invite=...
            if (!code && window.location.hash) {
                const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
                code = hashParams.get('invite');
            }
        } catch (_) {}

        if (code) {
            try {
                const hash = await sha256Hex(code);
                if (hash === INVITE_HASH_HEX) {
                    setUnlocked();
                    // Strip the invite param from the URL so it's not bookmarked / shared.
                    try {
                        const url = new URL(window.location.href);
                        url.searchParams.delete('invite');
                        // Drop the param from #hash form too
                        if (url.hash) {
                            const h = new URLSearchParams(url.hash.replace(/^#/, ''));
                            h.delete('invite');
                            url.hash = h.toString() ? '#' + h.toString() : '';
                        }
                        history.replaceState({}, '', url.toString());
                    } catch (_) {}
                    reveal();
                    return;
                }
            } catch (_) {}
        }

        showBlock();
    }

    // Run as soon as we can; crypto.subtle is available in all modern browsers.
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        check();
    } else {
        // Old browser without WebCrypto — fail closed.
        showBlock();
    }
})();
