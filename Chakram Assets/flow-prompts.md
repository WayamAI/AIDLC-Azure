# Chakram brand imagery: prompt pack for Google Flow

Prompts for generating Chakram's 3D marks, hero images and short motion loops in Google Flow. The image prompts also work in Imagen and "Nano Banana"-style image models.

How to use a prompt: paste the **STYLE BLOCK**, then the asset's prompt, then the **NEGATIVE BLOCK**. If the tool has a separate field for exclusions, put the NEGATIVE BLOCK there. If it does not, append it to the prompt after the word `Exclude:`.

Setting names differ between tools and versions. Where this file names a setting, it describes the intent (for example "set the output to square, 1:1"); use whichever control in the tool does that.

Contents

1. Style system
2. 3D mark set (69 marks)
3. Hero and background imagery
4. Motion loops (optional)
5. Production checklist and wiring table

---

## 1. Style system

### 1.1 What the Chronos assets look like

The style below is taken from the shipped Chronos assets, not from its prompt file. Observations:

**Marks** (`Chronos/public/images/rcm/*.png`, 99 files, each 512 x 512 RGBA):

- One object per image, centred, filling roughly 70 to 85 percent of the frame, nothing cropped.
- Material is smooth moulded polymer with a satin-to-gloss finish. Edges are rounded and bevelled. Proportions are thick and toy-like, with a few large masses and very little fine detail.
- Colour is one saturated orange for most of the object. Lit faces go lighter orange, shaded faces and recesses go deep red-orange. The only second material is matte dark graphite, used for small parts (a latch, a strap, a wall plate, an inner core).
- Light is a soft key from the upper left with a weak fill. Highlights are broad and soft, with at most one narrow gloss streak.
- Camera is a three-quarter view from slightly above with little perspective distortion. A few marks are front-on (flat plates, the Wayam "W").
- No floor, no cast shadow, no reflection. Backgrounds were removed after generation.
- In the UI they sit at about 24 to 40 px beside KPI labels, stage names and page titles, on white cards over an `#F2F2F2` page. They are decorative: they never replace a number, label or control.

**Defects seen in the Chronos set that this pack is written to avoid:**

- Tall, thin objects (the dashboard mark) shrink to a sliver at 40 px. Keep every object close to square in overall proportion.
- Thin tube or ribbon shapes (the sparkline mark) turn to mush at small size. Use solid masses.
- Several marks have a pale fringe left by background removal, and two (the clearinghouse and plug marks) kept blurred grey remnants of the original backdrop. Generate on a flat, uniform background and defringe.
- Some marks picked up white or chrome highlights (the in-progress gear, the claim strap buckle). Keep highlights orange-tinted and ban chrome.
- Orange hue drifts between marks. Use one approved mark as a style reference for all the others.

**Login hero** (`Chronos/public/brand/login-bg.jpg`, 2752 x 1536, 16:9):

- A dark graphite machine hall seen from a balcony. Brushed graphite beams and railings. One large orange mechanism sits left of centre and is the only strong colour. Glowing orange channels carry small objects into the distance.
- Light comes from the orange parts themselves plus one warm wash in the upper left. Shallow depth of field.
- On the login page it is cropped to a panel of roughly 11:10 on the left of the screen, fades out along its right edge into the form panel, and carries a white headline in its bottom-left corner.
- The shipped file still has the generator's sparkle watermark in the bottom-right corner. Remove it from Chakram's files.

### 1.2 Chakram palette

| Role | Hex |
| --- | --- |
| Body orange | `#FC7F06` |
| Lit faces, highlights | `#FDA40B` |
| Shaded faces, recesses | `#DF4302` |
| Second material (graphite) | `#101010` to `#191919` |
| Light scene surfaces | `#FFFFFF` to `#F2F2F2` |
| Dark scene surfaces | `#000000` to `#101010` |

Rules:

- Orange is the only chromatic colour. State is never shown by hue: there is no green for pass and no red for fail. Each status mark is told apart by its shape.
- If an object needs a second material, it is graphite.
- No imagery contains text, letters or numbers. The UI sets type in Geist and Michroma; pictures stay wordless.

### 1.3 STYLE BLOCK for marks

Paste before every prompt in section 2.

```
Single 3D product-icon render of exactly one object, centred in a square 1:1 frame. Smooth moulded satin polymer with rounded, bevelled edges and thick, chunky proportions, like an injection-moulded desk toy. Shapes are simplified to a few large masses so the silhouette reads clearly at 40 pixels. Main colour is saturated orange #FC7F06, with lighter orange #FDA40B on lit faces and deep red-orange #DF4302 on shaded faces and in recesses. The only second material is matte dark graphite #101010, used for a minority of parts. One soft key light from the upper left and a weak fill from the right; broad soft highlights tinted orange, at most one narrow gloss streak. Camera at a three-quarter angle from slightly above, about 20 degrees of elevation, medium focal length with little perspective distortion, the whole object in sharp focus. The object fills about 80 percent of the frame with an even margin on all sides and nothing cropped. Background is one flat, uniform mid-grey #7A7A7A with no gradient, no floor, no horizon, no cast shadow and no reflection.
```

Why mid-grey: most image models do not output real transparency. A flat mid-grey separates cleanly from both the orange and the graphite, and any fringe left after removal is the least visible on both the light and the dark theme. If the tool can output a transparent background directly, use that and delete the last sentence of the block.

### 1.4 STYLE BLOCK for scenes

Paste before every prompt in section 3 and section 4.

```
Photoreal 3D architectural product render. A clean, quiet engineered space built from large simple forms. Saturated orange #FC7F06 is the only chromatic colour, with #FDA40B where it catches light and #DF4302 in its shadows; it is used for one main object and a small number of accents. Everything else is neutral: either matte white to light grey #F2F2F2, or brushed dark graphite #101010 to black, as the prompt states. Satin moulded polymer and brushed metal only. Soft directional light from the upper left. Slight depth of field with the main object sharp. Large areas of the frame are left empty and low in contrast.
```

### 1.5 NEGATIVE BLOCK

Paste after every prompt.

```
text, letters, numbers, digits, words, labels, captions, signage wording, logos, brand marks, trademarks, watermarks, signatures, generator sparkle mark, four-point star, user interface, screenshots, readable screens, people, faces, hands, characters, mascots, animals, extra objects, scattered props, clutter, busy background, patterned background, textured background, vignette, blue, green, purple, pink, red, lemon yellow, gold, chrome, mirror metal, white highlights blown out, wood, fabric, rust, dirt, scratches, wear, neon glow, lens flare, light rays, smoke, thin wires, hairline detail, tiny parts, religious symbols, weapons, blades, medical symbols, coins, currency
```

For marks, add these four terms to the same block: `cast shadow, ground reflection, depth-of-field blur, motion blur`.

### 1.6 Generation settings by asset class

| Asset class | Aspect ratio | Resolution | Background | Variations |
| --- | --- | --- | --- | --- |
| Marks | Square, 1:1 | Highest the tool offers (1024 px or more per side) | Transparent if the tool offers it; otherwise flat mid-grey `#7A7A7A`, removed afterwards | 4 per prompt, keep 1 |
| Login heroes | Landscape, 16:9 | Highest offered, at least 2560 px wide | Full scene, opaque | 4 per prompt, keep 1 per theme |
| Dashboard empty-state hero, 404 illustration | Landscape 16:9 and square 1:1 respectively | At least 2048 px on the long side | Flat mid-grey, removed afterwards, so one file works on both themes | 4 per prompt |
| Landing hero | Widest landscape offered (21:9 if available, else 16:9 and crop) | Highest offered | Full scene, opaque | 4 per prompt |
| Social card background | Landscape 16:9, cropped to 1200 x 630 | At least 2400 px wide | Full scene, opaque | 4 per prompt |
| Motion loops | 1:1 for loaders, 16:9 for ambient | Highest offered | Opaque | 2 to 4 per prompt |

Consistency:

1. Generate `mark-chakram-wheel`, `mark-deployments` and `mark-test-suite` first. Between them they cover a flat form, a boxy form and a multi-part form. Pick the best of each and get them approved.
2. Use one approved mark (the wheel is the best choice) as a style reference image for every other mark, if the tool accepts a reference image. Ask it to follow the reference for material, lighting and colour only, not for subject.
3. If the tool exposes a seed, record the seed of each approved image next to its id. Reuse the approved wheel's seed as the starting point for the rest. If no seed is exposed, rely on the reference image.
4. Generate marks in the groups given in section 2 and review each group as a contact sheet, so near-duplicates and hue drift show up early.
5. For the heroes, approve the dark login hero first and use it as the reference for the landing hero, the social card and the ambient loop.
6. Change one thing per retry. If a result has the wrong form, edit the `Form` line. If it has the wrong colour or finish, do not edit the prompt; regenerate with the reference image.

### 1.7 The Chakram wheel

Several prompts depict the brand wheel. The logo (`frontend/public/brand/chakram-mark-512.png`) is a white wheel on an orange rounded tile: five identical curved segments in a ring, separated by narrow slanted gaps that all lean the same way, around a separate ring-shaped hub with a round hole. The segments do not touch the hub.

Where a prompt depicts the wheel, attach `chakram-mark-512.png` as a subject reference if the tool accepts one. The prompts describe the wheel in words as well, so they work without it. The wheel must always read as a machined ring part. It must never have teeth, spokes, blades or sharpened edges.

