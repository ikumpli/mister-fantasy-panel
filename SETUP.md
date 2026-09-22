# Automatic Mister updates

This importer is configured for **Juan hacker**, league `695985`, and the ten participants in the existing panel. It reads Mister's website and internal endpoints using a saved browser session. It does not store your password, place bids, change lineups, invite users, or post messages.

**Current state: code and offline tests are ready for a live trial. No account session has been exported, no secret has been uploaded, and scheduled publishing is disabled.** Reading the league in Firefox confirmed the participant IDs and J4 standings. The new Playwright importer still needs its own authenticated live test, including the internal round-status response.

## 1. Install and sign in once

Use Node.js 22 or newer. Open a terminal in this project folder and run:

```sh
npm ci
npm run browser:install
npm run mister:login
```

The last command opens a separate browser. Sign into Mister yourself using your usual login method. Return to the terminal and press Enter. The script selects Juan hacker and checks its ten participants. Confirm `s` to save the session locally.

By default, the session is written to `playwright/.auth/mister.json` with owner-only file permissions and is excluded from Git. It contains access credentials, so do not paste it into chat, commit it, upload it as an artifact, or share it. Firefox's existing login is not copied or read from disk. Only Mister's relevant cookies and storage are retained.

If Google or Apple refuses the automated browser, stop and report the sign-in issue. Do not disable account security or export your whole browser profile to work around it.

## Optional: use iCloud Drive between your Macs

Instead of the default local session file, set an explicit path outside the repository. Both Macs need iCloud Drive enabled for the same Apple Account. In the terminal where you will run the importer:

```sh
export MISTER_STORAGE_STATE_PATH="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Mister/private/mister.json"
npm run mister:login
npm run mister:preview -- --round 4
```

The login assistant displays this location and asks before saving. This syncs an account-access credential to iCloud and devices using that account. Use your own unshared iCloud Drive folder. The folder name `private` does not itself change sharing permissions or encrypt the JSON. Local owner-only permissions do not replace iCloud account and sharing controls.

Set the same environment variable in each new terminal session on the other Mac, install the project dependencies/browser there if needed, and wait for the file to finish syncing and be downloaded before previewing. The importer reads it in place; it does not copy it back into the project. Renew the session on one Mac at a time to avoid conflicting file versions.

If your aim is to keep this account session off the work laptop, create and use it on the personal laptop instead. iCloud synchronization can retain a local copy on any Mac with that Drive enabled. A reusable session can still expire or be rejected on another machine; an authenticated preview remains necessary.

GitHub Actions cannot read your iCloud Drive. After a successful preview, upload the session to the same repository secret using the selected path:

```sh
gh secret set MISTER_STORAGE_STATE --repo ikumpli/mister-fantasy-panel < "$MISTER_STORAGE_STATE_PATH"
```

Setting the variable changes the file location only. It does not create, move or upload any credentials until you run the corresponding login/upload command. The `MISTER_STORAGE_STATE` secret takes precedence over a local file during cloud runs. Use `unset MISTER_STORAGE_STATE_PATH` to return to the default local path.

## 2. Run a preview before changing scores

```sh
npm run mister:preview -- --round 4
```

Read `.sync/summary.md`. It shows the differences between the panel and Mister. A single-round preview cannot be published. On 22 September, the browser inspection found six differences in J4; the actual preview may differ if Mister changes scores again.

Then check the complete season:

```sh
npm run mister:preview
```

This creates `.sync/candidate.json`, `.sync/report.json` and `.sync/summary.md`. The original JSON remains untouched. The report includes source/configuration hashes so a stale candidate cannot overwrite subsequent edits. Candidates expire after six hours.

For a local preview of the changed panel, after reviewing the complete report:

```sh
npm run mister:apply
python3 -m http.server 8000
```

Open http://localhost:8000. Applying saves the old JSON as `.sync/previous.json`; nothing is uploaded by these local commands.

## 3. Connect the scheduled runner

After the live preview succeeds and the code is merged into `main`:

1. Install the official GitHub CLI if necessary, then run `gh auth login` for the account that owns `ikumpli/mister-fantasy-panel`.
2. Upload only the Mister session as a repository Actions secret. This step grants GitHub's runner access through that session:

