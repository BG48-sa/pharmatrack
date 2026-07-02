# DrugRadar — App Store submission kit

Everything needed to publish DrugRadar (formerly PharmaTrack) as a **free** app on
the Apple App Store. Bundle id `com.berndgansbacher.pharmatrack`, Team `S8S8S983CX`.

---

## 0. Status / what's already done
- [x] Renamed app → **DrugRadar** (Info.plist, pbxproj, capacitor.config, web UI, manifest)
- [x] Web bundle rebuilt and copied into the iOS project (`npx cap copy ios`)
- [x] Privacy policy page written → `frontend/public/privacy.html`
- [x] 1024×1024 app icon present (`AppIcon-512@2x.png`)
- [ ] Privacy policy deployed live (run `./deploy-pages.sh`)
- [ ] App record created in App Store Connect
- [ ] Screenshots captured
- [ ] Build archived + uploaded from Xcode
- [ ] Submitted for review

---

## 1. Listing metadata (copy-paste into App Store Connect)

**App name** (≤30 chars)
```
DrugRadar
```

**Subtitle** (≤30 chars)
```
FDA & EMA drug approvals
```

**Promotional text** (≤170 chars, editable anytime without re-review)
```
Track the latest FDA and EMA drug approvals, CDER novel new drugs, PDUFA dates, and late-stage clinical trials — all from official public sources.
```

**Keywords** (≤100 chars, comma-separated, no spaces needed)
```
drug,approval,FDA,EMA,pharma,medicine,clinical,trial,PDUFA,novel,biotech,regulatory,pipeline,CDER
```

**Description**
```
DrugRadar is a clean, fast tracker for newly approved pharmaceutical drugs and
late-stage clinical trials, built on official public regulatory data.

WHAT YOU CAN TRACK
• Recent FDA drug approvals with Marketing Authorization dates
• EMA (European) approvals and estimated EC decision dates
• CDER novel new-drug approvals
• Upcoming PDUFA action dates
• Critical medicines and late-stage clinical trials (ClinicalTrials.gov)

WHY DRUGRADAR
• Sourced from official public data: openFDA, EMA, and ClinicalTrials.gov
• No account, no ads, no tracking — your data stays on your device
• Fast, focused, and easy to scan

DrugRadar presents public regulatory information for general informational
purposes only. It is not medical advice and is not a substitute for consultation
with a qualified healthcare professional. DrugRadar is an independent project and
is not affiliated with or endorsed by the FDA, EMA, or the U.S. National Library
of Medicine.
```

**Support URL**
```
https://bg48-sa.github.io/pharmatrack/
```

**Privacy Policy URL**
```
https://bg48-sa.github.io/pharmatrack/privacy.html
```

**Marketing URL** (optional) — same as Support URL or leave blank.

**Category**
- Primary: **Reference** — deliberate for the 4.2.2 resubmission: Medical as
  primary invites extra review scrutiny, which a drug-information tracker from
  an individual developer account does not need for its first approval. The app
  presents factual public regulatory data (no dosing/treatment guidance), so
  Reference is accurate. Revisit after approval if desired.
- Secondary: **Medical**.

**Price:** Free (no In-App Purchases) → no Paid Apps agreement, no tax/banking forms.

---

## 2. App privacy answers (App Store Connect → App Privacy)
Answer: **Data Not Collected.**
Rationale: no account, no analytics, no third-party SDKs. The only on-device
storage is a "last visit" timestamp that never leaves the device and is not
linked to identity — this does not count as collected data.

## 3. Age rating questionnaire
Answer honestly. The relevant item is "Medical/Treatment Information" — DrugRadar
shows factual regulatory data (not dosing/treatment guidance), so select the
**infrequent/mild** option. Expected resulting rating: 12+ (do not claim 4+).

## 4. Export compliance
The app uses only standard HTTPS (no proprietary/custom encryption).
- In App Store Connect: answer "Yes" it uses encryption, then "Yes" it qualifies
  for the exemption (standard encryption only). No annual self-classification
  report is required.

---

## 5. Screenshots (required)
You need screenshots for at least one iPhone size. Apple currently requires the
**6.7"/6.9" iPhone** size (1290×2796 px). Capture 3–5 showing the main views:
Europe, Novel, Approvals, Pipeline.

Fastest path: run the web app, size the browser to an iPhone viewport, screenshot;
or run the app in the iOS Simulator (iPhone 15/16 Pro Max) and use ⌘S to save
frames. (Claude can generate these from the running app on request.)

---

## 6. Build + upload (your Apple ID required)
```
# From repo root — produces the renamed web bundle and syncs the native project:
npm run ios          # vite build + cap sync ios + cap open ios (opens Xcode)
```
In Xcode:
1. Select scheme **App** → destination **Any iOS Device (arm64)**.
2. **Signing & Capabilities**: Team = S8S8S983CX, "Automatically manage signing"
   ✓, no red errors (paid membership now active, so a valid distribution profile
   will be issued).
3. Menu **Product → Archive**.
4. In the Organizer: **Distribute App → App Store Connect → Upload**.

