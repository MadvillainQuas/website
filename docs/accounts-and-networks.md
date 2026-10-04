# Disabled accounts and blocked networks (2026-10-04, migration 0230)

**Disable** in the platform console (Accounts, on a row or on the account's own page) puts an account out for good:

- it cannot sign in: GoTrue's `banned_until` (as since 0044), and every sign-in form says "This account has been
  disabled, so it cannot sign in" (`epinoiaAuthText` in `config.js`, used by `signin.js`, `splash.js`, `app.js`,
  `admin.js` and `platform.js`);
- its sessions end (`account_end_sessions`): no browser can refresh its way back in;
- a browser that is still signed in is signed out the next time a page opens, the tab comes back or ten minutes pass,
  with a box saying why (`account_status()`, asked by `config.js` on every page but the embeds);
- and the database refuses every signed-in request it makes in the meantime (`api_gate`, below).

**Enable** undoes all of it and lifts the network blocks made for the account.

## Blocking a disabled account's networks

So the same person cannot come straight back with another email. While an account is signed in, `account_status()`
notes the network address it is on (`account_ips`: address, first and last seen; forgotten 90 days after it was last
seen, by the daily `epinoia-account-ips-prune` job). Disabling also keeps the addresses GoTrue saw its sessions on.

Right after a disable the console offers to block them all, listing each address and how many **other** accounts were
seen on it: one that is shared (a household, a school, an office, a mobile network) refuses those people too, and the
console says so. The account's page lists its networks with a **block** button each, and the Accounts tab lists every
block (**Blocked networks**: who it was for, signed-in visits refused on it, other accounts seen on it since) with an
**unblock** button. An IPv4 block is the one address; an IPv6 block is the /64 around it, because a home router or a
phone changes the rest of an IPv6 address every day. Nobody can block the network they are on themselves.

On a blocked network:

- reading the site signed out works as always: nothing public is ever refused;
- any account is refused while it is there (signed out, with the box saying why), except a platform administrator's;
- an account **made after** the block that turns up there is disabled the first time it is used (the audit log says
  "made after its network was blocked"). Accounts that were already there are only refused while they are on it, as a
  shared network's other people would be.

## The gate (`api_gate`)

PostgREST's pre-request function (`pgrst.db_pre_request` on the `authenticator` role, set by 0230): it runs before every
API request. A signed-out request, or the service key's, passes untouched. A signed-in request from a disabled account,
or from a blocked network (not a platform administrator's), gets HTTP 403 with the hint `epinoia:disabled` or
`epinoia:blocked`. `account_status` itself is let through, so a page can always find out why. Anything that goes wrong
inside the gate lets the request through: it can fail open, never take the site down.

**Never drop or rename `api_gate()`** without first running, as the postgres user:

    alter role authenticator reset pgrst.db_pre_request;
    notify pgrst, 'reload config';

or every request to the API fails. If 0230 found a pre-request function already set, it left it alone and said so;
then call `public.api_gate()` from that function. If it could not set it (a warning in the push's output), run
`alter role authenticator set pgrst.db_pre_request = 'public.api_gate'; notify pgrst, 'reload config';` as postgres.
Storage and Realtime do not go through PostgREST: there a disabled account's last access token lasts until it expires
(an hour at most), and it can no longer be refreshed.

The address comes from Cloudflare's `cf-connecting-ip` (which a browser cannot set), then `x-real-ip`, then the first
`x-forwarded-for` (`request_ip()`).

The privacy page says all this in plain words (**Keeping disabled accounts out**). Tests:
`supabase/tests/disabled-accounts.test.mjs`.
