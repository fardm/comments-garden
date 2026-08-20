/**
 * admin-layout.js
 * Injects the shared login section and navigation header into every admin page.
 *
 * Usage:
 *   1. Add data-page="<key>" to <body>  (see NAV_ITEMS below for valid keys)
 *   2. Place <script src="assets/admin-layout.js"></script> as the FIRST script in <body>,
 *      before admin-common.js and the page script.
 *   3. Remove the hand-written #login-section and <header> blocks from the page.
 *
 * The script runs synchronously during HTML parsing via document.write, so the
 * injected nodes are in the DOM before any other script executes.
 */

(function () {
    'use strict';

    // ── Navigation definition ─────────────────────────────────────────────────
    // Each entry: [data-page key, href, link label]
    var NAV_ITEMS = [
        ['pending',        'admin.html',                'Pending'],
        ['all',            'admin-all.html',            'All Comments'],
        ['post-reactions', 'admin-post-reactions.html', 'Post Reactions'],
        ['analytics',      'admin-analytics.html',      'Analytics'],

    ];

    // ── Determine active page ─────────────────────────────────────────────────
    // Read data-page from <body>. Falls back to filename matching if not set.
    function getActivePage() {
        // document.body may not exist yet during document.write execution,
        // so we read it from the currentScript's ownerDocument body lazily.
        // The attribute is set before this script tag, so it is already parsed.
        var body = document.body || document.getElementsByTagName('body')[0];
        if (body && body.getAttribute('data-page')) {
            return body.getAttribute('data-page');
        }
        // Fallback: derive from filename
        var path = window.location.pathname;
        var file = path.substring(path.lastIndexOf('/') + 1);
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            if (NAV_ITEMS[i][1] === file) return NAV_ITEMS[i][0];
        }
        return '';
    }

    // ── Build nav links ───────────────────────────────────────────────────────
    function buildNavLinks(activePage) {
        var html = '';
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            var key    = NAV_ITEMS[i][0];
            var href   = NAV_ITEMS[i][1];
            var label  = NAV_ITEMS[i][2];
            var active = (key === activePage) ? ' class="active"' : '';
            html += '<a href="' + href + '"' + active + '>' + label + '</a>';
        }
        html += '<a href="#" onclick="AdminAuth.logout(); return false;" class="logout-btn">Logout</a>';
        return html;
    }

    // ── Build the two shared HTML blocks ──────────────────────────────────────
    function buildLoginSection() {
        return [
            '<div id="login-section">',
            '    <h2 style="margin-bottom: 1.5rem;">Admin Login</h2>',
            '    <div id="login-message"></div>',
            '    <form id="login-form">',
            '        <div class="form-group">',
            '            <label for="password">Password</label>',
            '            <input type="password" id="password" required>',
            '        </div>',
            '        <button type="submit" class="btn btn-primary" style="width: 100%;">Login</button>',
            '    </form>',
            '</div>',
        ].join('\n');
    }

    function buildHeader(activePage) {
        return [
            '<header>',
            '    <h1>Comment System Admin</h1>',
            '    <div class="nav">',
            '        ' + buildNavLinks(activePage),
            '    </div>',
            '    <div class="section-icons">',
            '        <label class="theme-switch">',
            '            <input type="checkbox" id="toggle-switch">',
            '            <div id="toggle-icon" class="header-icon"></div>',
            '        </label>',
            '    </div>',
            '</header>',
        ].join('\n');
    }

    // ── Inject ────────────────────────────────────────────────────────────────
    var activePage = getActivePage();

    // document.write is safe here: the script is inline in <body> during parsing.
    // It inserts the HTML at the exact position of this <script> tag.
    document.write(buildLoginSection());
    document.write(buildHeader(activePage));

})();
