# Agent Guide for tianxingchen.github.io

This file is intended for AI coding agents working on this repository. It describes the project structure, technology stack, conventions, and workflows as they actually exist in the codebase.

## Project Overview

This repository is the personal academic homepage of **Zimu Han**, hosted as a static site on **GitHub Pages** at `https://hzmsailor.github.io/`. It is a hand-written, build-tool-free website that presents a bio, publications, honors, experience, academic services, invited talks, and open-source projects.

The repository also contains a standalone project page for the paper **G3Flow** (`/G3Flow/`), which is served as a subpath of the same GitHub Pages site.

There are no package managers, bundlers, frameworks, or backend services. Everything is plain HTML, CSS, JavaScript, images, and videos.

## Repository Layout

```
.
├── index.html          # Main homepage (single-page site)
├── style.css           # Stylesheet for the homepage
├── README.md           # GitHub profile README (also used as repo description)
├── google.txt          # Contains the site URL for search-console verification
├── colorize.py         # Utility: convert logo foregrounds to grayscale/B&W
├── zip.py              # Utility: compress images to <= 1 MB
├── zip_video.py        # Utility: compress videos/GIFs to <= 3 MB
├── assets/
│   ├── api/combined    # Visitor-badge endpoint data
│   └── files/          # Static media assets
│       ├── avatar/     # Profile photos
│       ├── award/      # Award photos
│       ├── icon/       # Social/contact icons
│       ├── institute/  # Institution/company logos
│       ├── photo/      # Personal/event photos
│       └── work/       # Paper/project thumbnails and videos
└── G3Flow/
    ├── index.html      # G3Flow project page
    ├── files/          # G3Flow paper figures and PDF
    ├── public/         # G3Flow CSS, JS, SVG icons, images
    └── video/          # G3Flow demo videos organized by task
```

## Technology Stack

- **Hosting**: GitHub Pages (served from the `main` branch root).
- **Markup**: Plain HTML5.
- **Styling**: Plain CSS3; no CSS frameworks or preprocessors.
- **Scripting**: Plain JavaScript (embedded in `index.html` and `G3Flow/public/js/base.js`).
- **External libraries**:
  - Homepage: Google Fonts (`Poppins`, `Source Serif 4`, `JetBrains Mono`), visitor-badge pixel image.
  - G3Flow page: jQuery 3.3.1, Three.js 0.150.1 loaded via CDN/importmap, Google Fonts (`Roboto`).
- **Utilities**: Python 3 scripts using Pillow (`colorize.py`, `zip.py`) and ffmpeg (`zip_video.py`).

## Build and Deployment

There is **no build step**.

Deployment is handled automatically by GitHub Pages:

1. Commit changes to the `main` branch.
2. GitHub Pages publishes the repository root at `https://tianxingchen.github.io/`.
3. Subpaths such as `https://tianxingchen.github.io/G3Flow/` are served from the corresponding directories.

To preview locally, open `index.html` or `G3Flow/index.html` directly in a browser, or run a simple static server:

```bash
# From the repository root
python3 -m http.server 8000
```

Then visit `http://localhost:8000/` and `http://localhost:8000/G3Flow/`.

## Code Organization

### Homepage (`index.html` / `style.css`)

The homepage is a single long HTML document divided into commented sections:

- Header / bio
- News (collapsible list)
- Education
- Entrepreneurship
- Research experience
- Publications (featured papers + full list)
- Honors & awards
- Programming competition awards
- Open-source projects
- Academic services
- Invited talks
- Footer

Interactivity is minimal and implemented with a small inline `<script>`:

- `toggleNews()` — expand/collapse older news items.
- `toggleHonors()` — expand/collapse secondary honors.
- `initPubFeaturedLightbox()` — open featured paper images/videos in a lightbox.

CSS is organized by component in `style.css` (variables, reset, layout, sections, responsive rules). The visual style is a minimal, dot-grid academic homepage inspired by Ying Xiao's design.

### G3Flow Project Page (`G3Flow/`)

A separate academic project page with its own assets:

- `G3Flow/index.html` — paper title, authors, abstract, pipeline figure, visualization grid, experiment results, BibTeX, acknowledgements, and an interactive Three.js model viewer.
- `G3Flow/public/index.css`, `media.css`, `sidebars.css` — page styles.
- `G3Flow/public/js/base.js` — sidebar scroll highlighting and video-switching configuration (currently references non-existent `public/videos/` paths; the actual videos are in `G3Flow/video/`).
- `G3Flow/public/images/` — figures used by the project page.
- `G3Flow/files/` — paper PDF and main figures.
- `G3Flow/video/` — demonstration videos grouped by task.