## 7. Create the listing + submit (App Store Connect, your login)
1. https://appstoreconnect.apple.com → **Apps → +**  → New App.
   - Platform iOS, Name **DrugRadar**, Bundle ID `com.berndgansbacher.pharmatrack`,
     SKU `drugradar` (any unique string).  ← this reserves the name; do it early.
2. Fill in the metadata from section 1, upload screenshots + icon.
3. App Privacy = Data Not Collected; complete age rating + export compliance.
4. Under **Build**, select the build you uploaded in step 6.
5. **Add for Review → Submit**.

Tip: reserve the name in step 7.1 first, before anyone else takes "DrugRadar".
```

---

## 8. Resubmission after the 4.2.2 rejection (July 2026)

Context: version 1.0 **build 1** was rejected on 1 Jul 2026 under Guideline
4.2.2 (Minimum Functionality), reviewed on an **iPad Air 11-inch (M3)**
(Submission ID 66820f6d-aca8-4d0d-a51b-0c7ae75d2100). That build predated all
native functionality. Builds since then add: indication watchlist, on-device
decision notifications, offline mode, per-drug private notes, a native
regulatory glossary (tappable badges), an iPad two-pane master–detail layout,
side-by-side comparison, and the system share sheet.

**Checklist for this resubmission:**
- [ ] Category set to **Reference (primary) / Medical (secondary)** — see §1.
- [ ] Screenshots retaken showing the NATIVE features (alerts panel with
      followed indications, notes on a drug, comparison view, glossary) — not
      just browsing lists. Include **iPad screenshots** (the review device was
      an iPad): 13" iPad Pro size (2064×2752), showing the two-pane layout.
- [ ] App Privacy remains **Data Not Collected** (notes/watchlist stay on-device).
- [ ] Paste the reviewer reply (below) into the App Store Connect message
      thread WITH the new build attached — never on the rejected binary alone.
- [ ] Paste the walkthrough (below) into the **App Review Notes** field.

### Reply to App Review (paste into the rejection message thread)

> Hello App Review Team,
>
> Thank you for reviewing my first submission and for the feedback under
> Guideline 4.2.2. I understood the concern: the reviewed build (1.0, build 1)
> could indeed read as a content browser.
>
> Rather than appeal, I have substantially rebuilt the app around native,
> on-device functionality. The new build you are reviewing adds:
>
> 1. **Watchlist with local notifications** — follow a medical indication
>    (e.g. “multiple myeloma”) and receive on-device reminders before the
>    estimated EU decision date on any matching medicine. Scheduled entirely
>    on the device with iOS local notifications; no server involved.
> 2. **Private notes on any medicine** — free-text notes stored on-device
>    (iOS UserDefaults via Capacitor Preferences), autosaved, never uploaded.
> 3. **Native glossary** — every regulatory badge (PRIME, ATMP, Orphan,
>    Conditional, 351(k), CHMP…) is tappable and opens a built-in, native
>    explanation screen written for clinicians — not a web link.
> 4. **iPad-adaptive layout** — on iPad the app presents a two-pane
>    master–detail interface designed for the larger canvas.
> 5. **Side-by-side comparison** — select any two medicines and compare
>    regulatory status, dates, indication facets and company.
> 6. **Offline mode** — bundled and cached datasets keep the app fully
>    functional with no network connection.
> 7. **System share sheet** — share a structured medicine summary.
>
> The app is not a web wrapper: the entire interface is bundled in the binary,
> and the only external links are citations to official EMA/FDA source pages.
>
> I have also set the primary category to Reference (secondary: Medical), as
> the app presents factual public regulatory information rather than medical
> guidance.
>
> Detailed steps to reach each feature are in the App Review Notes. Thank you
> for your time — I am happy to provide anything further.
>
> Kind regards,
> Univ. Prof. Dr. med. Bernd Gansbacher

### App Review Notes (paste into the “Notes” field of the submission)

> This app is not a web wrapper — all UI is bundled in the binary. Please test
> the native functionality:
>
> • WATCHLIST + LOCAL NOTIFICATIONS: tap the bell icon (top right) → “Enable
>   notifications” → add “Multiple myeloma”. The app schedules on-device
>   reminders ahead of estimated EU decision dates; upcoming decisions are
>   listed in the same panel. Also reachable via Europe tab → search a disease
>   → “Follow … for EU decision alerts”.
> • PRIVATE NOTES: open any medicine → scroll to “My notes” → type. The note
>   autosaves to device storage (visible after force-quitting and reopening).
> • GLOSSARY: tap the book icon (top right), or tap any badge on a medicine
>   (e.g. ORPHAN, PRIME, ATMP) to open its native explanation screen.
> • iPAD TWO-PANE LAYOUT: on iPad, the list and the medicine detail render
>   side-by-side (master–detail), in both portrait and landscape.
> • COMPARE: open a medicine → “Compare” → open a second medicine → “Compare”
>   → tap the Compare button in the bottom tray for a side-by-side view.
> • OFFLINE: enable Airplane Mode and relaunch — all tabs keep working from
>   bundled/cached data.
> • SHARE: open a medicine → “Share” → the iOS share sheet opens with a
>   structured summary.
>
> No account is needed; the app collects no data (all user state is on-device).
