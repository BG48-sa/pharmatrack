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
- Primary: **Medical** (most accurate) — note: Medical apps get extra review
  scrutiny; keep the description framed as an information tracker, not advice.
  Alternative if you prefer a lighter review: **Reference**.
- Secondary: Reference (or Medical, whichever you didn't pick as primary).

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
