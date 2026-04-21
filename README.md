# GammaBoost+ Website

Single-page marketing site for GammaBoost+.

## Files

- `index.html` — main landing page
- `style.css` — all styling
- `script.js` — scroll animations, nav highlighting
- `assets/` — logo, trailer video, thumbnail, screenshots

## Local preview

Open `index.html` directly in a browser, or run any static server:

```bash
npx http-server website -p 8080
# or
python -m http.server 8080 --directory website
```

## Deployment

**Any static host works.** Options:

### Cloudflare Pages (recommended — free, fast, free SSL)
1. Push this repo to GitHub
2. Cloudflare Pages → Create a project → Connect to Git
3. Set **build output directory** to `website`
4. Deploy
5. Add your domain in Custom domains

### Vercel / Netlify
1. Connect repo
2. Set publish directory to `website/`
3. Deploy

### GitHub Pages
1. Copy contents of `website/` to a `docs/` folder or `gh-pages` branch
2. Enable in repo Settings → Pages

### Pointing your domain
In your domain registrar's DNS settings, add:
- `A` record → Cloudflare/Vercel/Netlify IP
- Or `CNAME` → `yourapp.pages.dev` / `vercel.app` / `netlify.app`

## Updating the Steam link

Replace `href="#"` on the "Get on Steam" buttons in `index.html` with:
```
https://store.steampowered.com/app/4601350/GammaBoost_plus/
```

(Do a find-replace on `href="#"` — 3 occurrences in `index.html`.)