```sh
gh secret set MISTER_STORAGE_STATE --repo ikumpli/mister-fantasy-panel < playwright/.auth/mister.json
```

The command reads the file over standard input; it does not print the session or put its contents in shell history. It can fail if your CLI authorization does not allow repository secrets. No cloud credentials are needed in the public JSON.

3. In the repository, open **Actions → Sync Mister points → Run workflow** on `main`. Leave **Publish validated points** unchecked. Verify that the run succeeds and review its summary and `mister-preview` artifact. This tests your session on the actual GitHub runner, which may behave differently from your computer.
4. Set **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then run the workflow manually with **Publish validated points** checked. It validates the candidate, commits the JSON, and explicitly deploys the site. Repository rules must permit the bot's JSON commit; a blocked push fails without bypassing those rules.
5. After checking the published page, create an Actions repository **variable** named `MISTER_SYNC_ENABLED` with value `true` under **Settings → Secrets and variables → Actions → Variables**.

The daily schedule is 08:17 UTC (10:17 in mainland Spain in summer, 09:17 in winter). It runs on GitHub while your laptop is off. Scheduled jobs can be delayed. Without the enable variable, automatic runs are skipped; manual previews remain available.

Enable GitHub Actions failure notifications for your account/repository if you want alerts. The code does not send separate emails or messages. The dashboard shows the last successful sync time and marks it stale after 72 hours.

## What is checked

- League membership is verified from each manager's `userInfo.id_community`, not just a configured label.
- The ten stable manager IDs must match; changing a nickname does not move points to another person.
- J1 and J4 are pinned to the actual gameweek IDs observed in the current league, preventing an automatic season rollover. IDs are discovered from links, never calculated by adding the jornada number.
- All available jornadas are rechecked on every complete run, including old corrections and postponed fixtures.
- A round must have an explicit recognized completed state and all ten fixtures marked played. Unknown response shapes abort the run. Closed rounds containing postponed fixtures remain provisional.
- Standings points must agree with each manager's historical total for that exact gameweek ID. The importer does not reconstruct points from footballers or differences between season totals.
- Zero and negative scores remain valid; missing scores are never turned into zero.
- A reopened round keeps its last recorded scores, but the dashboard marks its sprint incomplete until it settles again. New incomplete rounds remain `null`.
- All fetching and validation finishes before a candidate is created. A failed collection leaves the published data unchanged. Only `index.html`, `mister-datos.json` and `.nojekyll` are included in the site artifact.

## Session expiry and recovery

If a run fails because the session expired, repeat `npm run mister:login`, the local full preview, and the `gh secret set` command (use the selected external path if you configured iCloud). Then run a cloud preview again. The scheduled job never attempts password login and never prints cookies or internal authentication headers.

If the error concerns an unknown status, missing participants or mismatched history, inspect the changed site/league and fix the adapter or configuration before enabling publishing. Do not weaken the checks to force an update. The initial live test must confirm that Mister's current response matches the expected schema.

To stop daily runs, set `MISTER_SYNC_ENABLED` to `false`. To disconnect the account, also remove the `MISTER_STORAGE_STATE` repository secret and the auth file at your selected location. If that file is in iCloud Drive, deletion can sync to your other devices. Session revocation, if needed, is handled through Mister's own account controls.

A score commit and a Pages deployment are separate operations. If deployment fails after the JSON commit, the live site can still show the previous version; fix the deployment issue and rerun the full workflow. The last-success timestamp remains visible on the previously published page.

GitHub may disable schedules in public repositories after 60 days without activity. Recheck the schedule after the off-season. For a new season, review the panel's rules/data and configure verified new round anchors deliberately.

## Validation and sources

Run `npm test` for score parsing, historical corrections, zero/negative/missing points, duplicate/wrong-league records, season rollover, round closure, stale/concurrent writes, session scoping and publication contents. The tests use recorded visible scores and synthetic failure fixtures, with no account credentials or network access.

The integration was independently implemented after inspecting the public [elcerdo example](https://github.com/IgnacioGarijo/elcerdo), [Playwright authentication](https://playwright.dev/docs/auth), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), and [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Mister's endpoints are internal, not a supported developer API.
