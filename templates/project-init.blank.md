# Project Init - Blank

The same fields as the guided version, with no explanations. For authors who know
what they want and just need to fill it in.

This intake takes approximately 45-90 minutes. The goal of the first session is a
confirmed brief, not a drafted chapter.

## 1. Project basics
- Working title / subtitle:
- Genre / subgenre:
- One-line pitch:
- Why you:
- Why now:

## 2. Big idea (thesis)
- Controlling idea (one sentence):
- Promise to the reader:
- What this book is NOT:

## 3. Audience
- Primary reader (persona):
- What they already know/believe:
- The change you want in them:

## 4. Comps & positioning
- Comparable titles / comps (2-5 published books your reader already knows):
- Your differentiation:

## 5. Scope & structure
- Target length + chapter count:
- Structure type (argument-driven / narrative / chronological / modular / problem-solution / framework):
- The arc (how a reader's understanding shifts from chapter 1 to the end):

## 6. Tone & voice
- Tone adjectives (3-5):
- POV + tense (first-person "I" / second-person "you" / third-person; present or past):
- Formality / register (conversational / professional / academic - where does yours sit?):
- Humor / personality:
- Writing samples (paste):
- Voices to emulate / avoid:
- Banned words / tics:

## 7. Research & evidence
- Evidence types:
- Rigor level (journalistic - every claim sourced, to personal essay - experience-led):
- Citation style:
- Primary research planned (interviews, surveys, or site visits you will conduct):

## 8. Constraints & logistics
- Deadline + cadence:
- Publishing path:
- Existing material to reuse:

## 9. Ethics, legal & disclosure
- Real people depicted:
- Sensitive topics/communities:
- Third-party material needing permission:

9.4 AI involvement in this book

9.4a Generated content
    Did or will AI produce prose that appears in the book (even if you edited
    it heavily afterward)?
    Answer (yes / no / unsure):

9.4b AI-assisted content
    Did or will AI assist with research, outlining, editing suggestions, or
    structural recommendations, while you wrote the prose?
    Answer (yes / no / unsure):

9.4c Disclosure stance
    Some publishers and platforms, including KDP, require disclosure when AI
    generated or substantially assisted in producing the text.
    Options:
      full    - disclose both generated and assisted use in the author's note
                and in platform metadata
      partial - disclose generated content only; note assisted use privately
                in your records
      none    - no AI use to disclose; the studio logs for your own records
    Your answer (full / partial / none):

## 10. Success & done
- What success looks like:

10.2 A chapter is "done" when... (Definition-of-Done checklist)

    Each item maps to a gate setting in .studio/config.json. The studio
    enforces checked items at session end. Leave unchecked to skip that check.
    Full config schema: .studio/config.json

    [ ] Claim coverage - every factual sentence has an EV anchor or [UNVERIFIED] tag
        Enforcement mode (warn / block, default warn): ___
        Maps to: gate.checks.claim_coverage.mode

    [ ] Voice drift - prose stays within the style-profile baseline
        Max drift score 0-100 (default 25, lower is stricter): ___
        Maps to: thresholds.drift_score_max

    [ ] Prompt scrub - no confidential or legally sensitive material in the chapter
        Enforcement mode (warn / block, default block): ___
        Maps to: gate.checks.prompt_scrub.mode

    [ ] Continuity - no unresolved characters, timelines, or terminology conflicts
        Enforcement mode (warn / block, default warn): ___
        Maps to: gate.checks.continuity.mode

    [ ] Thesis alignment - chapter explicitly serves the controlling idea
        (Judgment check; locked to warn-only in v1.)
        Maps to: gate.checks.thesis_alignment.mode

- Anything else:
