/* ============================================================================
   THE ANDROID APP'S CONFIGURATION AGREES WITH ITSELF, AND THE KEY STAYS OUT.

   Nothing Android can be compiled on the PC, so the cheap mistakes are caught
   here instead of on a phone:

     .well-known/assetlinks.json    the site vouches for the package; a wrong name
                                    or a malformed fingerprint = the app opens with
                                    a URL bar and nobody is told why
     epinoia/android/version.json   one source of truth for Gradle, CI and the
                                    download page
     android/app/build.gradle       applicationId must be the same package, and the
     android/app/src/main/          manifest must not quietly name another one
       AndroidManifest.xml
     .github/workflows/android.yml  the keystore is decoded outside the checkout,
                                    releases come only from main, the key is deleted
     .gitignore                     keystores can never be committed by accident

     node supabase/tests/android-config.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const file = (...p) => path.join(ROOT, ...p);
const read = (...p) => readFileSync(file(...p), 'utf8');

let pass = 0, fail = 0, skip = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const skipped = (n, why) => { skip++; console.log('  SKIP  ' + n + '\n          ' + why); };
const json = (...p) => { try { return JSON.parse(read(...p)); } catch (e) { return { __error: e.message }; } };

const PACKAGE = 'uk.co.prophesyscouting.epinoia';
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/* ------------------------------------------------------------- assetlinks.json --- */
console.log('\n-- .well-known/assetlinks.json: the site vouches for the app');
const links = json('.well-known', 'assetlinks.json');
ok('assetlinks.json is valid JSON', !links.__error, links.__error);
ok('...and is an array of statements', Array.isArray(links));
const statements = Array.isArray(links) ? links : [];
const app = statements.filter(s => s && s.target && s.target.namespace === 'android_app');
ok('exactly one android_app statement', app.length === 1, 'found ' + app.length);
const st = app[0] || { relation: [], target: {} };
ok('it grants delegate_permission/common.handle_all_urls',
   Array.isArray(st.relation) && st.relation.includes('delegate_permission/common.handle_all_urls'));
ok('its package_name is ' + PACKAGE, st.target.package_name === PACKAGE, 'got ' + st.target.package_name);
const fps = st.target.sha256_cert_fingerprints;
ok('sha256_cert_fingerprints is an array', Array.isArray(fps));
ok('...every fingerprint is keytool form (uppercase hex, colon-separated, 32 bytes)',
   Array.isArray(fps) && fps.every(f => typeof f === 'string' && FINGERPRINT.test(f)),
   JSON.stringify(fps));
ok('...with no duplicates', Array.isArray(fps) && new Set(fps).size === fps.length);
if (Array.isArray(fps) && fps.length === 0)
  console.log('  NOTE  no fingerprint yet: signed CI builds fail until the owner adds the key (step 6.3)');

/* ---------------------------------------------------------------- version.json --- */
console.log('\n-- epinoia/android/version.json: one source of truth');
const ver = json('epinoia', 'android', 'version.json');
ok('version.json is valid JSON', !ver.__error, ver.__error);
ok('it has exactly versionCode, versionName, minShell, apk, play, released',
   JSON.stringify(Object.keys(ver).sort()) === JSON.stringify(['apk', 'minShell', 'play', 'released', 'versionCode', 'versionName']),
   JSON.stringify(Object.keys(ver)));
ok('released is a boolean (false until the first signed build is out; the site offers the app only when true)',
   typeof ver.released === 'boolean');
ok('versionCode is a positive integer', Number.isInteger(ver.versionCode) && ver.versionCode > 0);
ok('versionName is x.y.z', typeof ver.versionName === 'string' && /^\d+\.\d+\.\d+$/.test(ver.versionName));
ok('minShell is a positive integer no higher than versionCode (or no shell could satisfy it)',
   Number.isInteger(ver.minShell) && ver.minShell > 0 && ver.minShell <= ver.versionCode);
ok('apk is the stable latest-release link to epinoia.apk',
   ver.apk === 'https://github.com/MadvillainQuas/website/releases/latest/download/epinoia.apk');
ok('play is null or an https Play link',
   ver.play === null || (typeof ver.play === 'string' && ver.play.startsWith('https://play.google.com/')));

