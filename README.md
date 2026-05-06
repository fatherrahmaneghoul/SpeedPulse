# ⚡ SpeedPulse

> Real internet speed diagnostics — no plugins, no account needed.

![License](https://img.shields.io/badge/license-MIT-blue)
![HTML](https://img.shields.io/badge/built_with-HTML%2FCSS%2FJS-orange)

## Features
- Real download measurement via Cloudflare CDN streaming
- Real upload measurement via timed HTTP POST
- Ping tested as median of 6 round-trips
- Auto-detects nearest server & your public IP
- Test history with visual bar chart (localStorage)
- Fully responsive — works on mobile

## How it works
Uses Cloudflare's `speed.cloudflare.com` endpoints and
`1.1.1.1/cdn-cgi/trace` — no backend required.

## Getting started
```bash
git clone https://github.com/fatherrahmaneghoul/SpeedPulse.git
```
Open `index.html` in any modern browser.

## Tech stack
HTML · CSS · Vanilla JavaScript · Cloudflare CDN

## License
MIT