---

## 2. 3D mark set

69 marks. Every prompt uses the same seven lines: Subject, Form, Material, Lighting, Camera, Background, Composition. Lighting and Background mostly repeat the style block; they are kept on every prompt so each one can be read and edited on its own.

Each mark is designed for display at 40 to 64 px. Empty-state marks are also shown larger (96 to 160 px), so they may carry slightly more detail.

Ids are stable. The id is the filename: `mark-dashboard` is saved as `mark-dashboard.png`.

### 2.1 Brand

#### mark-chakram-wheel

- Used: brand mark in 3D. Loading states, about dialog, sidebar footer, style reference for all other marks.
- Metaphor: the logo's five-segment wheel as a solid machined ring.

```
Subject: a flat ring-shaped wheel made of five identical thick arc segments around a small central hub.
Form: the five segments form a circle and are separated from each other by narrow slanted gaps that all lean in the same rotational direction, like the leaves of a camera iris. At the centre is a separate ring-shaped hub with a round hole. A clear gap separates the hub from the segments. The wheel is about one sixth as thick as it is wide. No spokes, no teeth, no sharp edges.
Material: segments and hub in satin orange; the inner side walls of the gaps in deep red-orange.
Lighting: style-block lighting; one soft highlight sweeping across the upper-left segments.
Camera: almost front-on, tilted back about 15 degrees so the thickness of the rim is visible.
Background: flat mid-grey per style block.
Composition: wheel centred, filling 80 percent of the frame, one gap pointing to the upper right.
```

### 2.2 Navigation sections

#### mark-section-build

- Used: sidebar section "Build & Code".
- Metaphor: two construction bricks snapped together.

```
Subject: two studded toy construction bricks locked together.
Form: a lower brick two studs wide and four long, and an upper brick of the same size snapped on, offset by two studs so it overhangs one end. Round studs on top, blank and flat.
Material: upper brick orange, lower brick graphite.
Lighting: style-block lighting.
Camera: three-quarter view from above, long side running lower left to upper right.
Background: flat mid-grey per style block.
Composition: the pair centred, filling 80 percent of the frame width.
```

#### mark-section-requirements

- Used: sidebar section "Requirements & Planning".
- Metaphor: a rolled plan sheet with one end unrolled.

```
Subject: a thick rolled plan sheet, partly unrolled.
Form: a fat cylinder roll lying on its side, with a short flat length of sheet unrolled toward the viewer and ending in a slight upward curl. The sheet is thick like rubber matting. Its surface is blank. A wide band wraps the roll.
Material: sheet orange on the outside and deep red-orange on the inside face; the band graphite.
Lighting: style-block lighting.
Camera: three-quarter view from above, roll at the back, flat end toward the lower left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-section-testing

- Used: sidebar section "Testing & Quality".
- Metaphor: one conical laboratory flask.

```
Subject: one conical laboratory flask.
Form: a wide cone-shaped body with a flat base, a short straight neck and a thick rounded lip. Solid and opaque, not transparent. A broad band around the lower third of the body marks a fill level. No scale marks.
Material: flask body orange; the lower fill band and the lip ring graphite.
Lighting: style-block lighting; one vertical gloss streak on the left of the body.
Camera: three-quarter view from slightly above, flask upright.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-section-release

- Used: sidebar section "Release & Ops".
- Metaphor: a milestone flag on a short pole.

```
Subject: a small milestone flag on a short pole with a round base.
Form: a thick rectangular flag with a V-shaped notch cut into its free end, frozen in a single gentle wave, as thick as a slab of rubber. A short stout pole with a ball finial. A low disc base. The flag is blank.
Material: flag orange; pole and base graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, flag flying to the right.
Background: flat mid-grey per style block.
Composition: centred, pole left of centre, flag filling the right two thirds of the frame.
```

### 2.3 Pages and features

#### mark-dashboard

- Used: `/dashboard` page title, home link.
- Metaphor: a control console with two dials and a slider.

```
Subject: a small desktop control console.
Form: a wedge-shaped box with a sloped top face. On the sloped face sit two large round dial knobs side by side and, below them, one horizontal slider with a block handle. No screen, no markings.
Material: console body orange; knobs and slider handle graphite.
Lighting: style-block lighting.
Camera: three-quarter view from above, sloped face toward the viewer.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame, overall proportion close to square.
```

#### mark-pipeline

- Used: `/pipeline` page title (SDLC Pipeline).
- Metaphor: a run of thick pipe with flanged joints.

```
Subject: a short run of thick pipe in an S shape.
Form: three fat pipe segments joined by two right-angle bends: one horizontal at the lower left, one vertical in the middle, one horizontal at the upper right. Each joint has a wide flange collar. Both open ends face outward and show a dark bore. The pipe is as thick as a quarter of the frame.
Material: pipe segments orange; flange collars graphite; bores deep red-orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame, running lower left to upper right.
```

#### mark-ai-app-builder

- Used: `/ai-ide` page title (AI App Builder).
- Metaphor: an upright app panel assembled from tiles, the last tile dropping in.

```
Subject: an upright rectangular panel assembled from modular tiles, with the last tile about to drop into place.
Form: a thick portrait panel with rounded corners standing on its short edge. Its front is divided into four blocks: one wide header block across the top and three blocks below. The lower-right block is missing and floats just in front of its empty socket, tilted slightly. All faces blank.
Material: panel frame graphite; the four blocks orange; the empty socket deep red-orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, panel turned 30 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-ai-workspace

- Used: `/workspace` page title; pipeline stage "Workspace".
- Metaphor: three blank keyboard keys on a plate.

```
Subject: three large blank mechanical keyboard keys on a small base plate.
Form: three square keycaps with dished tops in an L arrangement: two side by side and one above the left key. The upper key is pressed halfway down. No legends on any key.
Material: keycaps orange; base plate graphite.
Lighting: style-block lighting; soft highlight in the dish of each keycap.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-code-review

- Used: `/code-review` page title; pipeline stage "Code Review".
- Metaphor: a slab of ridged lines with a comment bubble attached.

```
Subject: a slab with raised horizontal bars and a chunky speech-bubble block attached to it.
Form: a thick upright rectangular slab with four raised horizontal bars of different lengths on its front. A fat rounded speech-bubble block, with a short tail, overlaps the slab's lower-right corner and points at the third bar. The bubble is blank.
Material: slab graphite; bars orange; speech bubble orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, slab turned 25 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, bubble in front, filling 80 percent of the frame.
```

#### mark-code-impact

- Used: `/code-impact` page title.
- Metaphor: one node joined by rods to four smaller nodes.

```
Subject: a node-and-rod structure: one large sphere joined to four smaller spheres.
Form: a large central sphere with four thick straight rods radiating to four smaller spheres at uneven angles and lengths. One of the small spheres is noticeably larger than the other three. Rods are thick, about a third of the small spheres' diameter.
Material: central sphere and the larger outer sphere orange; rods and the three small spheres graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame, overall outline roughly square.
```

#### mark-prd-generator

- Used: `/prd` page title.
- Metaphor: a thick comb-bound document.

```
Subject: a thick bound document.
Form: a portrait block of pages about one fifth as thick as it is wide, bound along its left edge by a row of six large rings. The top-right corner of the cover is folded over. The cover has three raised blank bars, one long and two short.
Material: cover and raised bars orange; binding rings and page edges graphite.
Lighting: style-block lighting.
Camera: three-quarter view from above, document lying tilted with its top edge raised.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-requirements

- Used: `/requirements` page title; guided workflow stage "Requirement".
- Metaphor: a pad of sticky notes, the top note curling up.

```
Subject: a square pad of sticky notes.
Form: a thick square block of stacked notes. The top note is peeling upward from its lower-right corner in one smooth curl. The top note carries one short raised bar near its upper-left corner and is otherwise blank.
Material: top note and pad orange; the underside of the curl and the pad's side edges deep red-orange; the short raised bar graphite.
Lighting: style-block lighting; highlight along the curl.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-requirements-intelligence

- Used: `/requirements-intelligence` page title.
- Metaphor: a four-piece jigsaw with one piece lifted out.

```
Subject: a square jigsaw puzzle of four pieces with one piece lifted out.
Form: four thick interlocking puzzle pieces forming a square slab, each with rounded knobs and sockets. Three pieces lie flat and joined. The fourth, at the upper right, hovers above its place, tilted.
Material: the three seated pieces orange; the lifted piece graphite; the exposed edges of the empty place deep red-orange.
Lighting: style-block lighting.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-sprint-intelligence

- Used: `/sprint-intelligence` page title.
- Metaphor: a flip desk calendar with blank pages.

```
Subject: a flip desk calendar block with blank pages.
Form: a wedge-shaped stand holding a thick stack of square pages on two large rings at the top. The front page is blank except for a grid of six shallow square dents in two rows. The lower-left dent holds a raised square peg.
Material: pages orange; stand and rings graphite; the raised peg graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 25 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-synthetic-data

- Used: `/synthetic-data` page title.
- Metaphor: a mould tray turning out identical cubes.