/* ------------------------------------------------------------ android/ project --- */
console.log('\n-- android/: the package name is the same everywhere');
const gradleFile = ['build.gradle', 'build.gradle.kts'].map(f => file('android', 'app', f)).find(existsSync);
const manifestFile = file('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!existsSync(file('android', 'app'))) {
  skipped('android/ checks', 'android/app/ is not in this checkout yet; the package-name, Gradle and manifest checks run once it is.');
} else {
  if (!gradleFile) {
    ok('android/app/build.gradle exists', false);
  } else {
    const g = readFileSync(gradleFile, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const appId = /applicationId\s*(?:=\s*)?["']([^"']+)["']/.exec(g);
    ok('build file applicationId is ' + PACKAGE, appId && appId[1] === PACKAGE, 'got ' + (appId && appId[1]));
    const ns = /namespace\s*(?:=\s*)?["']([^"']+)["']/.exec(g);
    ok('...and namespace, if set, is ' + PACKAGE, !ns || ns[1] === PACKAGE, 'got ' + (ns && ns[1]));
    ok('...and it reads the version from epinoia/android/version.json', /version\.json/.test(g));
    // The same four names android.yml sets; a rename on one side only = an unsigned release.
    ok('...and it signs from the EPINOIA_* environment android.yml sets, never a keystore path in the repo',
       ['EPINOIA_KEYSTORE', 'EPINOIA_STORE_PASSWORD', 'EPINOIA_KEY_ALIAS', 'EPINOIA_KEY_PASSWORD']
         .every(v => new RegExp('["\']' + v + '["\']').test(g))
       && !/storeFile\s*(?:=\s*)?file\(\s*["'][^"']*\.(jks|keystore)["']/.test(g));
  }
  if (!existsSync(manifestFile)) {
    ok('android/app/src/main/AndroidManifest.xml exists', false);
  } else {
    const m = readFileSync(manifestFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const pkgAttr = /<manifest[^>]*\spackage="([^"]+)"/.exec(m);
    ok('manifest package attribute, if set, is ' + PACKAGE, !pkgAttr || pkgAttr[1] === PACKAGE, 'got ' + (pkgAttr && pkgAttr[1]));
    // Fully qualified names under the house domain must all live in the one package.
    const named = [...m.matchAll(/uk\.co\.prophesyscouting\.[A-Za-z0-9_.]+/g)].map(x => x[0]);
    const strays = named.filter(n => n !== PACKAGE && !n.startsWith(PACKAGE + '.'));
    ok('manifest names no other uk.co.prophesyscouting package', strays.length === 0, strays.join(', '));
    ok('manifest declares the epinoia://notification-settings deep link the site opens',
       /android:scheme="epinoia"/.test(m) && /android:host="notification-settings"/.test(m)
       && /android\.intent\.category\.BROWSABLE/.test(m));
  }
}

/* ---------------------------------------------------------------- android.yml --- */
console.log('\n-- .github/workflows/android.yml: the key stays out, releases come from main');
const wfPath = file('.github', 'workflows', 'android.yml');
if (!existsSync(wfPath)) {
  ok('android.yml exists', false);
} else {
  const wf = readFileSync(wfPath, 'utf8');
  const code = wf.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  // Steps are the "      - " blocks under jobs.build.steps.
  // The on.push.paths list is indented the same way, so only text after steps: counts.
  const stepsAt = code.search(/\n    steps:\s*\n/);
  const steps = stepsAt < 0 ? [] : code.slice(stepsAt).split(/\n(?=      - )/).slice(1);
  const stepIf = s => { const x = /^\s+if:\s*(.+)$/m.exec(s); return x ? x[1].trim() : ''; };

  // Every place a keystore could be written: redirects out of base64 -d, and any
  // path ending .jks/.keystore. All must sit in the runner's temp directory.
  const decodes = [...code.matchAll(/base64\s+(?:-d|--decode)[^\n]*/g)].map(x => x[0]);
  ok('the keystore is decoded exactly once', decodes.length === 1, decodes.join(' | '));
  ok('...into $RUNNER_TEMP, never the checkout',
     decodes.length > 0 && decodes.every(d => /(>|of=)\s*"?\$(RUNNER_TEMP|\{\{\s*runner\.temp\s*\}\})\//.test(d)), decodes.join(' | '));
  ok('...with the CR/LF-stripping decode the owner steps rely on',
     /printf '%s' "\$ANDROID_KEYSTORE_B64" \| tr -d '\\r\\n' \| base64 -d/.test(code));
  // A path token may contain a ${{ expression }}, whose spaces would otherwise end it.
  const keyPaths = [...code.matchAll(/(?:\$\{\{\s*[\w.]+\s*\}\}|[^\s"'=:])+\.(jks|keystore)\b/g)].map(x => x[0]);
  ok('every keystore path is under the runner temp directory',
     keyPaths.length > 0 && keyPaths.every(p => /^(\$RUNNER_TEMP|\$\{RUNNER_TEMP\}|\$\{\{\s*runner\.temp\s*\}\})\/[^/]+$/.test(p)),
     keyPaths.join(', '));
  ok('EPINOIA_KEYSTORE points into runner.temp',
     /EPINOIA_KEYSTORE:\s*\$\{\{\s*runner\.temp\s*\}\}\/epinoia\.jks/.test(code));
  ok('no step checks out or writes to android/*.jks', !/android\/[^\s]*\.(jks|keystore)/.test(code));

  const release = steps.filter(s => /softprops\/action-gh-release@/.test(s));
  ok('there is one release step', release.length === 1);
  ok('...and it runs only on refs/heads/main',
     release.length === 1 && /github\.ref\s*==\s*'refs\/heads\/main'/.test(stepIf(release[0])), stepIf(release[0] || ''));
  ok('...only when signed, and only when the tag does not exist yet',
     release.length === 1 && /signed\s*==\s*'true'/.test(stepIf(release[0])) && /exists\s*==\s*'false'/.test(stepIf(release[0])));
  ok('...tagged android-v<versionCode> with epinoia.apk and epinoia.aab',
     release.length === 1 && /tag_name:\s*android-v\$\{\{\s*steps\.version\.outputs\.code\s*\}\}/.test(release[0])
     && /epinoia\.apk/.test(release[0]) && /epinoia\.aab/.test(release[0]));
  ok('no other step publishes (gh release create / upload)', !/gh release (create|upload)/.test(code));

  const del = steps.filter(s => /rm -f "\$RUNNER_TEMP\/epinoia\.jks"/.test(s));
  ok('the keystore is deleted in an if: always() step', del.length === 1 && /always\(\)/.test(stepIf(del[0])));
  ok('...which is the last step', del.length === 1 && steps[steps.length - 1] === del[0]);

  ok('the certificate is checked against assetlinks.json with apksigner',
     /apksigner"?\s+verify --print-certs/.test(code) && /\.well-known\/assetlinks\.json/.test(code));
  ok('unsigned runs upload epinoia-debug-apk', /name:\s*epinoia-debug-apk/.test(code) && /assembleDebug/.test(code));
  ok('contents: write permission is granted', /permissions:\s*\n\s+contents:\s*write/.test(code));
  // The token must not sit in .git/config while Gradle runs third-party build code.
  ok('the workflow defaults to contents: read', /^permissions:\s*\n\s+contents:\s*read/m.test(code));
  const checkout = steps.filter(s => /actions\/checkout@/.test(s));
  ok('checkout does not persist the write token', checkout.length === 1
     && /persist-credentials:\s*false/.test(checkout[0]));
  ok('this test runs in the workflow, before Gradle',
     steps.findIndex(s => /node supabase\/tests\/android-config\.test\.mjs/.test(s)) >= 0
     && steps.findIndex(s => /node supabase\/tests\/android-config\.test\.mjs/.test(s))
        < steps.findIndex(s => /gradle --no-daemon/.test(s)));
  ok('the signed check compares assetlinks entries as written (no uppercasing of the file)',
     !/assetlinks\.json\s*\|\s*tr /.test(code));
  // Release builds alone run lintVitalRelease; proving them only once the key exists is too late.
  const unsignedBuild = steps.filter(s => /signed != 'true'/.test(stepIf(s)) && /gradle --no-daemon/.test(s));
  ok('unsigned runs also build assembleRelease and bundleRelease',
     unsignedBuild.length === 1 && /assembleRelease/.test(unsignedBuild[0]) && /bundleRelease/.test(unsignedBuild[0]));
  // setup-gradle v6's default enhanced cache is proprietary; basic is MIT.
  const setupGradle = steps.filter(s => /gradle\/actions\/setup-gradle@/.test(s));
  ok('setup-gradle uses the MIT basic cache provider',
     setupGradle.length === 1 && /cache-provider:\s*basic/.test(setupGradle[0]));
  ok('push runs on every branch for the android paths',
     /branches:\s*\[\s*'\*\*'\s*\]/.test(code)
     && ["android/**", 'epinoia/android/version.json', '.well-known/assetlinks.json', '.github/workflows/android.yml']
        .every(p => code.includes("'" + p + "'")));
  ok('workflow_dispatch is available', /\bworkflow_dispatch:/.test(code));
  ok('concurrency is grouped per ref', /group:\s*android-\$\{\{\s*github\.ref\s*\}\}/.test(code));
  ok('Gradle is pinned', /GRADLE_VERSION:\s*'\d+\.\d+(\.\d+)?'/.test(code) && /gradle-version:\s*\$\{\{\s*env\.GRADLE_VERSION\s*\}\}/.test(code));
  ok('secrets are never echoed', !/echo[^\n]*\$\{?(ANDROID_KEYSTORE_B64|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD)/.test(code));
}

/* ----------------------------------------------------------------- .gitignore --- */
console.log('\n-- .gitignore: keystores can never be committed');
const ignore = read('.gitignore').split(/\r?\n/).map(l => l.trim());
for (const entry of ['*.jks', '*.keystore', 'android/.gradle/', 'android/**/build/', 'android/local.properties', 'google-services.json'])
  ok('.gitignore lists ' + entry, ignore.includes(entry));
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
if (tracked.status === 0) {
  const keys = tracked.stdout.split('\0').filter(f => /\.(jks|keystore|p12|pfx)$/i.test(f) || /(^|\/)google-services\.json$/.test(f));
  ok('no keystore or google-services.json is tracked by git', keys.length === 0, keys.join(', '));
} else {
  skipped('tracked-keystore check', 'git ls-files did not run here.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
process.exit(fail ? 1 : 0);
