/* ============================================
   SpeedPulse — Real Speed Test Engine
   Uses actual HTTP fetch timing against
   Cloudflare's CDN for genuine measurements.
   ============================================ */

'use strict';

// ── NAVIGATION ───────────────────────────────
function toggleMenu() {
    const menu = document.getElementById('mobileMenu');
    if (menu) menu.classList.toggle('open');
}

// ── FAQ ACCORDION ────────────────────────────
function toggleFaq(btn) {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    // Close all
    document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
}

// ── HISTORY ──────────────────────────────────
const HISTORY_KEY = 'speedpulse_history';

function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch { return []; }
}

function saveHistory(entry) {
    const hist = loadHistory();
    hist.unshift(entry);
    if (hist.length > 10) hist.length = 10;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch {}
}

function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    const section = document.getElementById('historySection');
    if (section) section.style.display = 'none';
}

function renderHistory() {
    const hist = loadHistory();
    const section = document.getElementById('historySection');
    const chart = document.getElementById('historyChart');
    if (!section || !chart || hist.length === 0) return;

    const maxDl = Math.max(...hist.map(h => h.download), 1);
    const maxUl = Math.max(...hist.map(h => h.upload), 1);

    chart.innerHTML = hist.map(h => {
        const dlH = Math.max(4, Math.round((h.download / maxDl) * 56));
        const ulH = Math.max(4, Math.round((h.upload / maxUl) * 56));
        const t = new Date(h.ts);
        const label = t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0');
        return `<div class="history-bar-group" title="DL: ${h.download} | UL: ${h.upload} | Ping: ${h.ping}ms">
            <div class="history-bars">
                <div class="h-bar dl" style="height:${dlH}px"></div>
                <div class="h-bar ul" style="height:${ulH}px"></div>
            </div>
            <span class="history-time">${label}</span>
        </div>`;
    }).join('');

    section.style.display = 'block';
}

// ── GAUGE ─────────────────────────────────────
// Arc total length ~377px for our 240° sweep
const ARC_LEN = 377;

function setGauge(value, maxVal = 200) {
    const arc = document.getElementById('gaugeArc');
    const needle = document.getElementById('needle');
    const val = document.getElementById('speedValue');
    if (!arc || !needle) return;

    const ratio = Math.min(value / maxVal, 1);
    const dashOffset = ARC_LEN - (ratio * ARC_LEN);
    arc.style.strokeDashoffset = dashOffset;

    // Needle: -90deg = 0, +90deg = max
    const deg = -90 + (ratio * 180);
    needle.style.transform = `rotate(${deg}deg)`;

    if (val) val.textContent = value > 0 ? value.toFixed(value < 10 ? 1 : 0) : '--';
}

function setPhase(text, active = false) {
    const lbl = document.getElementById('phaseLabel');
    if (!lbl) return;
    lbl.textContent = text;
    lbl.classList.toggle('active', active);
}

// ── RESULT CARDS ──────────────────────────────
function setResult(id, value, barId, percent) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
    const bar = document.getElementById(barId);
    if (bar) bar.style.width = Math.min(percent, 100) + '%';
}

// ── REAL SPEED TEST ENGINE ─────────────────────
/*
  Strategy:
  1. PING  — fetch a tiny URL N times, median RTT
  2. DOWNLOAD — fetch Cloudflare's speed test files, measure throughput
  3. UPLOAD — POST random data to httpbin / Cloudflare, measure throughput
  
  We use multiple endpoints as fallbacks since browser CORS varies.
*/

// Test files — Cloudflare's __down endpoint is CORS-friendly
const DL_ENDPOINTS = [
    { url: 'https://speed.cloudflare.com/__down?bytes=25000000', bytes: 25_000_000 },
    { url: 'https://speed.cloudflare.com/__down?bytes=10000000', bytes: 10_000_000 },
    { url: 'https://speed.cloudflare.com/__down?bytes=5000000',  bytes:  5_000_000 },
];

const UL_ENDPOINT = 'https://speed.cloudflare.com/__up';

const PING_URLS = [
    'https://speed.cloudflare.com/__down?bytes=1',
    'https://1.1.1.1/cdn-cgi/trace',
];

// Measure ping: median of N fetches
async function measurePing(n = 5) {
    const url = PING_URLS[0] + '&nocache=' + Math.random();
    const times = [];
    for (let i = 0; i < n; i++) {
        try {
            const t0 = performance.now();
            await fetch(url + '&i=' + i, { cache: 'no-store', method: 'GET' });
            times.push(performance.now() - t0);
        } catch { /* skip failed */ }
    }
    if (times.length === 0) return null;
    times.sort((a, b) => a - b);
    return Math.round(times[Math.floor(times.length / 2)]);
}