```
Subject: a mould tray with four identical cubes.
Form: a low square tray with four square cavities in a two-by-two grid. Three cavities hold identical cubes sitting half out of the tray. The fourth cube, at the upper right, has lifted clear and hovers above its cavity.
Material: tray graphite; all four cubes orange; the empty cavity deep red-orange.
Lighting: style-block lighting.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-repo-baseline

- Used: `/repo-baseline` page title (Repo Test Baseline).
- Metaphor: a surveyor's level on a tripod.

```
Subject: a surveyor's level on a short tripod.
Form: a short fat cylinder body with one large round lens at the front, mounted on a tripod with three thick stubby legs spread wide. The legs are short, so the whole object is about as wide as it is tall.
Material: instrument body orange; lens face and tripod legs graphite.
Lighting: style-block lighting; one soft highlight on the lens rim.
Camera: three-quarter view from slightly above, lens facing the lower left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-doc-tests

- Used: `/doc-tests` page title (Doc-Driven Tests).
- Metaphor: an open book with two cards rising out of it.

```
Subject: an open book with two cards rising from its pages.
Form: a thick book lying open with both halves curving up from the spine. Two thick blank rectangular cards rise from the right-hand page, one behind and above the other, both tilted slightly forward.
Material: book cover graphite; pages orange; the two cards orange with deep red-orange edges.
Lighting: style-block lighting.
Camera: three-quarter view from above, spine running toward the viewer.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-test-suite

- Used: `/generated-tests` page title; guided workflow stage "Test Suite".
- Metaphor: three test tubes in a rack.

```
Subject: three test tubes standing in a rack.
Form: a low rack made of a base bar and an upper bar with three holes, joined by two end posts. Three fat, round-bottomed tubes stand in it, each with a thick lip. The tubes are solid and opaque. The three tubes are the same height.
Material: tubes orange; rack graphite.
Lighting: style-block lighting; one vertical gloss streak on each tube.
Camera: three-quarter view from slightly above, rack turned 25 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-test-execution

- Used: `/test-execution` page title; guided workflow stage "Execution"; pipeline stage "Test Run".
- Metaphor: a play wedge on a round puck.

```
Subject: a thick play-button wedge on a round puck.
Form: a low cylindrical puck with a bevelled rim. On its top face sits a thick triangular wedge with heavily rounded corners, pointing to the right, raised well above the surface.
Material: puck graphite; wedge orange.
Lighting: style-block lighting.
Camera: three-quarter view from above, puck tilted toward the viewer.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-live-test-runner

- Used: `/live-testing` and `/live-test-runner` page title.
- Metaphor: a browser window slab being clicked by a pointer.

```
Subject: a blank browser-window slab with a large pointer arrow touching it.
Form: a thick landscape slab with rounded corners. A header strip across its top holds three small round studs at the left. The rest of the front is blank. A chunky pointer arrow, the kind used as a mouse cursor, stands in front of the slab's lower right with its tip touching the surface inside one shallow raised ring.
Material: slab body graphite; header strip and studs orange; pointer arrow orange; ring orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, slab turned 20 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, pointer in front, filling 80 percent of the frame.
```

#### mark-risk-ranking

- Used: `/prioritization` page title; guided workflow stage "Risk Ranking".
- Metaphor: a three-step podium with a sphere on the top step.

```
Subject: a three-step winners' podium with a sphere on the top step.
Form: three joined square blocks: a tall block in the centre, a medium block on the left and a low block on the right. A sphere sits on the centre block. The front faces are blank.
Material: podium orange; sphere graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-change-hotspots

- Used: `/defect-prediction` page title (Change Hotspots).
- Metaphor: a grid of tiles with one tile raised.

```
Subject: a three-by-three grid of square tiles with one tile raised high.
Form: nine thick square tiles set in a low tray with narrow gaps between them. Eight tiles sit level. The tile one place right of centre stands three times taller than the others, like a column.
Material: the eight level tiles graphite; the tall tile orange with lighter orange on top; tray graphite.
Lighting: style-block lighting; the top of the tall tile is the brightest area.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-root-cause

- Used: `/root-cause` page title.
- Metaphor: a row of falling dominoes, the first one a different colour.

```
Subject: a row of four blank dominoes falling in sequence.
Form: four thick blank slabs in a line. The first, at the left, has tipped fully against the second. The second and third lean progressively less. The fourth stands upright. No dots on any slab.
Material: the first slab graphite; the other three orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, row running from left to right and slightly away from the viewer.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-test-selection

- Used: `/test-selection` page title.
- Metaphor: tongs lifting one cube from a row.

```
Subject: a pair of tongs lifting one cube out of a row of three.
Form: three identical cubes in a row along the bottom. The middle cube is lifted clear above the row, gripped between the two flat tips of a pair of thick tongs that come down from the top of the frame as a narrow V.
Material: the lifted cube orange; the two cubes left in the row graphite; tongs orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, tongs entering from above but fully inside the frame, filling 80 percent of the frame height.
```

#### mark-self-healing

- Used: `/self-healing` page title (Self-Healing Tests).
- Metaphor: a wrench gripping a hex nut.

```
Subject: a short open-ended wrench gripping a large hex nut.
Form: a stubby wrench with a thick handle and an open jaw closed around a fat six-sided nut with a round hole. The wrench is short, about twice as long as the nut is wide.
Material: wrench orange; nut graphite.
Lighting: style-block lighting; soft highlight along the handle.
Camera: three-quarter view from above, wrench lying diagonally from lower left to upper right with the nut at the upper right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame diagonal.
```

#### mark-deployments

- Used: `/deployments` page title.
- Metaphor: one intermodal shipping container.

```
Subject: one shipping container.
Form: a short, stout box about one and a half times as long as it is tall, with six wide vertical ridges along its side, a plain end with two door panels, and block corner fittings at all eight corners. No markings.
Material: container walls orange; corner fittings and door bars graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, showing the long side, the door end and the roof.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-release-gate

- Used: `/release-gate` page title.
- Metaphor: a three-arm turnstile.

```
Subject: a waist-height tripod turnstile.
Form: a stout rectangular pedestal with a slanted top. From the slanted face a round hub projects, carrying three thick short arms spaced evenly like a tripod, each ending in a rounded cap. One arm points horizontally across the passage.
Material: pedestal graphite; hub and three arms orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, arms toward the lower left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-ci-intelligence

- Used: `/ci-intelligence` page title.
- Metaphor: a small factory robot arm holding a cube.

```
Subject: a small industrial robot arm holding a cube.
Form: a round base, a thick lower arm, a large round elbow joint, a thick upper arm and a two-finger gripper holding one cube. The arm is bent into an inverted V so the whole object is about as wide as it is tall.
Material: arm segments orange; base, elbow joint and gripper graphite; cube orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, seen from the side.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-anomaly-sandbox

- Used: `/monitoring` page title (Anomaly Sandbox).
- Metaphor: a row of pegs with one tall outlier.

```
Subject: a row of seven round pegs on a base bar, one much taller than the rest.
Form: a long low base bar carrying seven thick cylindrical pegs with domed tops. Six pegs are short and nearly equal in height. The fifth from the left is three times taller.
Material: base bar and the six short pegs graphite; the tall peg orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, bar running left to right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-incidents

- Used: `/incidents` page title.
- Metaphor: a warning beacon lamp.

```
Subject: a rotating warning beacon lamp.
Form: a tall rounded dome sitting on a short cylindrical base with a wide collar. Inside the dome, faintly visible, is a single block-shaped reflector. The dome is solid and opaque with a gloss finish.
Material: dome orange, slightly brighter than the standard body orange but with no glow outside the object; base and collar graphite.
Lighting: style-block lighting; one curved gloss streak on the dome.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-connectors

- Used: `/settings/connectors` page title.
- Metaphor: three blank keys on a ring.

```
Subject: three blank keys on a split ring.
Form: a thick split ring holding three chunky flat keys fanned apart. Each key has a round head with a hole and a short blade with two or three large square notches. The three keys have different notch patterns. No engraving.
Material: keys orange; ring graphite.
Lighting: style-block lighting.
Camera: front-on, tilted back 15 degrees.
Background: flat mid-grey per style block.
Composition: ring at the top centre, keys fanning downward, filling 80 percent of the frame.
```

#### mark-profile

- Used: `/profile` page title.
- Metaphor: a blank badge on a lanyard clip.

```
Subject: a blank identity badge hanging from a clip.
Form: a thick portrait card with rounded corners and a slot at the top, hanging from a short strap loop and a spring clip. The front of the card has one raised blank disc in its upper half and two raised blank bars below it. No face, no text.
Material: card orange; raised disc and bars deep red-orange; strap and clip graphite.
Lighting: style-block lighting.
Camera: three-quarter view, card turned 20 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-ai-usage

- Used: `/cost-tracker` page title (AI Usage).
- Metaphor: a round utility meter with one needle.

