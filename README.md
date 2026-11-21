# AFCD Foundation website

Homepage wireframe (Stage 2) for the AFCD Foundation, the organisation behind [afcdfoundation.org](https://afcdfoundation.org).

Built with plain HTML, Tailwind CSS 3.4.17 and vanilla JavaScript, in strict black, white and grayscale. Content is planned in English, French and Arabic (RTL).

## Run it

Open `index.html` in a browser. It needs `assets/styles.css` and `assets/main.js` next to it. No server is required.

## Change the styles

Edit the classes in `index.html` or `assets/main.js`, then rebuild the CSS:

```bash
npm install
npx tailwindcss -i input.css -o assets/styles.css --minify
```

## Files

- `index.html`: the homepage
- `input.css`: Tailwind source
- `assets/styles.css`: compiled CSS
- `assets/main.js`: interactions
- `tailwind.config.js`: Tailwind configuration

## Notes

- Grey boxes are photo placeholders. Each caption names the real file on afcdfoundation.org to use.
- "Show notes" (bottom right) reveals wireframe notes: sources, placeholders and what still needs confirming.
- This is a wireframe and is not deployed anywhere yet.