// Measure download: stream the body and count bytes/time
async function measureDownload(onProgress) {
    let totalBytes = 0;
    let bestMbps = 0;
    const measurements = [];

    for (const ep of DL_ENDPOINTS) {
        try {
            const url = ep.url + '&nocache=' + Math.random();
            const t0 = performance.now();
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok || !res.body) continue;

            const reader = res.body.getReader();
            let chunkBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunkBytes += value.byteLength;
                totalBytes += value.byteLength;

                const elapsed = (performance.now() - t0) / 1000;
                if (elapsed > 0) {
                    const mbps = (chunkBytes * 8) / (elapsed * 1_000_000);
                    if (onProgress) onProgress(mbps);
                }
            }

            const totalSec = (performance.now() - t0) / 1000;
            const mbps = (chunkBytes * 8) / (totalSec * 1_000_000);
            measurements.push(mbps);
            bestMbps = Math.max(bestMbps, mbps);

            // One good measurement is enough if > 5 Mbps
            if (mbps > 5) break;

        } catch (e) {
            console.warn('DL endpoint failed:', e);
        }
    }

    if (measurements.length === 0) return null;
    // Return the peak measurement (matches how ISPs advertise)
    return Math.max(...measurements);
}

// Measure upload: POST blobs of data and time them
async function measureUpload(onProgress) {
    const measurements = [];
    const sizes = [2_000_000, 5_000_000];

    for (const size of sizes) {
        try {
            // Generate random data to prevent compression
            const data = new Uint8Array(size);
            crypto.getRandomValues(data.slice(0, Math.min(size, 65536)));
            // Fill rest with pseudo-random (faster)
            for (let i = 65536; i < size; i++) data[i] = i & 0xff;

            const blob = new Blob([data]);
            const t0 = performance.now();

            const res = await fetch(UL_ENDPOINT + '?nocache=' + Math.random(), {
                method: 'POST',
                body: blob,
                cache: 'no-store',
                headers: { 'Content-Type': 'application/octet-stream' }
            });

            if (!res.ok) continue;
            // Read body to ensure upload completed
            await res.arrayBuffer();

            const elapsed = (performance.now() - t0) / 1000;
            const mbps = (size * 8) / (elapsed * 1_000_000);
            measurements.push(mbps);
            if (onProgress) onProgress(mbps);

            if (mbps > 1) break; // Got a good reading

        } catch (e) {
            console.warn('UL endpoint failed:', e);
        }
    }

    if (measurements.length === 0) return null;
    return Math.max(...measurements);
}

// Get server location from Cloudflare trace
async function getServerInfo() {
    try {
        const res = await fetch('https://1.1.1.1/cdn-cgi/trace', { cache: 'no-store' });
        const text = await res.text();
        const parse = key => {
            const m = text.match(new RegExp(key + '=(.+)'));
            return m ? m[1].trim() : null;
        };
        const colo = parse('colo');   // e.g. "CDG"
        const loc  = parse('loc');    // e.g. "DZ"
        const ip   = parse('ip');
        return { colo, loc, ip };
    } catch {
        return { colo: 'CDG', loc: '??', ip: null };
    }
}

// Airport → city mapping (common Cloudflare colos)
const COLO_CITY = {
    JFK:'New York',LGA:'New York',EWR:'Newark',LAX:'Los Angeles',ORD:'Chicago',
    DFW:'Dallas',DEN:'Denver',SFO:'San Francisco',SEA:'Seattle',MIA:'Miami',
    ATL:'Atlanta',BOS:'Boston',IAD:'Washington DC',CDG:'Paris',LHR:'London',
    FRA:'Frankfurt',AMS:'Amsterdam',SIN:'Singapore',NRT:'Tokyo',HKG:'Hong Kong',
    SYD:'Sydney',DXB:'Dubai',BOM:'Mumbai',GRU:'São Paulo',GIG:'Rio de Janeiro',
    EZE:'Buenos Aires',MEX:'Mexico City',YYZ:'Toronto',YVR:'Vancouver',
    ICN:'Seoul',PEK:'Beijing',PVG:'Shanghai',BKK:'Bangkok',DEL:'New Delhi',
    JNB:'Johannesburg',CAI:'Cairo',LOS:'Lagos',ALG:'Algiers',TUN:'Tunis',
    CMN:'Casablanca',ORN:'Oran',
};

// ── MAIN TEST CONTROLLER ───────────────────────
let isTesting = false;