```
Subject: a round utility meter.
Form: a short fat cylinder housing facing the viewer, with a thick rim. On its face, one thick needle points to the upper right from a central boss, over a raised arc that runs three quarters of the way around the face. Five large square notches are cut along the arc. No numerals.
Material: housing graphite; face orange; arc and needle deep red-orange and graphite respectively.
Lighting: style-block lighting.
Camera: three-quarter view, face turned 20 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

### 2.4 Workflow and pipeline stages

The guided workflow stages and three of the pipeline stages show the same concept as an existing page, so they reuse that page's mark. This follows Chronos, where a stage and its page share one mark, and it keeps one object per concept across the product.

| Stage | Mark |
| --- | --- |
| Guided workflow: Requirement | `mark-requirements` |
| Guided workflow: Test Suite | `mark-test-suite` |
| Guided workflow: Execution | `mark-test-execution` |
| Guided workflow: Risk Ranking | `mark-risk-ranking` |
| Guided workflow: Synthetic Data (supporting step) | `mark-synthetic-data` |
| Pipeline: Workspace | `mark-ai-workspace` |
| Pipeline: Code Review | `mark-code-review` |
| Pipeline: Test Run | `mark-test-execution` |
| Pipeline: Deploy | `mark-stage-deploy` |
| Pipeline: Report | `mark-stage-report` |

#### mark-stage-deploy

- Used: pipeline stage "Deploy".
- Metaphor: one large push-button on a square base.

```
Subject: one large push-button on a square base.
Form: a thick square base block with rounded corners. A wide collar ring sits on top, and a large low dome button rises from the collar. The button is as wide as two thirds of the base.
Material: base and collar graphite; dome button orange.
Lighting: style-block lighting; one soft highlight on the upper left of the dome.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-stage-report

- Used: pipeline stage "Report"; PDF and export actions.
- Metaphor: a small printer block feeding out a blank strip.

```
Subject: a small printer block with a blank paper strip coming out of it.
Form: a compact rounded box with a slot across its top. A wide, thick strip of paper rises from the slot and curls forward and down over the front in one smooth bend. The strip carries three raised blank bars of different lengths.
Material: printer block graphite; paper strip orange; raised bars deep red-orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

### 2.5 KPI and status concepts

Status is carried by shape only. The five release-verdict marks are a family of plates on a short post, told apart by outline: circle, inverted triangle, octagon, hollow diamond, and no plate.

#### mark-kpi-pass-rate

- Used: "Pass rate" KPI tile.
- Metaphor: a ring that is four fifths filled.

```
Subject: a thick ring divided into a long arc and a short arc.
Form: a fat torus standing upright facing the viewer. About four fifths of the ring is one continuous arc. The remaining fifth, at the upper right, is a separate arc of the same thickness, set apart by two narrow gaps.
Material: the long arc orange; the short arc graphite.
Lighting: style-block lighting.
Camera: almost front-on, tilted back 15 degrees.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-kpi-passed

- Used: "Passed" count; passed status on results.
- Metaphor: a solid check form on a disc.

```
Subject: a thick three-dimensional check mark standing on a round disc.
Form: a low disc with a bevelled rim. On it stands a chunky check-mark shape, extruded as deep as its strokes are wide, with rounded ends. The short stroke is on the left and the long stroke rises to the upper right.
Material: check form orange; disc graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-kpi-failed

- Used: "Failed" count; failed status on results.
- Metaphor: a solid cross form on a disc.

```
Subject: a thick three-dimensional diagonal cross standing on a round disc.
Form: a low disc with a bevelled rim. On it stands a chunky X shape made of two equal bars crossing at right angles, extruded as deep as the bars are wide, with rounded ends.
Material: cross form orange with deep red-orange side faces; disc graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-kpi-skipped

- Used: "Skipped" and "Not checked" counts.
- Metaphor: an empty square frame.

```
Subject: an empty square frame standing upright.
Form: a thick square frame with rounded corners and a large square opening through its centre. Nothing inside the opening. The frame's bars are about one fifth of its width.
Material: frame graphite with a thin orange inner lip around the opening.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 25 degrees to the right so the depth of the frame is visible.
Background: flat mid-grey per style block, visible through the opening.
Composition: centred, filling 80 percent of the frame.
```

#### mark-kpi-duration

- Used: "Duration" KPI; run time on execution rows.
- Metaphor: a stopwatch with one hand and no numerals.

```
Subject: a stopwatch.
Form: a fat round case with a thick rim, a large crown button on top and one smaller button at the upper right. The face is blank except for one thick hand pointing to the upper right from a central boss, and four large square markers at the quarter positions.
Material: case orange; face deep red-orange; hand, markers and buttons graphite.
Lighting: style-block lighting.
Camera: almost front-on, tilted back 15 degrees and turned 15 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-kpi-known-failure

- Used: "Known failure" badge and count.
- Metaphor: a cracked cube with a blank tag tied to it.

```
Subject: a cracked cube with a blank tag tied to it.
Form: a cube with rounded edges and one wide jagged crack running from its top face down the front, open enough to see into. A thick blank tag with a clipped corner and a round hole hangs from a short cord looped around the cube's upper-right corner.
Material: cube orange; the inside of the crack deep red-orange; tag and cord graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, tag hanging at the lower right, filling 80 percent of the frame.
```

#### mark-kpi-high-priority

- Used: "High priority" count and priority badges.
- Metaphor: two stacked chevrons pointing up.

```
Subject: two thick chevron blocks stacked one above the other, both pointing up.
Form: two identical V-shaped blocks turned point upward, like roof shapes, the upper one floating a short distance above the lower one. Each is extruded as deep as its arms are wide, with rounded ends.
Material: upper chevron orange; lower chevron deep red-orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 20 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-kpi-cases-ranked

- Used: "Cases ranked" KPI.
- Metaphor: three bars of decreasing length, each with a bullet sphere.

```
Subject: three horizontal bars stacked in a column, sorted from longest to shortest.
Form: three thick pill-shaped bars lying one above another with small gaps. The top bar is the longest and the bottom bar the shortest. All three are aligned at their left ends, and a sphere sits at the left of each bar.
Material: the top bar orange; the middle and bottom bars graphite; all three spheres orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-kpi-ai-calls

- Used: "AI calls" KPI on AI Usage and dashboards.
- Metaphor: an arrow passing through a ring.

```
Subject: a thick arrow passing through an upright ring.
Form: a fat torus standing upright, seen at an angle. A short, thick arrow with a broad triangular head passes through the middle of the ring from lower left to upper right, with its head already through.
Material: arrow orange; ring graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-kpi-tokens

- Used: "Tokens" KPI on AI Usage.
- Metaphor: a small heap of blank square tiles.

```
Subject: a small heap of three blank square tiles.
Form: three identical thick square tiles with rounded corners and a shallow bevel, like blank game tiles. Two lie flat and overlapping; the third leans against them on its edge. All faces are blank.
Material: two tiles orange; the leaning tile graphite.
Lighting: style-block lighting.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-kpi-ci-failure-rate

- Used: "CI run failure rate" KPI.
- Metaphor: a chain with its middle link broken.

```
Subject: a short chain of three links with the middle link broken.
Form: three very thick oval chain links in a horizontal row. The outer two are whole. The middle link is snapped into two C-shaped halves that have pulled apart, leaving a clear gap, each half still hooked through its neighbour and hanging at an angle.
Material: the two whole links graphite; the two broken halves orange with deep red-orange break faces.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-kpi-successful-runs

- Used: "Successful runs" KPI.
- Metaphor: a three-slot tray with every slot filled.

```
Subject: a tray with three slots, each holding a cube.
Form: a long low tray with three square slots in a row. Each slot holds one cube sitting level, with its top half above the tray. All three cubes are identical and evenly spaced.
Material: tray graphite; all three cubes orange.
Lighting: style-block lighting.
Camera: three-quarter view from above, tray running lower left to upper right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-kpi-commits-analysed

- Used: "Commits analysed" KPI on Change Hotspots and Code Impact.
- Metaphor: three beads on a rod with a lens ring around the middle one.

```
Subject: a straight rod carrying three spheres, with a ring framing the middle sphere.
Form: a thick rod running diagonally. Three spheres of equal size are threaded on it at even spacing. A thick ring on a short stubby handle is held in front of the middle sphere, like a lens frame with no glass.
Material: rod graphite; the two outer spheres graphite; the middle sphere orange; lens ring and handle orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, rod running lower left to upper right, filling 80 percent of the frame.
```

#### mark-kpi-incidents-open

- Used: "Open incidents" KPI.
- Metaphor: a pipe stub with an open split.

```
Subject: a short length of thick pipe with an open split in its wall.
Form: a fat straight pipe stub with a flange collar at each end. A wide jagged split runs along the top of the pipe wall. Three large bead-shaped drops rise from the split in a short arc.
Material: pipe orange; flange collars graphite; inside of the split deep red-orange; drops orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, pipe running lower left to upper right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-kpi-incidents-resolved

- Used: "Resolved incidents" KPI.
- Metaphor: the same pipe stub with a bolted repair clamp.

