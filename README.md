# Sleeve

A virtual 3×3 trading-card album: a stylised, pastel, cartoon binder that opens to a bound-book spread
with page turning (drag, flick, click, arrow keys). Static HTML/CSS/JS with no build step, so it can be
hosted on GitHub Pages as is.

Live at https://gyajaman.github.io/sleeve-card-album/

Open `index.html` through any static server (for example `npx serve` or `python -m http.server`).

- Click a pocket's upload button to add a card: pick an image, crop it to card shape, and it slides in.
- The eye button lifts a card out for a closer look (drag to tilt it); the bin deletes it.
- The album starts with 4 pages; the + in the page bar adds two more at a time (up to 62).
- Settings (colours, label, sound) are saved in the browser's localStorage and the cards in IndexedDB,
  so they stay on the device. Settings has Export and Import to save the whole album to a file and
  restore it, for backups or moving to another device.

## Sounds

`sounds/key*.wav`, `space.wav` and `back.wav` are typewriter strikes; `page.wav` is a trimmed page-turn
clip. Check the licence of `page.wav` before making this repository public.