The Three.js model viewer code attempts to load OBJ/MTL and GLB models from `files/obj/` and `files/glb/`, but those directories do not exist in the repository, so the viewer will log errors in the browser console.

## Helper Scripts

### `zip.py`

Batch image compressor. Walks the current directory recursively and compresses any `jpg/jpeg/png/webp` larger than 1 MB to be at most 1 MB.

- JPEG/WebP: lowers quality, then downscales if needed.
- Transparent PNG: tries PNG optimization first, then scales, then optionally converts to WebP.
- Non-transparent PNG: converts to JPEG.

Run from the repository root to compress assets:

```bash
python3 zip.py
```

Requires: `Pillow` (`pip install Pillow`).

### `zip_video.py`

Batch video/GIF compressor. Walks the current directory recursively and compresses any `.mp4` or `.gif` larger than 3 MB to be at most 3 MB.

- MP4: re-encodes with ffmpeg using H.264 (`libx264`) and increasing CRF.
- GIF: re-saves with Pillow at decreasing quality.

Run from the repository root:

```bash
python3 zip_video.py
```

Requires: `Pillow`, `ffmpeg` installed and on `PATH`.

### `colorize.py`

Single-purpose image-processing utility that converts the foreground of a logo image to grayscale or pure black-and-white while preserving the background (estimated from the four corners).

It is not currently wired to run on the repository assets automatically; the `__main__` block points to a local Downloads path and writes `output_gray.png`.

Requires: `Pillow`, `numpy`.

## Code Style Guidelines

- **HTML**: Hand-written, semantic-ish markup with extensive HTML comments marking major sections. Keep the same indentation style (2 spaces) and comment banners when adding new sections.
- **CSS**: Plain CSS with custom properties. The homepage uses a warm dot-grid theme (`#f8f7f4` background, blue accent `#2563eb`). Maintain the existing variable-based theming; avoid adding new frameworks.
- **JavaScript**: Inline for the homepage; jQuery-based for G3Flow. Keep additions minimal and compatible with modern browsers.
- **Python utilities**: Comments and docstrings are mostly in Chinese. Preserve that convention when modifying the helper scripts. The scripts are ad-hoc maintenance tools, not production code.

## Testing

There are **no automated tests**.

Validation is manual:

1. Open changed pages in a browser.
2. Check that images/videos load and links are correct.
3. Verify responsive layout at mobile widths.
4. Confirm no 404s in the browser console.

## Security Considerations

- This is a fully static, public site. There is no authentication, secrets file, or server-side logic.
- Do not commit API keys, tokens, or personal contact secrets.
- External links use `target="_blank"` and `rel="noopener noreferrer"` where appropriate; preserve these attributes when editing links.
- The visitor badge and Google Fonts are loaded from third-party CDNs; maintain those references if they are still functional.

## Common Maintenance Tasks

- **Add a new paper**: Insert a new `<li class="pub-item">` block in `index.html` inside `#publications .pub-list`. Add the thumbnail to `assets/files/work/`. Update the publication spotlight if the venue is top-tier.
- **Add news**: Append a `<li class="news-item">` to `#news-list`. Mark older items with `news-hidden` if they should be collapsed by default.
- **Update avatar or logos**: Replace the corresponding file in `assets/files/` and keep the same filename, or update the `src` attribute.
- **Optimize media before pushing**: Run `python3 zip.py` and `python3 zip_video.py` from the repository root to keep assets under the size limits used in this project.

## Deployment Notes

- Target branch for GitHub Pages: `main`.
- Repository remote: `https://github.com/TianxingChen/tianxingchen.github.io.git`.
- Custom domain: none configured (CNAME file is absent); the site is served at `https://hzmsailor.github.io/`.

## Things an Agent Should Know

- No `package.json`, `pyproject.toml`, `Gemfile`, `Makefile`, `_config.yml`, or CI/CD workflows exist. Do not assume a build system.
- The `G3Flow/public/js/base.js` video paths (`public/videos/...`) do not match the actual directory layout (`G3Flow/video/...`). If you modify video behavior, reconcile these paths.
- The Three.js model-viewer code in `G3Flow/index.html` references `files/obj/` and `files/glb/` directories that are not present in the repository.
- `README.md` is used as the GitHub profile README; it is not the source of the homepage.
- `google.txt` only contains the site URL and appears to be used for Google Search Console verification; do not alter it unless you are re-verifying the property.