```
Subject: a short length of thick pipe with a wide repair clamp bolted around its middle.
Form: a fat straight pipe stub with a flange collar at each end. A wide band clamp wraps the middle third of the pipe, closed on top by a raised lug with two large bolt heads. No split and no drops.
Material: pipe orange; flange collars graphite; clamp band and bolts graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, pipe running lower left to upper right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-verdict-go

- Used: Release Gate verdict "GO".
- Metaphor: a round plate on a post with a forward arrow.

```
Subject: a round plate on a short post, carrying a raised arrow.
Form: a thick circular plate with a bevelled rim, facing the viewer, mounted on a short stout post with a small round foot. On the plate's face is one raised thick arrow pointing straight up. No wording.
Material: plate orange; arrow lighter orange #FDA40B; post and foot graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, plate turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, plate filling the upper three quarters of the frame.
```

#### mark-verdict-conditional

- Used: Release Gate verdict "CONDITIONAL".
- Metaphor: an inverted-triangle plate on a post.

```
Subject: an inverted-triangle plate on a short post.
Form: a thick triangular plate with heavily rounded corners, point downward, facing the viewer, mounted on a short stout post with a small round foot. The plate has a wide raised border and a blank recessed centre. No wording.
Material: plate border orange; recessed centre graphite; post and foot graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, plate turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, plate filling the upper three quarters of the frame.
```

#### mark-verdict-no-go

- Used: Release Gate verdict "NO-GO".
- Metaphor: an octagonal plate on a post with a horizontal bar.

```
Subject: an octagonal plate on a short post, carrying one horizontal bar.
Form: a thick eight-sided plate with a bevelled rim, facing the viewer, mounted on a short stout post with a small round foot. Across the middle of the plate's face runs one raised thick horizontal bar with rounded ends. No wording.
Material: plate orange; bar graphite; post and foot graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, plate turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, plate filling the upper three quarters of the frame.
```

#### mark-verdict-insufficient-data

- Used: Release Gate verdict "Insufficient data".
- Metaphor: a hollow diamond frame on a post.

```
Subject: a hollow diamond-shaped frame on a short post.
Form: a thick square frame turned 45 degrees to stand on one corner, with a large open centre, facing the viewer, mounted on a short stout post with a small round foot. The frame's bars are about one fifth of its width. Nothing inside the opening.
Material: frame orange; post and foot graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, frame turned 15 degrees to the right.
Background: flat mid-grey per style block, visible through the opening.
Composition: centred, frame filling the upper three quarters of the frame.
```

#### mark-verdict-not-evaluated

- Used: Release Gate "Not evaluated" state; any check that has not run.
- Metaphor: a bare post with an empty bracket.

```
Subject: a short post with an empty mounting bracket and no plate.
Form: a short stout post with a small round foot. At its top is a wide U-shaped bracket with two round bolt holes, facing the viewer and holding nothing.
Material: post and foot graphite; bracket orange.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, bracket turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height; the post is drawn stout so the object is at least half as wide as it is tall.
```

### 2.6 Integrations

These marks suggest what each integration does. They do not depict any company's logo, mascot, letterform or signature shape. Do not put a company or product name in the prompt; some models will draw the logo if they see the name.

#### mark-int-source-control

- Used: GitHub connector tile and source-control status.
- Metaphor: a rail that branches and merges, with nodes.

```
Subject: a rail that splits into two branches and rejoins.
Form: a thick rod running bottom to top. Partway up, a second rod curves out to the right, runs parallel for a short distance and curves back in to rejoin the first. Four spheres sit on the structure: one at the bottom, one on each branch at mid height, and one at the top where they rejoin.
Material: rods graphite; the four spheres orange.
Lighting: style-block lighting.
Camera: front-on, tilted back 15 degrees and turned 15 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height; the branch is wide enough that the object is two thirds as wide as it is tall.
```

#### mark-int-issue-tracker

- Used: Jira connector tile and issue links.
- Metaphor: a blank ticket with notched ends.

```
Subject: a thick blank ticket.
Form: a landscape rectangular slab with a half-round notch cut into the middle of each short end. A row of five round holes runs top to bottom one third of the way from the left, like a tear-off line. The larger part carries two raised blank bars. No wording.
Material: ticket orange; raised bars deep red-orange; hole interiors graphite.
Lighting: style-block lighting.
Camera: three-quarter view from above, ticket lying tilted with its right end raised.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-int-hosting

- Used: Vercel connector tile and deploy target.
- Metaphor: a cloud form on a round landing pad.

```
Subject: a chunky cloud shape resting on a round landing pad.
Form: a cloud made of four merged rounded lobes with a flat underside, sitting on a low wide disc. A short cylindrical stem joins the cloud's underside to the centre of the disc. No triangle shapes anywhere.
Material: cloud orange; disc and stem graphite.
Lighting: style-block lighting; soft highlights on the upper-left lobes.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-int-chat-alerts

- Used: Slack connector tile and notification settings.
- Metaphor: a handheld two-way radio.

```
Subject: a handheld two-way radio.
Form: a stout rounded brick body with a short thick antenna stub at the top left and a round knob at the top right. The front has a grille of four wide horizontal slots in its upper half and one large blank button below. No display, no markings.
Material: body orange; antenna, knob, button and grille slots graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 25 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame height.
```

#### mark-int-observability

- Used: Datadog connector tile and metrics source.
- Metaphor: a dish antenna on a short stand.

```
Subject: a small dish antenna on a short stand.
Form: a deep round dish tilted up and to the right, with a short central feed stub ending in a ball. The dish sits on a thick neck joint above a low round base. The stand is short, so the object is as wide as it is tall.
Material: dish orange with a deep red-orange interior; feed stub, neck and base graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-int-ai-model

- Used: AI model provider (Ollama) connector tile; "AI provider" status.
- Metaphor: a processor chip with a raised dome core.

```
Subject: a square processor chip with a raised dome at its centre.
Form: a thick square package with a clipped corner. Each of the four sides carries four short, wide, blunt pins. On top, a smooth low dome rises from a square recess in the centre. No markings.
Material: package and pins graphite; dome orange, slightly brighter than the standard body orange but with no glow outside the object.
Lighting: style-block lighting; one soft highlight on the dome.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

### 2.7 Empty states

Shown at 96 to 160 px above a line of explanatory text, as well as at 40 to 64 px in compact panels.

#### mark-empty-no-requirements

- Used: Requirements page and dashboard when no requirement exists.
- Metaphor: a blank notepad with a pencil resting on it.

```
Subject: a blank notepad with a short pencil lying across it.
Form: a thick square pad with a bound top edge. Its top sheet is completely blank. A short fat pencil with a blunt cone tip lies diagonally across the pad from lower left to upper right.
Material: pad orange with a graphite binding strip; pencil body graphite with an orange tip.
Lighting: style-block lighting.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-empty-no-runs

- Used: Test Execution, CI Intelligence, Pipeline and Deployments when there are no runs.
- Metaphor: an empty conveyor belt.

```
Subject: a short section of conveyor belt with nothing on it.
Form: a flat belt looped around two large end rollers, carried on a low frame with four short legs. The belt surface is plain and empty. The section is about twice as long as it is tall.
Material: belt orange; rollers, frame and legs graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, belt running lower left to upper right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame width.
```

#### mark-empty-no-results

- Used: any filtered table or search with no matching rows.
- Metaphor: an open, empty drawer.

```
Subject: a small cabinet with one drawer pulled open and empty.
Form: a compact cube-shaped cabinet with one drawer pulled out more than halfway toward the viewer. The inside of the drawer is clearly visible and empty. The drawer front has one bar handle.
Material: cabinet graphite; drawer orange; drawer interior deep red-orange; handle graphite.
Lighting: style-block lighting; the drawer interior is lit enough to show it is empty.
Camera: three-quarter view from above.
Background: flat mid-grey per style block.
Composition: centred, drawer extending toward the lower left, filling 80 percent of the frame.
```

#### mark-empty-nothing-to-review

- Used: Code Reviewer and Self-Healing Tests when no item awaits review or approval.
- Metaphor: an empty document stand.

