# SDLC Intelligence Walkthrough (client-friendly)

This section explains the **SDLC Intelligence** pages in the sidebar.

If you want a 5-year-old explanation:
- Building software is like building a big LEGO city.
- SDLC Intelligence is like having **helper friends** who:
  - read your plan,
  - check your LEGO pieces,
  - warn you before the city opens,
  - and watch the city after it opens.

### The pages (in the same order as the sidebar)

1) **Requirements Intel** “Make the plan clear”

**What it does**
- Takes a feature description (a story of what you want to build) and turns it into clear “rules” that can be tested.
- Points out confusing parts and asks the missing questions.

**What we want to do**
- Make sure everyone agrees on what “done” means before building.
- Reduce misunderstandings early.

**Impact**
- Fewer surprises later.
- Fewer last-minute changes because the requirement was unclear.

**Example**
- If the story says: “Users should log in fast”, the helper asks: “How fast is fast?” and writes testable rules like “Login should finish within 2 seconds.”

2) **Code Review** “Check the changes before you glue them in”

**What it does**
- Looks at a change set (what someone changed) and gives a review: what looks good, what looks risky, what might be missing.

**What we want to do**
- Catch mistakes while they are still small and easy to fix.
- Encourage safer, cleaner changes.

**Impact**
- Less time fixing bugs later.
- Better quality with the same team size.

**Example**
- “You added a new button, but you didn’t say what happens if the user clicks it twice. Add a rule so it doesn’t create duplicates.”

3) **CI/CD Intelligence** “How healthy is the testing robot?”

**What it does**
- Watches your automatic checks over time and shows:
  - how often they succeed,
  - where they fail,
  - and simple explanations for failures.

**What we want to do**
- Understand failures quickly instead of guessing.
- Spot “sometimes it fails, sometimes it passes” behavior early.

**Impact**
- Faster fixes.
- More trust that “green = safe” and “red = not safe”.

**Example**
- “It failed because something it needed was missing today (like a missing ingredient). Fix: add the ingredient or pin the version.”

4) **Defect Prediction** “Which LEGO piece breaks most?”

**What it does**
- Finds files/areas that change a lot and often need fixes, and marks them as higher risk.

**What we want to do**
- Know where to focus extra testing and extra careful review.

**Impact**
- You spend time on the parts most likely to cause problems.
- Fewer bugs escape into the real world.

**Example**
- “This payments/checkout area changed many times and had many ‘fix’ changes → test checkout first.”

5) **Release Gate** “Should we open the doors today?”

**What it does**
- Gives a simple decision before shipping:
  - **GO** (safe to ship),
  - **CONDITIONAL** (ship only if you fix a few things),
  - **NO-GO** (do not ship yet).
- Explains the biggest blocker in plain language.

**What we want to do**
- Prevent shipping when it’s obviously unsafe.
- Make the release decision clear and consistent.

**Impact**
- Fewer emergency rollbacks.
- Fewer “we shipped and immediately broke something.”

**Example**
- “NO-GO: many important checks are failing and there are still critical bugs open.”

6) **Monitoring** “Watch the city after it opens”

**What it does**
- Watches quality scores over days.
- Spots sudden drops (things that look unusual).
- When something looks wrong, it can trigger an **investigation** and suggest what might have caused it.

**What we want to do**
- Find problems quickly, close to when they start.
- Know where to look first when something feels off.

**Impact**
- Less time spent guessing.
- Smaller problems (caught early) instead of big outages (caught late).

**Example**
- “Today the data suddenly has many duplicates. Investigation hint: a recent change may be sending the same record twice.”

7) **Sprint Intelligence** “How did we do this week?”

**What it does**
- Summarizes how the work period went:
  - what got done,
  - what looked risky or unclear,
  - and how healthy the team’s delivery signals look.

**What we want to do**
- Give a simple story of progress and health.
- Help decide what to improve next.

**Impact**
- Less manual status reporting.
- Clear next actions (for example: “stabilize checks” or “clarify requirements earlier”).

**Example**
- “We finished many stories, but the automatic checks failed often → next sprint, focus on making checks stable.”


