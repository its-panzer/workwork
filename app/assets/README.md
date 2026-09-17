# workwork visual assets

The design uses turquoise stone, sculpted gold, and compass shapes inspired by fantasy game interfaces and the World of Warcraft Forever emblem. The reference screenshot and logo are not bundled.

Original artwork is distributed under the repository's MIT license. Generated image provenance is documented below; non-rendering image metadata is removed from the public assets.

- `workwork-medallion.png`: original transparent medallion, generated with the built-in imagegen tool. 1254 × 1254 RGBA; 860,290 fully transparent pixels. The generated alpha is preserved.
- `compass-field.svg`: original code-drawn engraved compass backdrop for the masthead.
- `frame-corner.svg`: original code-drawn beveled gold corner fitting.
- `workwork-wordmark.png`: original illustrated gold lettering generated with the built-in imagegen tool. 2005 × 386 RGBA; transparent margins trimmed for the header. The heading keeps an accessible text alternative.
- `workwork-icon.png`: selected original app icon artwork generated with the built-in imagegen tool, with its baked-in checkerboard removed by a direct pixel mask. 1254 × 1254 RGBA; 519,621 fully transparent pixels and 4,275 antialiased edge pixels. The artwork's original RGB values are unchanged.
- `workwork.icns`: macOS icon container generated from that PNG with `npm run build:icon`. Includes 16, 32, 128, 256, and 512 point representations at 1× and 2×.

## App icon transparency

The selected artwork has a large faceted turquoise gemstone, four sculpted gold compass points, a broad circular bezel, and a glossy teal tile. The exterior checkerboard was removed directly from the original PNG without regenerating the artwork. The mask follows the border-connected neutral background and antialiases only the inside edge; the tile interior remains opaque. The final PNG was checked against light and dark backgrounds, and every visible RGB sample was verified against the original.

`npm run build:icon` preserves the PNG's alpha when producing the macOS icon sizes. The floating overlay continues to use the separate medallion asset.

## Wordmark generation prompt

```text
Use case: logo-brand
Asset type: a finished transparent wordmark asset for a fantasy desktop app header.
Text (verbatim): "WORKWORK" — exactly eight capital letters, W O R K W O R K, all on a single horizontal line.
Primary request: Design original bespoke illustrated lettering with the sculpted, imposing character of classic Warcraft-era fantasy game title art. This must look like a carefully drawn and painted game logo, not typeset text. Make the two Ws commanding angular forms with slightly taller outer horns, the Os chunky faceted octagonal counters, and the R and K legs strong sweeping chisel-cut shapes. Keep every letter immediately readable and distinguishable at an actual displayed width of 340 pixels.
Materials: warm antique-gold metal, broad champagne-ivory bevel highlights on upper planes, deep bronze cut faces, very subtle turquoise reflected light along lower bevels. Sharply defined handcrafted contours, restrained surface wear. The lettering itself is the artwork; no surrounding plate.
Composition: wide compact wordmark, about 5.2:1 in its occupied silhouette, balanced spacing and shared baseline, straight-on orthographic camera, full word visible, generous transparent margin to preserve protruding serifs. Arrange the typography as one cohesive custom emblem with a confident silhouette, strong horizontal presence and limited vertical flourishes.
Backdrop: genuine transparent RGBA background, alpha zero outside the lettering and inside the O/R counters. No painted checkerboard. No opaque background or backdrop shadow.
Constraints: Only the exact word WORKWORK. No subtitles, no other words, no game names, no badges, no icons, no gems, no globe, no shield, no frame, no underlining or detached ornaments. No existing brand logo reproduction. No stock font appearance, no simple gradient-filled font, no thin hairlines, no long spikes, no flames, no blur or glow haze. The app header behind this mark is dark teal and already has its own decorative divider. Produce the final clean wordmark asset, not a presentation/mockup.
```

## Medallion generation prompt

```text
Use case: stylized-concept
Asset type: production transparent UI icon for a fantasy MMORPG desktop overlay called workwork; the image is a single clickable jewel, designed to remain readable at 64px.
Primary request: Create one original highly detailed turquoise gemstone compass medallion, frontal orthographic view. One centered circular glossy teal gemstone disk set inside a thick sculpted antique-gold bezel. Four restrained cardinal compass points extend from the circle. Symmetrical, compact, solid silhouette; the stone fills about 68% of the main circle diameter.
Style/medium: premium hand-painted, sculpted classic fantasy MMORPG interface item, dimensional metal and translucent stone; restrained material realism with artistic crispness.
Materials/textures: gold rim has broad beveled planes, warm ivory highlights, medium old-gold faces, dark bronze recesses, subtle fine scratches, geometric ornamental engraving that contains absolutely no writing or symbols resembling letters. The center is a luminous turquoise and deep teal round-cut jewel with a few broad facets, darker blue perimeter, high upper-left glint, and quiet internal depth.
Composition/framing: square image, medallion exactly centered, frontal and flat to camera, no perspective tilt, full medallion and all four points visible. Object fills 82% of the canvas width and height, with transparent margin on all sides.
Lighting/mood: soft upper-left key light, crisp highlights on upper-left bezel, dark bronze lower-right bevel, teal reflected light touching inner gold.
Scene/backdrop: actual fully transparent background with an alpha channel. No painted background, no checkerboard pattern, no scenery.
Constraints: original asset inspired by the turquoise-and-antique-gold materials of classic fantasy interfaces, no copied game logo. No text, no letters, no runes, no brand marks, no watermark, no numbers, no badge, no detached particles, no smoke, no glow haze outside the object. Avoid tiny fussy engraving or skinny points; readability at icon scale is crucial.
```