```
Subject: an empty tabletop document stand.
Form: a tilted rectangular back panel leaning on a thick rear prop, with a deep ledge along its lower edge. Nothing rests on the ledge and the panel is blank.
Material: back panel orange; ledge and rear prop graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 25 degrees to the left.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-empty-not-configured

- Used: connector panels and pages whose integration has no credentials (Jira, Slack, Datadog, GitHub token).
- Metaphor: a plug lying apart from its socket.

```
Subject: a cable plug lying a short distance away from its socket block.
Form: on the right, a cube-shaped socket block with one large round socket in its left face. On the left, a fat cylindrical plug with two thick blunt pins pointing at the socket, on a short stub of thick cable that ends in a rounded cap. A clear gap separates plug and socket.
Material: socket block graphite; plug orange; pins and cable stub graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, seen from the side.
Background: flat mid-grey per style block.
Composition: centred, gap in the middle of the frame, filling 80 percent of the frame width.
```

#### mark-empty-error

- Used: any panel that failed to load ("Could not load").
- Metaphor: a panel hanging by one corner.

```
Subject: a rectangular panel hanging crooked from a rail by one corner.
Form: a short horizontal rail with two pegs. A thick blank landscape panel with rounded corners hangs from the left peg only and has swung down so it sits tilted about 30 degrees. The right peg is empty, and the panel's matching hole is visible near its upper-right corner.
Material: panel orange; rail and pegs graphite.
Lighting: style-block lighting.
Camera: front-on, tilted back 10 degrees and turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame.
```

#### mark-empty-not-found

- Used: compact "page not found" state and broken deep links.
- Metaphor: a blank signpost with two arms pointing opposite ways.

```
Subject: a signpost with two blank arms pointing in opposite directions.
Form: a short stout post on a round foot. Two thick arrow-shaped boards are fixed near the top, one pointing left and slightly up, the other, just below it, pointing right and slightly down. Both boards are blank.
Material: boards orange; post and foot graphite.
Lighting: style-block lighting.
Camera: three-quarter view from slightly above, turned 15 degrees to the right.
Background: flat mid-grey per style block.
Composition: centred, filling 80 percent of the frame; the arms are wide enough that the object is as wide as it is tall.
```

---

## 3. Hero and background imagery

Paste the scene STYLE BLOCK (1.4), then the prompt, then the NEGATIVE BLOCK (1.5). Each prompt describes the wheel in words. Attach `chakram-mark-512.png` as a subject reference where the tool allows.

The shared scene idea, parallel to Chronos's clockwork hall: a delivery hall in which one large five-segment wheel is the centrepiece and a straight channel carries small cubes through it. The cubes stand for units of work moving through delivery. The wheel has no teeth, so the scene never reads as gears.

### 3.1 Login hero, dark theme

- File: `frontend/public/brand/login-bg-dark.jpg`
- Aspect ratio: 16:9, at least 2560 px wide (Chronos ships 2752 x 1536).
- How it is shown: cropped with cover-fit into the left panel of the login page, at roughly 11:10 on a desktop. The crop keeps the left and centre of the image. The right edge fades into the form panel. A white headline sits in the bottom-left corner.
- Safe areas:
  - Main object centred about 38 percent from the left edge and 45 percent from the top.
  - Bottom-left quarter: dark and low in detail, for the headline.
  - Right 30 percent: calm, dark, low contrast. This is where the image fades toward the form.
  - Nothing important in the outer 8 percent on any side.

```
Subject: a large engineered hall with one monumental wheel mounted upright in a wall frame, and a straight channel carrying small cubes through the hall.
Form: the wheel is a flat ring of five identical thick arc segments separated by narrow slanted gaps that all lean the same way, like the leaves of a camera iris, around a separate ring-shaped hub with a round hole; the segments do not touch the hub; no teeth and no spokes. It is about two storeys tall and set into a round recess in a graphite wall. A straight open channel runs from the lower right foreground toward the wheel and continues into the distance, carrying a single file of small rounded cubes at even spacing.
Material: wheel in satin orange #FC7F06. Walls, beams, floor and channel in brushed dark graphite #101010. Cubes in orange with a faint inner glow.
Lighting: dark interior. One warm soft wash from the upper left grazes the wheel. The cubes and the channel floor give a low orange glow. No other light sources.
Camera: eye level from a raised walkway, three-quarter view of the wheel wall, moderate wide angle, the wheel sharp and the far end of the hall soft.
Background: the hall recedes into near-black on the right, with only faint horizontal beams visible.
Composition: 16:9 landscape. The wheel is centred 38 percent from the left edge and 45 percent from the top. The bottom-left quarter is dark, plain floor. The right 30 percent is dark and nearly empty.
```

### 3.2 Login hero, light theme

- File: `frontend/public/brand/login-bg-light.jpg`
- Aspect ratio and safe areas: same as 3.1. In this version the bottom-left quarter must stay pale and plain, because the headline will be set in dark ink (`#101010`), and the right 30 percent must fall off to plain `#F2F2F2` so it blends into the light form panel.

```
Subject: the same hall and wheel in a bright, pale version.
Form: one monumental wheel mounted upright in a round recess in a wall: a flat ring of five identical thick arc segments separated by narrow slanted gaps that all lean the same way, like the leaves of a camera iris, around a separate ring-shaped hub with a round hole; the segments do not touch the hub; no teeth and no spokes. A straight open channel runs from the lower right foreground toward the wheel and into the distance, carrying a single file of small rounded cubes at even spacing.
Material: wheel in satin orange #FC7F06. Walls, floor and beams in matte white to light grey #F2F2F2. Channel in mid-grey. Cubes in orange. A few thin structural lines in graphite #101010.
Lighting: bright, even daylight from a high opening at the upper left. Soft pale shadows. No dark areas anywhere in the frame.
Camera: eye level from a raised walkway, three-quarter view of the wheel wall, moderate wide angle, the wheel sharp and the far end of the hall soft.
Background: the hall recedes into plain light grey #F2F2F2 on the right, with almost no visible structure.
Composition: 16:9 landscape. The wheel is centred 38 percent from the left edge and 45 percent from the top. The bottom-left quarter is plain pale floor. The right 30 percent is plain light grey and nearly empty.
```

### 3.3 Dashboard empty-state hero

- File: `frontend/public/brand/hero-dashboard-empty.png` (cut out, transparent, so one file serves both themes)
- Aspect ratio: 16:9, at least 2048 px wide. Shown at about 480 to 640 px wide in the centre or right of an empty dashboard, with a heading and a button beside or below it.
- Safe areas: the object group sits in the right 60 percent of the frame. The left 40 percent is empty background. Nothing touches the frame edges, so the cut-out is clean.

```
Subject: a small tabletop model of an idle delivery line: one wheel lying flat on a low plinth, with an empty track leading up to it.
Form: the wheel is a flat ring of five identical thick arc segments separated by narrow slanted gaps that all lean the same way, around a separate ring-shaped hub with a round hole; no teeth and no spokes. It lies flat on a low round plinth. A short straight track with four empty square sockets leads to the plinth from the left. One single cube sits just before the first socket, not yet on the track.
Material: wheel and cube in satin orange #FC7F06. Plinth and track in matte dark graphite #101010. Empty sockets in deep red-orange #DF4302.
Lighting: one soft key light from the upper left, weak fill from the right, no cast shadow outside the model's own base.
Camera: three-quarter view from above, about 30 degrees of elevation, medium focal length, everything in sharp focus.
Background: one flat, uniform mid-grey #7A7A7A with no gradient and no floor line, for removal afterwards.
Composition: 16:9 landscape. The whole model sits in the right 60 percent of the frame with clear margin on all sides. The left 40 percent is empty.
```

### 3.4 Marketing and landing hero

- File: `frontend/public/brand/hero-landing.jpg`
- Aspect ratio: 21:9 if the tool offers it. Otherwise generate 16:9 and crop the top and bottom to 21:9, which the composition allows for.
- Safe areas: the left 45 percent is calm and dark, for the headline, sub-line and button. The wheel sits in the right half. Keep the top 15 percent and bottom 15 percent free of anything important so a 16:9 result can be cropped.

```
Subject: a long delivery line seen from the side, passing through one large upright wheel and six evenly spaced frames.
Form: a straight channel runs across the whole frame from left to right. Six plain rectangular frames stand over the channel at even spacing, like stations. Between the fourth and fifth frames the channel passes through the open centre of a large upright wheel: a flat ring of five identical thick arc segments separated by narrow slanted gaps that all lean the same way, around a separate ring-shaped hub; no teeth and no spokes. Small rounded cubes travel along the channel in single file. Cubes to the left of the wheel are plain; cubes to the right of it glow faintly.
Material: wheel in satin orange #FC7F06. Channel, frames and floor in brushed dark graphite #101010. Cubes in orange.
Lighting: dark interior. A soft warm wash from the upper left on the wheel. Low orange glow from the cubes on the channel floor.
Camera: side-on, slightly raised, long focal length for a flat perspective, wheel sharp, far left and far right soft.
Background: plain near-black wall.
Composition: very wide landscape. The wheel is centred 70 percent from the left edge and vertically centred. The left 45 percent holds only the channel, three frames and dark wall. The top 15 percent and bottom 15 percent are plain.
```

### 3.5 Open Graph and social card background

- File: `frontend/public/brand/og-background.jpg` (the logo is composited on top later to make the final card)
- Aspect ratio: generate at 16:9, at least 2400 px wide, then crop to 1.91:1 and export at 1200 x 630.
- Safe areas: the left 55 percent is empty and plain, for the logo and a short line of text. The wheel fragment occupies the right 40 percent and runs off the right edge. Keep everything important at least 60 px (at 1200 x 630) from every edge, since some platforms round or trim corners. The top and bottom 6 percent are lost in the 1.91:1 crop.

```
Subject: a close view of part of one large wheel, entering the frame from the right.
Form: the wheel is a flat ring of five identical thick arc segments separated by narrow slanted gaps that all lean the same way, around a separate ring-shaped hub with a round hole; no teeth and no spokes. Only its left half is in the frame: two full segments, parts of two more, and half of the hub. The wheel faces the viewer, tilted back slightly so its thickness shows.
Material: wheel in satin orange #FC7F06 with lighter orange #FDA40B on the upper-left faces and deep red-orange #DF4302 inside the gaps.
Lighting: one soft key light from the upper left. A faint orange spill on the background next to the wheel, fading within a short distance.
Camera: front-on, slightly below the wheel's centre, medium focal length, wheel fully sharp.
Background: plain flat dark graphite #101010 with no texture and no gradient apart from the faint spill.
Composition: 16:9 landscape. The wheel's hub is centred on the right edge of the frame at mid height. The left 55 percent of the frame is plain background.
```

For a light card, change the Background line to `plain flat light grey #F2F2F2` and remove the spill sentence from the Lighting line. Save it as `og-background-light.jpg`.

### 3.6 404 illustration

- File: `frontend/public/brand/illustration-404.png` (cut out, transparent)
- Aspect ratio: 1:1, at least 2048 px. Shown at about 280 to 360 px above the "page not found" heading.
- Safe areas: the group is centred and fills about 75 percent of the frame, with clear margin on all sides. The page supplies the "404" digits as live text; the picture contains none.

