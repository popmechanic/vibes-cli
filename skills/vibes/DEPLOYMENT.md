# Deploying Vibes Apps

Vibes apps are static files that can be deployed to any static hosting provider. No build step is required - the import map handles all dependencies via CDN.

## Local Development

Just open `index.html` directly in your browser - no server needed!

Vibes apps are single HTML files with inline JavaScript. The CDN imports (esm.sh) work over HTTPS, so there are no CORS issues.

---

## What to Deploy

Your Vibes app is a **single file**:
- `index.html` - Contains everything (HTML + inline JavaScript)

That's it! Just upload this one file.

---

## Deployment Options

### Netlify

**Option 1: Drag and Drop**
1. Go to [netlify.com/drop](https://app.netlify.com/drop)
2. Drag your project folder onto the page
3. Your site is live!

**Option 2: CLI**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy from your project folder
netlify deploy --prod
```

**Option 3: Git Integration**
1. Push your code to GitHub/GitLab
2. Connect repository in Netlify dashboard
3. Auto-deploys on every push

---

### Vercel

**Option 1: CLI**
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from your project folder
vercel --prod
```

**Option 2: Dashboard**
1. Go to [vercel.com](https://vercel.com)
2. Import your Git repository
3. Deploy with zero configuration

---

### GitHub Pages

**Option 1: Repository Settings**
1. Push code to a GitHub repository
2. Go to Settings > Pages
3. Select branch and folder (root or /docs)
4. Your site is live at `username.github.io/repo-name`

**Option 2: GitHub Actions**
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - uses: actions/deploy-pages@v4
```

---

### Cloudflare Pages

**Option 1: Dashboard**
1. Go to [Cloudflare Pages](https://pages.cloudflare.com)
2. Connect your Git repository
3. Build command: (leave empty)
4. Output directory: `.` or your project folder

**Option 2: Direct Upload**
1. Go to Cloudflare Pages dashboard
2. Create new project > Direct Upload
3. Upload your files

**Option 3: Wrangler CLI**
```bash
# Install Wrangler
npm install -g wrangler

# Deploy
wrangler pages deploy .
```

---

### Surge.sh

Simple CLI deployment:
```bash
# Install Surge
npm install -g surge

# Deploy from your project folder
surge
```

---

### Any Static Host

Vibes apps work on any server that can serve static files:

- **AWS S3 + CloudFront**
- **Google Cloud Storage**
- **Azure Static Web Apps**
- **DigitalOcean App Platform**
- **Render**
- **Railway**
- **Your own nginx/Apache server**

Just upload `index.html` and `app.js` to your hosting provider.

---

## Custom Domain

Most providers support custom domains:

1. Add your domain in the provider's dashboard
2. Update DNS records (usually CNAME or A record)
3. Enable HTTPS (usually automatic)

---

## Environment Variables

For apps using `callAI`, you may need API keys. Options:

1. **Client-side**: User enters their own API key (stored in localStorage)
2. **Proxy service**: Route through your own API endpoint
3. **Vibes.diy hosting**: Use vibes.diy's built-in AI proxy

---

## Performance Tips

1. **CDN caching**: ESM.sh caches modules globally
2. **Preload hints**: Add `<link rel="modulepreload">` for faster loads
3. **Service Worker**: Add offline support if needed

---

## Troubleshooting

**CORS errors**: Ensure your hosting serves proper CORS headers for ES modules

**Import map not working**: Check browser support (modern browsers only)

**Blank page**: Check browser console for JavaScript errors
