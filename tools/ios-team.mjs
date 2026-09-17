#!/usr/bin/env node
/* ============================================================================
   ios-team — writes .well-known/apple-app-site-association for the iPhone app
   (ios/README.md, docs/ios-app.md step 7).

   The file tells iOS which links on prophesyscouting.co.uk open in the EPINOIΛ
   app instead of Safari (universal links): an email's link, a shared game, a
   notification's page. Apple reads it from the site, so it names the app by
   "<Team ID>.<bundle id>", and the Team ID only exists once the Apple
   Developer account does. It is the Team ID, not a secret: every app's is
   public in this same file.

     node tools/ios-team.mjs ABCDE12345

   WHAT OPENS IN THE APP: every /epinoia/ page, except the ones that are never
   a person's page to read: the embeds (inside other sites), the broadcast
   overlays (inside streaming software), the API docs and the dev feed.
   GitHub Pages serves the file (the repository has .nojekyll, as for
   assetlinks.json); Apple's CDN fetches it when the app is installed.
   ============================================================================ */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE_ID = 'uk.co.prophesyscouting.epinoia';

export function association(teamId) {
  if (!/^[A-Z0-9]{10}$/.test(String(teamId || ''))) {
    throw new Error('A Team ID is 10 capital letters and digits, as shown under Membership details at developer.apple.com/account');
  }
  return {
    applinks: {
      details: [{
        appIDs: [teamId + '.' + BUNDLE_ID],
        components: [
          { '/': '/epinoia/embed/*', exclude: true, comment: 'inside other websites' },
          { '/': '/epinoia/broadcast/*', exclude: true, comment: 'inside streaming software' },
          { '/': '/epinoia/api/*', exclude: true, comment: 'developer documentation' },
          { '/': '/epinoia/devfeed.html', exclude: true, comment: 'developer tool' },
          { '/': '/epinoia/*', comment: 'every other EPINOIΛ page' }
        ]
      }]
    }
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const team = String(process.argv[2] || '').trim().toUpperCase();
  try {
    const json = JSON.stringify(association(team), null, 2) + '\n';
    const dir = path.join(here, '..', '.well-known');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'apple-app-site-association');
    writeFileSync(file, json);
    console.log('wrote ' + path.relative(path.join(here, '..'), file) + ' for ' + team + '.' + BUNDLE_ID);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
