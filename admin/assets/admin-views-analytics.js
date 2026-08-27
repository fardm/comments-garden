/**
 * admin-views-analytics.js
 * Analytics view (Comment Volume, Top Posts, Sentiment Gauge)
 *
 * Registered on the global VIEWS object by admin-app.js.
 * Depends on globals: API_URL, apiFetch, escapeHtml, formatBytes (admin-common.js)
 */

// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
VIEWS['analytics'] = {
    title: 'Analytics',
    css: `
        .dashboard { display:flex; flex-direction:column; gap:1.5rem; margin-bottom:2rem; }
        .chart-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); padding:1.25rem 1.5rem; }
        .chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:.5rem; }
        .chart-title { font-size:.92rem; font-weight:600; color:#555; }
        .chart-subtitle { font-size:.75rem; font-weight:400; color:#aaa; margin-left:.4rem; }
        .toggle-group { display:flex; gap:.2rem; }
        .toggle-group button { padding:.22rem .7rem; border:1px solid #ddd; background:white; border-radius:3px; font-size:.78rem; cursor:pointer; color:#666; transition:all .15s; }
        .toggle-group button.active { background:var(--success); border-color:var(--success); color:white; }
        .toggle-group button:hover:not(.active) { border-color:var(--success); color:var(--success); }
        .chart-legend { display:flex; gap:1rem; flex-wrap:wrap; margin-top:.6rem; font-size:.8rem; }
        .legend-item { display:flex; align-items:center; gap:.3rem; color:#666; }
        .legend-swatch { width:10px; height:10px; border-radius:2px; flex-shrink:0; }
        .chart-empty { padding:2rem; text-align:center; color:#ccc; font-size:.9rem; }
        .chart-loading { padding:2rem; text-align:center; color:#bbb; font-size:.9rem; }
        #chart-tooltip { position:fixed; background:rgba(25,25,25,.92); color:#fff; padding:.45rem .7rem; border-radius:5px; font-size:.8rem; pointer-events:none; z-index:9999; display:none; line-height:1.7; max-width:220px; box-shadow:0 2px 8px rgba(0,0,0,.3); }
        sentiment-gauge { width:100%; max-width:400px; margin:0 auto; }
        @media (max-width:768px)  { .nav a { min-width:80px; font-size:.85rem; } sentiment-gauge { max-width:100%; } }`,

    html: () => `
        <div id="chart-tooltip"></div>
        <div class="container">
            <div class="stats">
                <div class="stat-card"><div class="stat-number" id="stat-total">—</div><div class="stat-label">Total Comments</div></div>
                <div class="stat-card"><div class="stat-number green" id="stat-approved">—</div><div class="stat-label">Approved</div></div>
                <div class="stat-card"><div class="stat-number yellow" id="stat-pending">—</div><div class="stat-label">Pending</div></div>
                <div class="stat-card"><div class="stat-number red" id="stat-spam">—</div><div class="stat-label">Spam</div></div>
            </div>
            <div class="dashboard" id="dashboard">
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title">Comment Volume Over Time</span>
                        <div class="toggle-group">
                            <button id="toggle-daily" class="active" onclick="setGranularity('daily')">Daily</button>
                            <button id="toggle-weekly" onclick="setGranularity('weekly')">Weekly</button>
                            <button id="toggle-monthly" onclick="setGranularity('monthly')">Monthly</button>
                        </div>
                    </div>
                    <div id="timeline-chart"><div class="chart-loading">Loading…</div></div>
                    <div class="chart-legend">
                        <span class="legend-item"><span class="legend-swatch" style="background:var(--success)"></span>Approved</span>
                        <span class="legend-item"><span class="legend-swatch" style="background:#ffc107"></span>Pending</span>
                        <span class="legend-item"><span class="legend-swatch" style="background:#dc3545"></span>Spam</span>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-header"><span class="chart-title">Top Posts by Comment Volume</span></div>
                    <div id="top-posts-chart"><div class="chart-loading">Loading…</div></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header"><span class="chart-title">Sentiment Gauge</span></div>
                    <sentiment-gauge id="admin-sentiment-gauge"></sentiment-gauge>
                </div>
            </div>
        </div>`,

    async init({ hoistToWindow }) {
        let analyticsData      = null;
        let currentGranularity = 'daily';

        const [analyticsResult, reactionsResult] = await Promise.all([
            apiFetch(`${API_URL}/admin/analytics?_=${Date.now()}`, { noStore: true }),
            apiFetch(`${API_URL}/reactions/post/summary?_=${Date.now()}`, { noStore: true })
        ]);
        if (analyticsResult.ok) { try { loadAnalytics(analyticsResult.data); } catch (e) { console.error('loadAnalytics failed:', e); } }
        if (reactionsResult.ok) { try { loadSentimentGauge(reactionsResult.data); } catch (e) { console.error('loadSentimentGauge failed:', e); } }

        function loadAnalytics(data) {
            analyticsData = data;
            const st    = data.status_totals;
            const total = (st.approved || 0) + (st.pending || 0) + (st.spam || 0) + (st.deleted || 0);
            document.getElementById('stat-total').textContent      = fmt(total);
            document.getElementById('stat-approved').textContent   = fmt(st.approved || 0);
            document.getElementById('stat-pending').textContent    = fmt(st.pending  || 0);
            document.getElementById('stat-spam').textContent       = fmt(st.spam     || 0);
            try { renderTimeline(); } catch (e) { console.error('renderTimeline failed:', e); }
            try { renderTopPosts(data.top_posts || []); } catch (e) { console.error('renderTopPosts failed:', e); }
        }

        function loadSentimentGauge(data) {
            const gauge = document.getElementById('admin-sentiment-gauge');
            if (!gauge) return;
            const pages = data.pages || [];
            const totals = {};
            // Map API key 'dislike' to the component's key 'thumbsdown'
            const KEY_MAP = { dislike: 'thumbsdown' };
            pages.forEach(page => {
                const reactions = page.reactions || {};
                for (const [type, count] of Object.entries(reactions)) {
                    const key = KEY_MAP[type] || type;
                    totals[key] = (totals[key] || 0) + (parseInt(count) || 0);
                }
            });
            gauge.data = totals;
        }

        function setGranularity(g) {
            currentGranularity = g;
            ['daily','weekly','monthly'].forEach(k =>
                document.getElementById('toggle-' + k)?.classList.toggle('active', k === g));
            renderTimeline();
        }

        function renderTimeline() {
            if (!analyticsData) return;
            const buckets = analyticsData.timeline[currentGranularity] || [];
            const el = document.getElementById('timeline-chart');
            if (!el) return;
            if (!buckets.length) { el.innerHTML = '<div class="chart-empty">No data for this period</div>'; return; }
            const W=900,H=210,PL=42,PR=12,PT=14,PB=34,cW=W-PL-PR,cH=H-PT-PB,n=buckets.length;
            const maxRaw=Math.max(...buckets.map(b=>b.total),1);
            const ticks=niceTicks(maxRaw,4),maxVal=ticks[ticks.length-1];
            let yLines='';
            for(const t of ticks){const y=(PT+cH-(t/maxVal)*cH).toFixed(1);yLines+=`<line x1="${PL}" x2="${W-PR}" y1="${y}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/><text x="${PL-5}" y="${+y+4}" text-anchor="end" font-size="10" fill="#c0c0c0">${t>=1000?(t/1000).toFixed(t%1000===0?0:1)+'k':t}</text>`;}
            const slotW=cW/n,barW=Math.max(1.5,Math.min(slotW*.8,48)),barOff=(slotW-barW)/2;
            const labelEvery=Math.max(1,Math.round(n/9));
            let bars='',xLabels='';
            buckets.forEach((b,i)=>{
                const bx=(PL+i*slotW+barOff).toFixed(2);let y=PT+cH;
                const seg=(count,color)=>{const bh=count>0?Math.max(1.2,(count/maxVal)*cH):0;if(bh<.5)return'';y-=bh;return`<rect x="${bx}" y="${y.toFixed(2)}" width="${(+barW).toFixed(2)}" height="${bh.toFixed(2)}" fill="${color}"/>`;};
                const other=Math.max(0,b.total-b.approved-b.pending-b.spam);
                bars+=`<g>${seg(other,'#adb5bd')}${seg(b.spam,'#dc3545')}${seg(b.pending,'#ffc107')}${seg(b.approved,'var(--success)')}</g>`;
                bars+=`<rect class="tt-bar" x="${(PL+i*slotW).toFixed(2)}" y="${PT}" width="${slotW.toFixed(2)}" height="${cH}" fill="rgba(0,0,0,0)" pointer-events="all" data-i="${i}"/>`;
                if(i%labelEvery===0||i===n-1){xLabels+=`<text x="${(PL+i*slotW+slotW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="9.5" fill="#c0c0c0">${fmtPeriod(b.period,currentGranularity)}</text>`;}
            });
            const axes=`<line x1="${PL}" x2="${PL}" y1="${PT}" y2="${PT+cH}" stroke="#e8e8e8"/><line x1="${PL}" x2="${W-PR}" y1="${PT+cH}" y2="${PT+cH}" stroke="#e8e8e8"/>`;
            el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;overflow:visible">${yLines}${axes}${bars}${xLabels}</svg>`;
            const ttEl=document.getElementById('chart-tooltip');
            el.querySelectorAll('.tt-bar').forEach(r=>{
                r.addEventListener('mouseenter',e=>{const b=buckets[+r.dataset.i];const pct=b.total>0?Math.round(b.spam/b.total*100):0;showTip(ttEl,e,`<strong>${b.period}</strong><br>Total: <strong>${b.total}</strong><br>✅ ${b.approved}&ensp;⏳ ${b.pending}&ensp;🚫 ${b.spam} (${pct}%)`);});
                r.addEventListener('mousemove',e=>moveTip(ttEl,e));r.addEventListener('mouseleave',()=>hideTip(ttEl));
            });
        }        function renderTopPosts(posts) {
            const el=document.getElementById('top-posts-chart');if(!el)return;
            if(!posts.length){el.innerHTML='<div class="chart-empty">No posts yet</div>';return;}
            const W=700,ROW=24,URL_X=0,URL_W=210,BAR_GAP=10,COUNT_GAP=6,BAR_W=W-URL_W-BAR_GAP-COUNT_GAP-36,H=posts.length*ROW;
            const maxVal=Math.max(...posts.map(p=>p.total),1);let rows='';
            posts.forEach((p,i)=>{
                const y=i*ROW;
                const tw=(p.total/maxVal)*BAR_W;
                const aw=p.total>0?(p.approved/p.total)*tw:0;
                const pw=p.total>0?(p.pending/p.total)*tw:0;
                const sw=p.total>0?(p.spam/p.total)*tw:0;
                const ow=Math.max(0,tw-aw-pw-sw);
                const barH=10,by=y+(ROW-barH)/2;
                let bx=URL_W+BAR_GAP;
                const addSeg=(w,color)=>{if(w<.5)return;rows+=`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="1"/>`;bx+=w;};
                addSeg(aw,'var(--success)');addSeg(pw,'#ffc107');addSeg(sw,'#dc3545');addSeg(ow,'#adb5bd');
                rows+=`<text x="${URL_X}" y="${(y+ROW/2+3.5).toFixed(1)}" font-size="9.5" fill="#555">${escapeHtml(truncUrl(p.page_url,32))}</text>`;
                rows+=`<text x="${URL_W+BAR_GAP+tw+COUNT_GAP}" y="${(y+ROW/2+3.5).toFixed(1)}" font-size="9" fill="#999">${p.total}</text>`;
                if(i<posts.length-1)rows+=`<line x1="0" x2="${W}" y1="${y+ROW}" y2="${y+ROW}" stroke="#f0f0f0" stroke-width="0.5"/>`;
                rows+=`<rect x="0" y="${y}" width="${W}" height="${ROW}" fill="rgba(0,0,0,0)" pointer-events="all" class="post-ov" data-i="${i}"/>`;
            });
            el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">${rows}</svg>`;
            const ttEl=document.getElementById('chart-tooltip');
            el.querySelectorAll('.post-ov').forEach(r=>{r.addEventListener('mouseenter',e=>{const p=posts[+r.dataset.i];const pct=p.total>0?Math.round(p.spam/p.total*100):0;showTip(ttEl,e,`<strong>${escapeHtml(p.page_url)}</strong><br>Total: <strong>${p.total}</strong><br>✅ ${p.approved}&ensp;⏳ ${p.pending}&ensp;🚫 ${p.spam} (${pct}%)`);});r.addEventListener('mousemove',e=>moveTip(ttEl,e));r.addEventListener('mouseleave',()=>hideTip(ttEl));});
        }


        function showTip(ttEl,e,html){if(!ttEl)return;ttEl.innerHTML=html;ttEl.style.display='block';moveTip(ttEl,e);}
        function moveTip(ttEl,e){if(!ttEl)return;const margin=14;let x=e.clientX+margin,y=e.clientY-margin;const tw=ttEl.offsetWidth,th=ttEl.offsetHeight;if(x+tw>window.innerWidth-8)x=e.clientX-tw-margin;if(y+th>window.innerHeight-8)y=e.clientY-th-margin;if(y<4)y=4;ttEl.style.left=x+'px';ttEl.style.top=y+'px';}
        function hideTip(ttEl){if(ttEl)ttEl.style.display='none';}
        function niceTicks(maxVal,count){if(!maxVal)return[0,1];const rough=maxVal/count,mag=Math.pow(10,Math.floor(Math.log10(rough)));const nice=[1,2,2.5,5,10].map(f=>f*mag).find(f=>f>=rough)||mag*10;const ticks=[];for(let v=0;v<=maxVal*1.05;v+=nice){ticks.push(Math.round(v));if(ticks.length>8)break;}if(!ticks.includes(0))ticks.unshift(0);return ticks;}
        function fmtPeriod(period,gran){const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];if(gran==='daily'){const[y,m,d]=period.split('-');return M[+m-1]+' '+ +d;}if(gran==='weekly')return period.replace(/^\d{4}-W0?/,'W');if(gran==='monthly'){const[y,m]=period.split('-');return M[+m-1]+' \''+y.slice(2);}return period;}
        function truncUrl(url,max){const s=url.replace(/^https?:\/\//,'');return s.length>max?'…'+s.slice(-(max-1)):s;}
        function fmt(n){return Number(n).toLocaleString();}

        hoistToWindow({ setGranularity });
    },
};