```
Subject: a wheel standing upright with one of its five segments missing, and the missing segment lying on the ground a short distance away.
Form: the wheel is a flat ring of thick arc segments separated by narrow slanted gaps that all lean the same way, around a separate ring-shaped hub with a round hole; no teeth and no spokes. Four segments are in place. The fifth position, at the upper right, is empty. The fifth segment lies flat on the ground in front of the wheel to the right, at an angle. The wheel stands on a low rectangular base.
Material: the four seated segments and hub in satin orange #FC7F06. The fallen segment in matte dark graphite #101010. The base in graphite.
Lighting: one soft key light from the upper left, weak fill from the right, no cast shadow beyond the base.
Camera: three-quarter view from slightly above, turned 20 degrees to the right, medium focal length, everything sharp.
Background: one flat, uniform mid-grey #7A7A7A with no gradient and no floor line, for removal afterwards.
Composition: 1:1 square. The wheel is centred slightly left, the fallen segment at the lower right. The group fills 75 percent of the frame with clear margin on all sides.
```

---

## 4. Motion loops (optional, Flow video)

Each loop is 4 to 6 seconds with no text and no audio needed. Paste the scene STYLE BLOCK (1.4), then the prompt, then the NEGATIVE BLOCK (1.5).

How the loops are made seamless: the wheel has five identical segments, so a turn of exactly one fifth of a revolution (72 degrees) ends on a frame that looks identical to the first. Every loop below is built on that. If the tool accepts a starting image and an ending image, supply the same approved still for both. If it accepts only a starting image, supply the approved still and check the last frame against the first before accepting the clip.

Loaders are small on screen. If a clip has any drift in camera or lighting, crossfade the last 6 to 8 frames into the first when exporting.

### 4.1 Loading state: wheel turning

- File: `frontend/public/brand/loader-wheel-turn.webm` (and an `.mp4` fallback)
- Format: 1:1, 4 seconds, plain flat background `#101010`. Make a second version on `#F2F2F2` for the light theme.
- Starting image: the approved `mark-chakram-wheel` render, re-composited on the flat background.

```
Subject: one wheel made of five identical thick arc segments separated by narrow slanted gaps, around a separate ring-shaped hub with a round hole; no teeth and no spokes. Satin orange #FC7F06.
Motion: the wheel turns clockwise around its own centre at a constant speed, by exactly one fifth of a full turn over the length of the clip. The hub does not move. No acceleration and no slowing down. The first and last frames are identical.
Camera: locked off, front-on, tilted back 15 degrees. No camera movement, no zoom.
Lighting: one fixed soft key light from the upper left. The highlight stays in the same place on screen while the wheel turns beneath it.
Background: flat, uniform dark graphite #101010. Nothing else in the frame.
Composition: 1:1 square, wheel centred, filling 70 percent of the frame.
```

### 4.2 Loading state: wheel assembling

- File: `frontend/public/brand/loader-wheel-assemble.webm`
- Format: 1:1, 5 seconds, plain flat background `#101010` (and a `#F2F2F2` version).
- Use: first load and long operations.

```
Subject: one wheel made of five identical thick arc segments separated by narrow slanted gaps, around a separate ring-shaped hub with a round hole; no teeth and no spokes. Satin orange #FC7F06.
Motion: the clip starts on the fully assembled wheel. In the first second, all five segments slide straight outward from the hub by one quarter of the wheel's radius, together. Over the next three seconds, the five separated segments travel clockwise around the hub by exactly one fifth of a full turn, keeping their spacing. In the last second, they slide straight back inward and seat in place. The hub stays still throughout. The first and last frames are identical.
Camera: locked off, front-on, tilted back 15 degrees. No camera movement, no zoom.
Lighting: one fixed soft key light from the upper left.
Background: flat, uniform dark graphite #101010. Nothing else in the frame.
Composition: 1:1 square, wheel centred. The assembled wheel fills 60 percent of the frame so the expanded segments stay fully inside it.
```

### 4.3 Login background ambient loop, dark theme

- File: `frontend/public/brand/login-bg-dark.webm`, with `login-bg-dark.jpg` (3.1) as the poster frame and as the fallback when reduced motion is requested.
- Format: 16:9, 6 seconds. Safe areas as in 3.1.
- Starting image: the approved dark login hero.

```
Subject: the hall from the dark login hero: one monumental orange wheel of five identical arc segments mounted upright in a graphite wall, and a straight channel carrying a single file of small glowing orange cubes at even spacing.
Motion: the wheel turns clockwise at a constant slow speed, by exactly one fifth of a full turn over the length of the clip. The cubes move along the channel away from the camera at a constant speed, each one advancing exactly to the position of the cube ahead of it by the end of the clip. The orange glow on the channel floor moves with the cubes. Nothing else moves. The first and last frames are identical.
Camera: locked off at eye level on the raised walkway. No pan, no tilt, no zoom, no shake.
Lighting: fixed. One warm soft wash from the upper left on the wheel, low orange glow from the cubes. No flicker.
Background: the hall recedes into near-black on the right and stays still.
Composition: 16:9 landscape, identical to the starting image. Wheel centred 38 percent from the left and 45 percent from the top. Bottom-left quarter and right 30 percent stay dark and still.
```

### 4.4 Empty-state idle loop

- File: `frontend/public/brand/hero-dashboard-empty.webm`, with the still from 3.3 as the poster.
- Format: 16:9, 4 seconds, flat background matching the surface it sits on (`#FFFFFF` for light cards, `#101010` for dark). Video cannot carry transparency reliably, so make one per theme.
- Starting image: the approved dashboard empty-state hero, re-composited on the flat background.

```
Subject: the tabletop model from the dashboard empty-state hero: one orange wheel of five identical arc segments lying flat on a low graphite plinth, a short graphite track with four empty sockets, and one orange cube waiting before the first socket.
Motion: the wheel turns slowly on its plinth at a constant speed, by exactly one fifth of a full turn over the length of the clip. The waiting cube rises a few millimetres and settles back once, smoothly, reaching its highest point at the middle of the clip. Nothing else moves. The first and last frames are identical.
Camera: locked off, three-quarter view from above at about 30 degrees of elevation. No camera movement.
Lighting: one fixed soft key light from the upper left.
Background: flat, uniform white #FFFFFF. Nothing else in the frame.
Composition: 16:9 landscape, the model in the right 60 percent of the frame, the left 40 percent empty.
```

---

## 5. Production checklist

### 5.1 File naming

- Marks: the id is the filename. `mark-dashboard` becomes `mark-dashboard.png`. Lower case, kebab-case, no version suffixes in the repo.
- Keep rejected variations and full-size masters outside the repo's `public` folders (for example under `Chakram Assets/masters/`), named `<id>-v1.png`, `<id>-v2.png`.
- Heroes and loops use the filenames given in sections 3 and 4.

### 5.2 Sizes and export format

| Asset | Master | Shipped file |
| --- | --- | --- |
| Marks | 1024 x 1024 or larger, PNG | 256 x 256, PNG with alpha (RGBA), sRGB. This is 4 times the largest display size of 64 px. |
| Empty-state marks | 1024 x 1024 or larger, PNG | 512 x 512, PNG with alpha, since they are shown up to 160 px |
| `mark-chakram-wheel` | 1024 x 1024 or larger, PNG | 512 x 512, PNG with alpha |
| Login heroes | as generated | 2560 x 1440 JPEG, quality about 82, sRGB |
| Landing hero | as generated | 2560 px wide JPEG, quality about 82 |
| Social card | as generated | 1200 x 630 JPEG (background only) and the final composited card as PNG |
| Dashboard empty-state hero, 404 illustration | as generated | 1280 px on the long side, PNG with alpha |
| Loops | as generated | WebM plus MP4 fallback, no audio track, under 1 MB for loaders and under 4 MB for the login loop |

Chronos ships its marks at 512 x 512 and they weigh 70 to 240 KB each, about 15 MB for the set. At 256 x 256 the Chakram set stays near 2 to 3 MB. Run the shipped PNGs through a lossless optimiser.

### 5.3 Background removal

1. If the tool produced a transparent file, check that it is truly transparent (open it over a bright colour) and skip to step 4.
2. Otherwise remove the flat mid-grey background at master size, before downscaling.
3. Defringe: contract the mask by 1 to 2 px at master size and remove any remaining grey edge colour. Hollow marks need their inner openings cleared as well: `mark-kpi-skipped`, `mark-verdict-insufficient-data`, `mark-kpi-pass-rate`, `mark-kpi-ai-calls`, `mark-connectors`, `mark-kpi-ci-failure-rate`, `mark-int-source-control`.
4. Crop to the object's bounding box, then pad to a square so the object fills about 86 percent of the canvas, centred. This makes all marks sit at the same optical size.
5. Check the corners of every file for generator watermarks and remove them. Do not ship any file that still has one.
6. Downscale to the shipped size with a high-quality resampler and export.

### 5.4 Checking a mark at 40 px

Do this for every mark before it is accepted.

1. Place the shipped file at 40 px and at 64 px on four swatches: `#FFFFFF`, `#F2F2F2`, `#101010`, `#000000`.
2. On the two dark swatches, look for a pale or grey fringe around the outline and for leftover background inside openings.
3. On all four, confirm the graphite parts are still visible. Graphite parts can disappear on the dark swatches; if a mark depends on a graphite part to be understood (for example `mark-verdict-not-evaluated`, `mark-kpi-skipped`, `mark-empty-no-results`), regenerate it with the graphite lightened to `#2A2A2A` or with a thin orange lip on the graphite part.
4. Recognition test: show the 40 px mark, without its label, to someone who has not seen the set. They should be able to say what the object is. They do not need to guess the concept.
5. Set test: lay out all marks of a group in one row at 40 px. No two should be mistaken for each other. Pay particular attention to these pairs: `mark-kpi-incidents-open` and `mark-kpi-incidents-resolved`; the five `mark-verdict-*` marks; `mark-kpi-passed` and `mark-kpi-failed`; `mark-kpi-successful-runs` and `mark-synthetic-data`; `mark-pipeline` and the two incident KPI marks.
6. Hue test: in the same row, check that the orange matches from mark to mark. Regenerate any that lean red, amber or brown, using the approved reference image.
7. Check for text. Zoom to 400 percent on the master and look for stray letter-like or digit-like marks on flat faces. Regenerate if any are found.

