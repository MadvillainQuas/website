/* ============================================================
 * topnav.js — site navigation bar shown across the analyzer apps.
 *
 * Renders a 38px fixed-position strip at the top of the page with:
 *   • brand link back to the menu (index.html)
 *   • a "Switch app" link to whichever analyzer the user isn't on
 *   • the signed-in username (+ admin badge)
 *   • a Switch user button that drops the session and returns to
 *     the sign-in screen
 *
 * Loaded from <head> on basketball-analyzer-profiles_9.html and
 * index_9.html. Idempotent — safe to load twice.
 * ============================================================ */
(function () {
    if (window.__prophesyNavLoaded) return;
    window.__prophesyNavLoaded = true;

    // If we're inside an iframe (i.e. the Lineup Analyzer is embedded in
    // lineup.html), let the parent show the nav instead — otherwise the
    // user gets two nav bars stacked on top of each other.
    try {
        if (window.self !== window.top) return;
    } catch (_) {
        // Cross-origin restriction also implies iframe → bail.
        return;
    }

    const SESSION_KEY = 'prophesy_auth_v2';

    // Inject CSS once.
    // The nav is normally a thin "hint" strip (5px tall, faintly glowing)
    // and expands to its full ~38px height when the cursor enters the
    // top of the screen. The hit-zone is taller than the visible hint
    // so it's easy to grab. Body padding stays at the small height so
    // the page content underneath isn't pushed around when the nav opens.
    const style = document.createElement('style');
    style.textContent = `
        #prophesy-nav-hitzone {
            position: fixed; top: 0; left: 0; right: 0;
            height: 18px; z-index: 9998;
            pointer-events: auto;
        }
        #prophesy-nav {
            position: fixed; top: 0; left: 0; right: 0;
            height: 5px; padding: 0;
            display: flex; align-items: center; gap: 6px;
            overflow: hidden;
            background: rgba(8, 16, 18, 0.92);
            backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
            border-bottom: 1px solid rgba(126, 200, 200, 0.18);
            font-family: 'Space Grotesk', -apple-system, Segoe UI, Roboto, sans-serif;
            font-size: 0.78rem;
            z-index: 9999;
            color: #d0e8e0;
            transition: height 0.20s ease, padding 0.20s ease, background 0.25s ease;
        }
        /* Subtle teal glow on the hint strip so users can spot it */
        #prophesy-nav::before {
            content: '';
            position: absolute; left: 50%; top: 0;
            width: 220px; height: 5px;
            transform: translateX(-50%);
            background: linear-gradient(90deg, transparent, rgba(126, 200, 200, 0.55), transparent);
            transition: opacity 0.18s ease;
            pointer-events: none;
        }
        #prophesy-nav.expanded {
            height: 38px;
            padding: 0 14px;
            background: rgba(8, 16, 18, 0.95);
        }
        #prophesy-nav.expanded::before { opacity: 0; }
        #prophesy-nav > *:not(::before) {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease 0.05s;
        }
        #prophesy-nav.expanded > * {
            opacity: 1;
            pointer-events: auto;
        }
        #prophesy-nav .nav-brand {
            display: inline-flex; align-items: center; gap: 8px;
            margin-right: 4px; padding: 4px 8px; border-radius: 6px;
            color: #a8d8c8; text-decoration: none; font-weight: 600;
            letter-spacing: 1.5px; text-transform: uppercase;
            transition: background 0.15s;
        }
        #prophesy-nav .nav-brand:hover { background: rgba(126, 200, 200, 0.10); }
        #prophesy-nav .nav-brand img { width: 22px; height: 22px; border-radius: 5px; object-fit: cover; }
        #prophesy-nav a.nav-link {
            color: #7ea8a0; text-decoration: none;
            padding: 4px 10px; border-radius: 6px;
            transition: background 0.15s, color 0.15s;
        }
        #prophesy-nav a.nav-link:hover { background: rgba(126, 200, 200, 0.10); color: #d0e8e0; }
        #prophesy-nav .nav-spacer { flex: 1; }
        #prophesy-nav .nav-user {
            color: #4a7872; font-family: 'IBM Plex Mono', monospace;
            font-size: 0.7rem; padding: 4px 8px; white-space: nowrap;
        }
        #prophesy-nav .nav-user .role-pill {
            margin-left: 6px; padding: 1px 7px;
            background: rgba(123, 168, 200, 0.22);
            border: 1px solid rgba(123, 168, 200, 0.5);
            color: #9bbcd6; border-radius: 4px;
            font-size: 0.6rem; letter-spacing: 0.8px; font-weight: 700;
        }
        #prophesy-nav button.nav-switchuser {
            background: transparent;
            border: 1px solid rgba(192, 136, 136, 0.30);
            color: #c08888;
            padding: 4px 12px; border-radius: 6px;
            font-family: inherit; font-size: 0.72rem; cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
        }
        #prophesy-nav button.nav-switchuser:hover {
            background: rgba(192, 136, 136, 0.10);
            border-color: rgba(192, 136, 136, 0.50);
        }
        /* Just enough top padding to clear the 5px hint */
        body.prophesy-padded { padding-top: 5px !important; }
        @media (max-width: 640px) {
            #prophesy-nav.expanded { padding: 0 8px; gap: 2px; font-size: 0.72rem; }
            #prophesy-nav .nav-brand { letter-spacing: 1px; }
            #prophesy-nav .nav-user { display: none; }
        }
    `;
    document.head.appendChild(style);

    function build() {
        if (document.getElementById('prophesy-nav')) return;

        let username = '';
        let role = '';
        try {
            const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            if (s) { username = s.username || ''; role = s.role || ''; }
        } catch (_) {}

        // Detect current app — 3 apps now: Shortlist, Lineup Analyzer, Game Visualizer.
        // Each app entry lists the paths it owns plus the canonical href + label
        // shown when the user is *not* on that app.
        const path = (window.location.pathname || '').toLowerCase();
        const APPS = [
            { id: 'shortlist', label: '⭐ Prophesy Shortlist', href: 'basketball-analyzer-profiles_9.html',
              owns: (p) => p.endsWith('basketball-analyzer-profiles_9.html') },
            { id: 'lineup',    label: '🏀 Lineup Analyzer', href: 'lineup.html',
              owns: (p) => p.endsWith('lineup.html') || p.endsWith('index_9.html') },
            { id: 'gamevis',   label: '📊 Game Visualizer', href: 'gamevis.html',
              owns: (p) => p.endsWith('gamevis.html') || p.endsWith('gamevis_with_shotchart_v2_6.html') }
        ];
        const currentApp = APPS.find(a => a.owns(path));
        const otherApps  = APPS.filter(a => a !== currentApp);
        // Kept for backwards-compat with existing logic below
        const isShortlist = currentApp && currentApp.id === 'shortlist';
        const isLineup    = currentApp && currentApp.id === 'lineup';

        // For admins coming from the admin Shortlist (?admin=1), keep the menu link admin-aware
        const adminParam = (function () {
            try { return new URLSearchParams(window.location.search).get('admin') === '1'; }
            catch (_) { return false; }
        })();

        const nav = document.createElement('div');
        nav.id = 'prophesy-nav';

        // Brand → menu
        const brand = document.createElement('a');
        brand.className = 'nav-brand';
        brand.href = 'index.html';
        brand.title = 'Back to menu';
        brand.innerHTML = '<img src="logo.jpg" alt="" onerror="this.style.display=\'none\'"/><span>Prophesy</span>';
        nav.appendChild(brand);

        // ← Menu
        const menu = document.createElement('a');
        menu.className = 'nav-link';
        menu.href = 'index.html';
        menu.textContent = '← Menu';
        nav.appendChild(menu);

        // Switch app — render a link for every app that isn't the current one.
        otherApps.forEach(a => {
            const link = document.createElement('a');
            link.className = 'nav-link';
            link.href = a.href;
            link.textContent = a.label;
            nav.appendChild(link);
        });

        // Admin: link to admin Shortlist + Admin Dashboard
        if (role === 'admin') {
            if (!isShortlist || !adminParam) {
                const adminShortlist = document.createElement('a');
                adminShortlist.className = 'nav-link';
                adminShortlist.href = 'basketball-analyzer-profiles_9.html?admin=1';
                adminShortlist.textContent = '⭐ Shortlist (Admin)';
                nav.appendChild(adminShortlist);
            }
            const dash = document.createElement('a');
            dash.className = 'nav-link';
            dash.href = 'admin.html';
            dash.textContent = '🛠 Admin Dashboard';
            nav.appendChild(dash);
        }

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'nav-spacer';
        nav.appendChild(spacer);

        // User label
        if (username) {
            const u = document.createElement('span');
            u.className = 'nav-user';
            u.textContent = '// ' + username;
            if (role === 'admin') {
                const pill = document.createElement('span');
                pill.className = 'role-pill';
                pill.textContent = 'admin';
                u.appendChild(pill);
            }
            nav.appendChild(u);
        }

        // Switch user
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'nav-switchuser';
        sw.textContent = 'Switch user';
        sw.title = 'Sign out and return to the sign-in screen';
        sw.addEventListener('click', () => {
            try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
            window.location.href = 'index.html';
        });
        nav.appendChild(sw);

        // Hit zone — slightly taller invisible strip so the user can grab the nav
        // without having to land on the 5px hint precisely.
        const hitZone = document.createElement('div');
        hitZone.id = 'prophesy-nav-hitzone';

        document.body.prepend(nav);
        document.body.prepend(hitZone);
        document.body.classList.add('prophesy-padded');

        // Hover-to-expand behaviour with a small grace delay so flickering
        // between the hit zone and the nav doesn't collapse it. Focus
        // inside the nav also keeps it open (for keyboard users).
        let collapseTimer = null;
        const expand = () => {
            if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
            nav.classList.add('expanded');
        };
        const scheduleCollapse = () => {
            if (collapseTimer) clearTimeout(collapseTimer);
            collapseTimer = setTimeout(() => {
                if (nav.contains(document.activeElement)) return; // keyboard focus inside
                nav.classList.remove('expanded');
                collapseTimer = null;
            }, 180);
        };
        hitZone.addEventListener('mouseenter', expand);
        hitZone.addEventListener('mouseleave', scheduleCollapse);
        nav.addEventListener('mouseenter', expand);
        nav.addEventListener('mouseleave', scheduleCollapse);
        nav.addEventListener('focusin', expand);
        nav.addEventListener('focusout', scheduleCollapse);

        // Touch / coarse-pointer devices: a tap on the hit zone toggles open.
        let touchOpen = false;
        hitZone.addEventListener('click', (ev) => {
            if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
                ev.preventDefault();
                touchOpen = !touchOpen;
                if (touchOpen) expand(); else nav.classList.remove('expanded');
            }
        });
        document.addEventListener('click', (ev) => {
            if (!touchOpen) return;
            if (nav.contains(ev.target) || hitZone.contains(ev.target)) return;
            touchOpen = false;
            nav.classList.remove('expanded');
        });
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build, { once: true });
})();