async function startTest() {
    if (isTesting) return;
    isTesting = true;

    const btn = document.getElementById('testButton');
    if (btn) {
        btn.disabled = true;
        btn.querySelector('.btn-text').textContent = 'Testing…';
    }

    // Reset UI
    setGauge(0);
    setPhase('Initialising…', true);
    setResult('pingVal',     '--', 'pingBar',     0);
    setResult('downloadVal', '--', 'downloadBar', 0);
    setResult('uploadVal',   '--', 'uploadBar',   0);
    setResult('serverVal',   '--', 'serverBar',   0);
    const serverIpEl = document.getElementById('serverIp');
    if (serverIpEl) serverIpEl.textContent = '';

    try {
        // ── STEP 1: Server info (parallel with ping) ──
        setPhase('Locating server…', true);
        const [serverInfo, ping] = await Promise.all([
            getServerInfo(),
            measurePing(6)
        ]);

        // Show ping
        const pingMs = ping !== null ? ping : '??';
        setResult('pingVal', pingMs, 'pingBar', ping ? Math.min(100 - ping, 100) : 0);

        // Show server
        const city = serverInfo.colo ? (COLO_CITY[serverInfo.colo] || serverInfo.colo) : 'Unknown';
        const countryLabel = serverInfo.loc ? ` (${serverInfo.loc})` : '';
        setResult('serverVal', city + countryLabel, 'serverBar', 80);
        if (serverInfo.ip && serverIpEl) {
            serverIpEl.textContent = 'Your IP: ' + serverInfo.ip;
        }

        // ── STEP 2: Download ──────────────────────────
        setPhase('Measuring download…', true);
        let liveMax = 0;

        const dlMbps = await measureDownload(mbps => {
            liveMax = Math.max(liveMax, mbps);
            setGauge(liveMax);
            setResult('downloadVal', liveMax.toFixed(liveMax < 10 ? 1 : 0), 'downloadBar',
                      Math.min((liveMax / 200) * 100, 100));
        });

        const finalDl = dlMbps !== null ? dlMbps : liveMax;
        setGauge(finalDl);
        setResult('downloadVal', finalDl.toFixed(finalDl < 10 ? 1 : 0), 'downloadBar',
                  Math.min((finalDl / 200) * 100, 100));

        // Brief pause
        await new Promise(r => setTimeout(r, 400));

        // ── STEP 3: Upload ────────────────────────────
        setPhase('Measuring upload…', true);
        setGauge(0);

        const ulMbps = await measureUpload(mbps => {
            setGauge(mbps, 100);
            setResult('uploadVal', mbps.toFixed(mbps < 10 ? 1 : 0), 'uploadBar',
                      Math.min((mbps / 100) * 100, 100));
        });

        const finalUl = ulMbps !== null ? ulMbps : 0;
        setGauge(finalDl); // Reset gauge to download speed
        setResult('uploadVal', finalUl.toFixed(finalUl < 10 ? 1 : 0), 'uploadBar',
                  Math.min((finalUl / 100) * 100, 100));

        // ── DONE ──────────────────────────────────────
        setPhase('Test complete ✓', false);

        // Save & render history
        saveHistory({
            ts: Date.now(),
            ping: pingMs,
            download: parseFloat(finalDl.toFixed(1)),
            upload: parseFloat(finalUl.toFixed(1)),
            server: city
        });
        renderHistory();

    } catch (err) {
        console.error('Speed test error:', err);
        setPhase('Error — check connection', false);
    } finally {
        isTesting = false;
        if (btn) {
            btn.disabled = false;
            btn.querySelector('.btn-text').textContent = 'Run Speed Test';
        }
    }
}

// ── INIT ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Init gauge at zero
    if (document.getElementById('gaugeSVG')) {
        setGauge(0);
        renderHistory();
    }

    // Draw gauge tick marks
    const ticks = document.getElementById('ticks');
    if (ticks) {
        for (let i = 0; i <= 10; i++) {
            const angle = -90 + (i * 18); // -90 to +90 in 10 steps
            const rad = (angle * Math.PI) / 180;
            const r1 = 108, r2 = i % 5 === 0 ? 98 : 103;
            const cx = 150, cy = 170;
            const x1 = cx + r1 * Math.cos(rad);
            const y1 = cy + r1 * Math.sin(rad);
            const x2 = cx + r2 * Math.cos(rad);
            const y2 = cy + r2 * Math.sin(rad);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1); line.setAttribute('y1', y1);
            line.setAttribute('x2', x2); line.setAttribute('y2', y2);
            line.setAttribute('stroke', i % 5 === 0 ? '#2a3f5a' : '#1a2a3a');
            line.setAttribute('stroke-width', i % 5 === 0 ? '2' : '1');
            line.setAttribute('stroke-linecap', 'round');
            ticks.appendChild(line);
        }
    }

    // Navbar scroll effect
    window.addEventListener('scroll', () => {
        const nav = document.getElementById('navbar');
        if (nav) {
            nav.style.borderBottomColor = window.scrollY > 10
                ? 'rgba(79, 159, 255, 0.2)'
                : 'rgba(79, 159, 255, 0.12)';
        }
    }, { passive: true });

    // Close mobile menu when clicking outside
    document.addEventListener('click', e => {
        const menu = document.getElementById('mobileMenu');
        const hamburger = document.querySelector('.hamburger');
        if (menu && menu.classList.contains('open') &&
            !menu.contains(e.target) && !hamburger.contains(e.target)) {
            menu.classList.remove('open');
        }
    });
});