### 5.5 Where files go in the repo

| Files | Folder |
| --- | --- |
| All `mark-*.png` | `frontend/public/images/marks/` |
| Login heroes, landing hero, social card, dashboard empty-state hero, 404 illustration, loops | `frontend/public/brand/` |
| Masters and rejected variations | outside `frontend/public/` (for example `Chakram Assets/masters/`) |

The existing logo files (`chakram-mark.svg`, `chakram-logo-light.svg`, `chakram-logo-dark.svg`, `chakram-mark-512.png`) already live in `frontend/public/brand/` and are not replaced by anything in this pack.

Wiring suggestion, following Chronos's `src/lib/rcm/marks.ts`: one small module with a `markSrc(id)` helper returning `/images/marks/${id}.png`, a route-to-mark map built from the table below, and maps for stages, KPIs, verdicts, connectors and empty states. Marks are decorative, so render them with an empty `alt` and `aria-hidden`, and never use one in place of a label, number or control.

### 5.6 Wiring table

All files are in `frontend/public/images/marks/`.

| Id | File | Used for |
| --- | --- | --- |
| `mark-chakram-wheel` | `mark-chakram-wheel.png` | Brand mark in 3D; loading and about surfaces |
| `mark-section-build` | `mark-section-build.png` | Sidebar section `build` (Build & Code) |
| `mark-section-requirements` | `mark-section-requirements.png` | Sidebar section `requirements` (Requirements & Planning) |
| `mark-section-testing` | `mark-section-testing.png` | Sidebar section `testing` (Testing & Quality) |
| `mark-section-release` | `mark-section-release.png` | Sidebar section `release` (Release & Ops) |
| `mark-dashboard` | `mark-dashboard.png` | `/dashboard` |
| `mark-pipeline` | `mark-pipeline.png` | `/pipeline` |
| `mark-ai-app-builder` | `mark-ai-app-builder.png` | `/ai-ide` |
| `mark-ai-workspace` | `mark-ai-workspace.png` | `/workspace`; pipeline stage Workspace |
| `mark-code-review` | `mark-code-review.png` | `/code-review`; pipeline stage Code Review |
| `mark-code-impact` | `mark-code-impact.png` | `/code-impact` |
| `mark-prd-generator` | `mark-prd-generator.png` | `/prd` |
| `mark-requirements` | `mark-requirements.png` | `/requirements`; workflow stage Requirement |
| `mark-requirements-intelligence` | `mark-requirements-intelligence.png` | `/requirements-intelligence` |
| `mark-sprint-intelligence` | `mark-sprint-intelligence.png` | `/sprint-intelligence` |
| `mark-synthetic-data` | `mark-synthetic-data.png` | `/synthetic-data`; workflow supporting step |
| `mark-repo-baseline` | `mark-repo-baseline.png` | `/repo-baseline` |
| `mark-doc-tests` | `mark-doc-tests.png` | `/doc-tests` |
| `mark-test-suite` | `mark-test-suite.png` | `/generated-tests`; workflow stage Test Suite |
| `mark-test-execution` | `mark-test-execution.png` | `/test-execution`; workflow stage Execution; pipeline stage Test Run |
| `mark-live-test-runner` | `mark-live-test-runner.png` | `/live-testing`, `/live-test-runner` |
| `mark-risk-ranking` | `mark-risk-ranking.png` | `/prioritization`; workflow stage Risk Ranking |
| `mark-change-hotspots` | `mark-change-hotspots.png` | `/defect-prediction` |
| `mark-root-cause` | `mark-root-cause.png` | `/root-cause` |
| `mark-test-selection` | `mark-test-selection.png` | `/test-selection` |
| `mark-self-healing` | `mark-self-healing.png` | `/self-healing` |
| `mark-deployments` | `mark-deployments.png` | `/deployments` |
| `mark-release-gate` | `mark-release-gate.png` | `/release-gate` |
| `mark-ci-intelligence` | `mark-ci-intelligence.png` | `/ci-intelligence` |
| `mark-anomaly-sandbox` | `mark-anomaly-sandbox.png` | `/monitoring` |
| `mark-incidents` | `mark-incidents.png` | `/incidents` |
| `mark-connectors` | `mark-connectors.png` | `/settings/connectors` |
| `mark-profile` | `mark-profile.png` | `/profile` |
| `mark-ai-usage` | `mark-ai-usage.png` | `/cost-tracker` |
| `mark-stage-deploy` | `mark-stage-deploy.png` | Pipeline stage Deploy |
| `mark-stage-report` | `mark-stage-report.png` | Pipeline stage Report; report and export actions |
| `mark-kpi-pass-rate` | `mark-kpi-pass-rate.png` | KPI: pass rate |
| `mark-kpi-passed` | `mark-kpi-passed.png` | KPI and status: passed |
| `mark-kpi-failed` | `mark-kpi-failed.png` | KPI and status: failed |
| `mark-kpi-skipped` | `mark-kpi-skipped.png` | KPI and status: skipped, not checked |
| `mark-kpi-duration` | `mark-kpi-duration.png` | KPI: duration |
| `mark-kpi-known-failure` | `mark-kpi-known-failure.png` | KPI and badge: known failure |
| `mark-kpi-high-priority` | `mark-kpi-high-priority.png` | KPI and badge: high priority |
| `mark-kpi-cases-ranked` | `mark-kpi-cases-ranked.png` | KPI: cases ranked |
| `mark-kpi-ai-calls` | `mark-kpi-ai-calls.png` | KPI: AI calls |
| `mark-kpi-tokens` | `mark-kpi-tokens.png` | KPI: tokens |
| `mark-kpi-ci-failure-rate` | `mark-kpi-ci-failure-rate.png` | KPI: CI run failure rate |
| `mark-kpi-successful-runs` | `mark-kpi-successful-runs.png` | KPI: successful runs |
| `mark-kpi-commits-analysed` | `mark-kpi-commits-analysed.png` | KPI: commits analysed |
| `mark-kpi-incidents-open` | `mark-kpi-incidents-open.png` | KPI: incidents open |
| `mark-kpi-incidents-resolved` | `mark-kpi-incidents-resolved.png` | KPI: incidents resolved |
| `mark-verdict-go` | `mark-verdict-go.png` | Release verdict: GO |
| `mark-verdict-conditional` | `mark-verdict-conditional.png` | Release verdict: CONDITIONAL |
| `mark-verdict-no-go` | `mark-verdict-no-go.png` | Release verdict: NO-GO |
| `mark-verdict-insufficient-data` | `mark-verdict-insufficient-data.png` | Release verdict: insufficient data |
| `mark-verdict-not-evaluated` | `mark-verdict-not-evaluated.png` | Release gate and checks: not evaluated |
| `mark-int-source-control` | `mark-int-source-control.png` | Connector: GitHub |
| `mark-int-issue-tracker` | `mark-int-issue-tracker.png` | Connector: Jira |
| `mark-int-hosting` | `mark-int-hosting.png` | Connector: Vercel |
| `mark-int-chat-alerts` | `mark-int-chat-alerts.png` | Connector: Slack |
| `mark-int-observability` | `mark-int-observability.png` | Connector: Datadog |
| `mark-int-ai-model` | `mark-int-ai-model.png` | Connector: AI model provider (Ollama) |
| `mark-empty-no-requirements` | `mark-empty-no-requirements.png` | Empty state: no requirements yet |
| `mark-empty-no-runs` | `mark-empty-no-runs.png` | Empty state: no runs yet |
| `mark-empty-no-results` | `mark-empty-no-results.png` | Empty state: no results in this view |
| `mark-empty-nothing-to-review` | `mark-empty-nothing-to-review.png` | Empty state: nothing to review |
| `mark-empty-not-configured` | `mark-empty-not-configured.png` | Empty state: integration not configured |
| `mark-empty-error` | `mark-empty-error.png` | Error state: could not load |
| `mark-empty-not-found` | `mark-empty-not-found.png` | Compact page-not-found state |

Hero, illustration and loop files (all in `frontend/public/brand/`):

| File | Used for |
| --- | --- |
| `login-bg-dark.jpg` | Login page left panel, dark theme; poster for the ambient loop |
| `login-bg-light.jpg` | Login page left panel, light theme |
| `hero-dashboard-empty.png` | Dashboard when the workspace has no data |
| `hero-landing.jpg` | Marketing and landing page hero |
| `og-background.jpg`, `og-background-light.jpg` | Social card background, before the logo is composited |
| `illustration-404.png` | Page-not-found route |
| `loader-wheel-turn.webm`, `loader-wheel-assemble.webm` | Loading states |
| `login-bg-dark.webm` | Login page ambient loop |
| `hero-dashboard-empty.webm` | Dashboard empty-state idle loop |
