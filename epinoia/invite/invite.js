'use strict';
/* ============================================================================
   INVITE — the door into a private league (0139).

   A private league is not listed, not searchable and not in the sitemap. The
   only way to it is a link somebody was sent, and this is the page that link
   points at: /epinoia/invite/?i=<token>.

   THE ORDER MATTERS, and it is not the obvious one.

     1. PEEK FIRST, SIGNED IN OR NOT. league_invite_peek is callable by anon and
        returns the league's NAME and nothing else. Somebody holding the link is
        allowed to know what they have been invited to before they are asked to
        create an account — and being sent to sign in, signing in, and only then
        being told the link expired is a worse thirty seconds than being told at
        the door.
     2. THEN THE ACCOUNT. Joining is a row against an account, so there has to be
        one. Signed out, the page says who the invitation is from and sends them
        to sign in with ?next= pointing back here, token and all.
     3. THEN ONE DELIBERATE PRESS. Redemption is NOT automatic, although it would
        be friendlier by one tap. A one-use link opened on a shared phone that is
        still signed in as somebody else would spend its one use on the wrong
        person, and there is no way back from that except minting another link
        and working out who now has access they should not. So the page names the
        account it is about to join as, in bold, with a way to switch — and then
        one button.

   REDEEMING TWICE IS A SUCCESS. The database treats a second redeem by the same
   account as "already in" and does not spend a use, so a bookmark, a second
   phone, or scrolling back through the group chat all do the right thing.
   ============================================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const TOKEN = (params.get('i') || '').trim();

  const kicker = $('#kicker'), title = $('#title'), lead = $('#lead');
  const asBox = $('#as'), act = $('#act'), msg = $('#msg');

  let sb = null;

  function say(text, kind) {
    msg.textContent = text || '';
    msg.className = 'msg ' + (kind || '');
    msg.classList.toggle('hide', !text);
  }

  function btn(label, primary) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-btn' + (primary ? ' pri' : '');
    b.textContent = label;
    return b;
  }
  function link(label, href, primary) {
    const a = document.createElement('a');
    a.className = 'ep-btn' + (primary ? ' pri' : '');
    a.href = href; a.textContent = label;
    return a;
  }

  function dead(head, why) {
    kicker.textContent = 'this link does not work';
    title.textContent = head;
    lead.textContent = why;
    act.textContent = '';
    act.appendChild(link('Go to Epinoia', '../home/', true));
  }

  /* Same rules as signin.js safePath, which is what will read it back: a
     same-origin path under /epinoia/ and nothing else. Built here rather than
     hand-written so the token cannot smuggle anything into it. */
  function signinHref() {
    const next = '/epinoia/invite/?i=' + encodeURIComponent(TOKEN);
    return '../signin/?next=' + encodeURIComponent(next);
  }

  async function boot() {
    if (!TOKEN) {
      return dead('No invitation in this link',
        'The address is missing its invitation code. Ask whoever sent it to you ' +
        'to send the whole link — it ends in ?i= followed by a string of letters.');
    }

    sb = window.epinoiaClient && epinoiaClient();
    if (!sb) {
      return dead('Epinoia could not be reached',
        'The sign-in service is not configured on this page. Try again in a moment.');
    }

    /* ---- 1. what is this a link to ---- */
    let peek;
    try {
      const { data, error } = await sb.rpc('league_invite_peek', { p_token: TOKEN });
      if (error) throw error;
      peek = data;
    } catch (e) {
      return dead('The link could not be checked',
        'Epinoia could not be reached just now (' + (e.message || e) + '). ' +
        'Your connection may have dropped — try again in a moment.');
    }

    const named = (peek && peek.league) ? peek.league : 'a private league';
    if (!peek || !peek.ok) {
      const reason = peek && peek.reason;
      if (reason === 'revoked') {
        return dead('This link has been withdrawn',
          'The invitation to ' + named + ' was revoked by whoever runs it. ' +
          'Ask them for a new one.');
      }
      if (reason === 'expired') {
        return dead('This link has expired',
          'The invitation to ' + named + ' was only good for a while, and that ' +
          'while has passed. Ask whoever sent it for a new one.');
      }
      if (reason === 'used_up') {
        return dead('This link has been used',
          'The invitation to ' + named + ' was good for a set number of people ' +
          'and they have all joined. Ask whoever sent it for a new one.');
      }
      return dead('This is not an invitation we know',
        'Nothing on Epinoia matches this code. It may have been mistyped, or ' +
        'cut short when it was copied — an invitation link ends in ?i= followed ' +
        'by a string of letters, with nothing after it.');
    }


    const runs = peek.role === 'league_admin';

    kicker.textContent = runs ? 'you have been asked to run' : 'you have been invited to';
    title.textContent = peek.league;
    lead.textContent = runs
      ? peek.league + ' is a private league on Epinoia. This link makes you its ' +
        'administrator: you set up the clubs and the fixtures, appoint whoever ' +
        'scores the games, and decide who else gets in.'
      : peek.league + ' is a private league on Epinoia — not listed, not ' +
        'searchable, open only to the people sent a link like this one. Join it ' +
        'and its fixtures, results and statistics are yours to read.';

    /* ---- 2. is there an account ---- */
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      act.appendChild(link('Sign in and join', signinHref(), true));
      say('Epinoia has no passwords: signing in is a Google button or a link ' +
          'sent to your email. You will come straight back here.', '');
      return;
    }

    /* ---- 3. one deliberate press, as a named account ---- */
    const email = (session.user && session.user.email) || 'this account';
    asBox.classList.remove('hide');
    asBox.innerHTML = '';
    asBox.append(document.createTextNode('Joining as '));
    const b = document.createElement('b'); b.textContent = email;
    asBox.append(b, document.createTextNode('. '));
    const not = document.createElement('a');
    not.href = '#'; not.textContent = 'Not you?';
    not.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await sb.auth.signOut(); } catch (_) {}
      location.href = signinHref();
    });
    asBox.append(not);

    const join = btn(runs ? 'Take on ' + peek.league : 'Join ' + peek.league, true);
    act.appendChild(join);
    join.addEventListener('click', async () => {
      join.disabled = true;
      say('Joining…', '');
      let res;
      try {
        const { data, error } = await sb.rpc('redeem_league_invite', { p_token: TOKEN });
        if (error) throw error;
        res = data;
      } catch (e) {
        join.disabled = false;
        return say('That did not go through: ' + (e.message || e) +
                   '. Your connection may have dropped — press it again.', 'err');
      }

      if (!res || !res.ok) {
        /* Between the peek and the press somebody revoked it, or the last use
           went to somebody else. Say which, rather than "failed". */
        const r = res && res.reason;
        join.remove();
        return say(
          r === 'revoked'  ? 'The invitation was withdrawn while this page was open.' :
          r === 'expired'  ? 'The invitation expired while this page was open.' :
          r === 'used_up'  ? 'The last place on this link went to somebody else while ' +
                             'this page was open. Ask for another link.' :
                             'This invitation is no longer valid. Ask for another link.', 'err');
      }

      join.remove();
      asBox.classList.add('hide');
      kicker.textContent = res.already ? 'you were already in' : 'you are in';
      title.textContent = peek.league;
      lead.textContent = res.already
        ? 'This account already had access to ' + peek.league + '. Nothing changed, ' +
          'and the link was not used up.'
        : runs
          ? 'You now administer ' + peek.league + '. The league console is where you ' +
            'add clubs, put fixtures in the calendar and appoint people to score them.'
          : peek.league + ' is now open to this account, from any device you sign in on.';
      act.textContent = '';
      act.appendChild(link('Open ' + peek.league, '../?l=' + encodeURIComponent(res.slug || peek.slug), true));
      if (runs) act.appendChild(link('League console', '../admin/'));
      say('', '');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
