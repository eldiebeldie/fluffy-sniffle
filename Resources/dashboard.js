    // Embedded Data for Instant Client-side Global Search
    const DASHBOARD_DATA = /*INJECT_DASHBOARD_DATA*/ {};

    let previousView = 'repos';
    let currentSearchCategory = 'all';
    let currentSearchResults = null;

    // Theme Management (Supports Dark, Light, Midnight, High Contrast - Section 508 / WCAG AAA)
    function setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      try {
        localStorage.setItem('fluffy-theme', theme);
      } catch (e) {}
      const select = document.getElementById('themeSelect');
      if (select && select.value !== theme) {
        select.value = theme;
      }
      console.log('[Dashboard:Theme] Switched theme to:', theme);
    }

    // Initialize Theme
    (function initTheme() {
      try {
        const saved = localStorage.getItem('fluffy-theme');
        if (saved) {
          setTheme(saved);
          return;
        }
      } catch (e) {}

      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light');
      } else {
        setTheme('dark');
      }
    })();

    // View Switching
    function switchView(view) {
      const viewRepos = document.getElementById('viewRepos');
      const viewUsers = document.getElementById('viewUsers');
      const viewSearch = document.getElementById('viewSearch');
      const btnViewRepos = document.getElementById('btnViewRepos');
      const btnViewUsers = document.getElementById('btnViewUsers');

      viewSearch.classList.add('hidden');

      if (view === 'users') {
        viewRepos.classList.add('hidden');
        viewUsers.classList.remove('hidden');
        btnViewRepos.classList.remove('active');
        btnViewRepos.setAttribute('aria-selected', 'false');
        btnViewUsers.classList.add('active');
        btnViewUsers.setAttribute('aria-selected', 'true');
        previousView = 'users';
        window.location.hash = 'users';
      } else {
        viewUsers.classList.add('hidden');
        viewRepos.classList.remove('hidden');
        btnViewUsers.classList.remove('active');
        btnViewUsers.setAttribute('aria-selected', 'false');
        btnViewRepos.classList.add('active');
        btnViewRepos.setAttribute('aria-selected', 'true');
        previousView = 'repos';
        window.location.hash = 'repos';
      }
      console.log('[Dashboard:View] Active view changed to:', view);
    }

    if (window.location.hash === '#users') {
      switchView('users');
    }

    // Escape regex characters
    function escapeRegExp(string) {
      return string.replace(/[.*+?^$\\{}()|[\\]\\\\]/g, '\\\\$&');
    }

    // Highlight text matching query
    function highlight(text, query) {
      if (!text) return '';
      if (!query) return escapeHtml(text);
      const safeText = String(text);
      const escapedQuery = escapeRegExp(query);
      const regex = new RegExp('(' + escapedQuery + ')', 'gi');
      return escapeHtml(safeText).replace(regex, '<mark>$1</mark>');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Global Search Engine
    function performSearch(query) {
      const q = query.toLowerCase().trim();
      if (!q) {
        clearSearch();
        return;
      }

      document.getElementById('searchClearBtn').style.display = 'block';

      // Hide standard panels, show search panel
      document.getElementById('viewRepos').classList.add('hidden');
      document.getElementById('viewUsers').classList.add('hidden');
      document.getElementById('viewSearch').classList.remove('hidden');

      const repos = DASHBOARD_DATA.results || [];
      const users = DASHBOARD_DATA.userActivities || [];

      // 1. Search PRs across all states
      const matchedPrs = [];
      repos.forEach(repo => {
        const prsList = repo.allPullRequests || repo.pullRequests || [];
        prsList.forEach(pr => {
          if (
            (pr.title && pr.title.toLowerCase().includes(q)) ||
            String(pr.number).includes(q) ||
            (pr.author && pr.author.toLowerCase().includes(q)) ||
            repo.fullName.toLowerCase().includes(q)
          ) {
            matchedPrs.push({ ...pr, repoFullName: repo.fullName });
          }
        });
      });

      // 2. Search Branches
      const matchedBranches = [];
      repos.forEach(repo => {
        (repo.branches || []).forEach(b => {
          if (
            (b.name && b.name.toLowerCase().includes(q)) ||
            (b.author && b.author.toLowerCase().includes(q)) ||
            repo.fullName.toLowerCase().includes(q)
          ) {
            matchedBranches.push({ ...b, repoFullName: repo.fullName });
          }
        });
      });

      // 3. Search Contributors
      const matchedUsers = users.filter(u =>
        u.username.toLowerCase().includes(q) ||
        u.repositories.some(r => r.toLowerCase().includes(q))
      );

      // 4. Search Repositories
      const matchedRepos = repos.filter(r =>
        r.fullName.toLowerCase().includes(q) ||
        r.defaultBranch.toLowerCase().includes(q)
      );

      const totalMatches = matchedPrs.length + matchedBranches.length + matchedUsers.length + matchedRepos.length;

      // Update counters
      document.getElementById('countSearchAll').textContent = totalMatches;
      document.getElementById('countSearchPrs').textContent = matchedPrs.length;
      document.getElementById('countSearchBranches').textContent = matchedBranches.length;
      document.getElementById('countSearchUsers').textContent = matchedUsers.length;
      document.getElementById('countSearchRepos').textContent = matchedRepos.length;

      document.getElementById('searchSummaryTitle').innerHTML = '🔍 Search Results for "' + escapeHtml(query) + '"';
      document.getElementById('searchSummarySubtitle').textContent = 'Found ' + totalMatches + ' matching items across all tracked repositories';

      console.log('[Dashboard:Search] Searched for: "' + query + '" -> Found ' + totalMatches + ' matches');
      currentSearchResults = { q, matchedPrs, matchedBranches, matchedUsers, matchedRepos };
      renderSearchResults();
    }

    function filterSearchType(type) {
      currentSearchCategory = type;
      ['all', 'prs', 'branches', 'users', 'repos'].forEach(t => {
        const id = 'chip' + t.charAt(0).toUpperCase() + t.slice(1);
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', t === type);
      });
      console.log('[Dashboard:SearchFilter] Filter category changed to:', type);
      renderSearchResults();
    }

    function renderSearchResults() {
      if (!currentSearchResults) return;
      const { q, matchedPrs, matchedBranches, matchedUsers, matchedRepos } = currentSearchResults;
      const container = document.getElementById('searchResultsContent');
      let html = '';

      const showAll = currentSearchCategory === 'all';

      // Repositories Section
      if ((showAll || currentSearchCategory === 'repos') && matchedRepos.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">🏢 Matching Repositories (' + matchedRepos.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Repository</th><th scope="col" style="text-align: center;">Branches</th><th scope="col" style="text-align: center;">Stale</th><th scope="col" style="text-align: center;">Open PRs</th><th scope="col" style="text-align: center;">Inactive PRs</th></tr></thead><tbody>';
        matchedRepos.forEach(r => {
          html += '<tr>';
          html += '<td><strong><a href="https://github.com/' + escapeHtml(r.fullName) + '" target="_blank">' + highlight(r.fullName, q) + '</a></strong></td>';
          html += '<td style="text-align: center;">' + r.totalBranches + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-warning">🍂 ' + r.staleBranchesCount + '</span></td>';
          html += '<td style="text-align: center;">' + r.totalOpenPrs + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-warning">⏳ ' + r.stalePrsCount + '</span></td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Pull Requests Section (Includes open, merged, closed)
      if ((showAll || currentSearchCategory === 'prs') && matchedPrs.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">🔀 Matching Pull Requests (' + matchedPrs.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Repository</th><th scope="col">PR</th><th scope="col">Title</th><th scope="col">Author</th><th scope="col" style="text-align: center;">Status</th><th scope="col" style="text-align: center;">Age</th><th scope="col" style="text-align: center;">Activity</th></tr></thead><tbody>';
        matchedPrs.forEach(pr => {
          let stateBadge = '<span class="badge badge-healthy">🟢 Open</span>';
          if (pr.state === 'MERGED') {
            stateBadge = '<span class="badge badge-merged">🟣 Merged</span>';
          } else if (pr.state === 'CLOSED') {
            stateBadge = '<span class="badge badge-closed">⚪ Closed</span>';
          }
          if (pr.isDraft) {
            stateBadge += ' <span class="badge badge-draft">Draft</span>';
          }

          html += '<tr>';
          html += '<td><span class="badge badge-tag">' + highlight(pr.repoFullName, q) + '</span></td>';
          html += '<td><a href="' + escapeHtml(pr.url) + '" target="_blank"><strong>#' + highlight(pr.number, q) + '</strong></a></td>';
          html += '<td><a href="' + escapeHtml(pr.url) + '" target="_blank">' + highlight(pr.title, q) + '</a></td>';
          html += '<td>' + highlight(pr.author, q) + '</td>';
          html += '<td style="text-align: center;">' + stateBadge + '</td>';
          html += '<td style="text-align: center;">' + pr.ageDays + 'd</td>';
          html += '<td style="text-align: center;">' + (pr.isStalePr ? '<span class="badge badge-warning">⏳ ' + pr.daysSinceLastUpdate + 'd inactive</span>' : pr.daysSinceLastUpdate + 'd ago') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Branches Section
      if ((showAll || currentSearchCategory === 'branches') && matchedBranches.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">🍂 Matching Branches (' + matchedBranches.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Repository</th><th scope="col">Branch</th><th scope="col" style="text-align: center;">Inactive Days</th><th scope="col">Last Author</th><th scope="col" style="text-align: center;">Open PR?</th></tr></thead><tbody>';
        matchedBranches.forEach(b => {
          const branchUrl = 'https://github.com/' + escapeHtml(b.repoFullName) + '/tree/' + encodeURIComponent(b.name);
          const badgeClass = b.isVeryStale ? 'badge-danger' : (b.isStale ? 'badge-warning' : 'badge-healthy');
          html += '<tr>';
          html += '<td><span class="badge badge-tag">' + highlight(b.repoFullName, q) + '</span></td>';
          html += '<td><a href="' + branchUrl + '" target="_blank"><code>' + highlight(b.name, q) + '</code></a></td>';
          html += '<td style="text-align: center;"><span class="badge ' + badgeClass + '">' + (b.daysInactive !== null ? b.daysInactive + 'd' : 'Active') + '</span></td>';
          html += '<td>' + highlight(b.author, q) + '</td>';
          html += '<td style="text-align: center;">' + (b.hasOpenPr ? '<span class="badge badge-healthy">✔ Yes</span>' : '<span style="color: var(--text-muted)">No</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Contributors Section
      if ((showAll || currentSearchCategory === 'users') && matchedUsers.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">👤 Matching Contributors (' + matchedUsers.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Contributor</th><th scope="col">Repositories</th><th scope="col" style="text-align: center;">All-Time PRs</th><th scope="col" style="text-align: center;">All-Time Branches</th><th scope="col" style="text-align: center;">Items to Review</th></tr></thead><tbody>';
        matchedUsers.forEach(u => {
          const userAvatar = u.username && u.username !== 'unknown' ? 'https://github.com/' + encodeURIComponent(u.username) + '.png?size=40' : '';
          html += '<tr>';
          html += '<td><div class="user-flex">' + (userAvatar ? '<img src="' + userAvatar + '" class="user-avatar" alt="" onerror="this.style.display=\'none\'"> ' : '') + '<strong><a href="https://github.com/' + escapeHtml(u.username) + '" target="_blank">' + highlight(u.username, q) + '</a></strong></div></td>';
          html += '<td>' + u.repositories.map(repo => '<span class="badge badge-tag">' + highlight(repo, q) + '</span>').join('') + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-tag">' + u.allPrsCount + ' Total</span> ' + (u.mergedPrsCount > 0 ? '<span class="badge badge-merged">🟣 ' + u.mergedPrsCount + '</span>' : '') + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-tag">' + u.allBranchesCount + ' Total</span></td>';
          html += '<td style="text-align: center;">' + (u.totalNeedsAttention > 0 ? '<span class="badge badge-warning">⚠️ ' + u.totalNeedsAttention + ' items</span>' : '<span class="badge badge-healthy">✔ All Good</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      if (html === '') {
        html = '<div class="empty-state">No matching items found for "<strong>' + escapeHtml(q) + '</strong>".<br>Try searching by branch name, PR number, title, author handle, or repository name.</div>';
      }

      container.innerHTML = html;
    }

    // Contributor Activity Scope Switcher (All Times vs Needs Attention)
    function setContributorScope(scope) {
      const viewUsers = document.getElementById('viewUsers');
      const btnAllTime = document.getElementById('btnScopeAllTime');
      const btnAttention = document.getElementById('btnScopeAttention');
      const hint = document.getElementById('scopeHint');

      if (!viewUsers || !btnAllTime || !btnAttention) return;

      if (scope === 'attention') {
        viewUsers.classList.remove('scope-all-time');
        viewUsers.classList.add('scope-attention');
        btnAllTime.classList.remove('active');
        btnAttention.classList.add('active');
        btnAllTime.setAttribute('aria-checked', 'false');
        btnAttention.setAttribute('aria-checked', 'true');
        if (hint) hint.textContent = 'Showing items needing attention: open pull requests and stale branches.';
      } else {
        viewUsers.classList.remove('scope-attention');
        viewUsers.classList.add('scope-all-time');
        btnAttention.classList.remove('active');
        btnAllTime.classList.add('active');
        btnAttention.setAttribute('aria-checked', 'false');
        btnAllTime.setAttribute('aria-checked', 'true');
        if (hint) hint.textContent = 'Showing full contributor history: merged, open, and closed PRs plus all branches.';
      }

      try {
        localStorage.setItem('fluffy_contributor_scope', scope);
      } catch (e) {}
      console.log('[Dashboard:ContributorScope] Switched scope to:', scope);
    }

    // Filter PRs inside a specific User Card
    function filterUserPrs(userAnchor, state) {
      const table = document.getElementById('prTable_' + userAnchor);
      const tabs = document.getElementById('prTabs_' + userAnchor);
      if (!table) return;

      if (tabs) {
        tabs.querySelectorAll('.card-tab-btn').forEach(btn => {
          const isMatch = (state === 'all' && btn.textContent.startsWith('All')) ||
                          (state === 'OPEN' && btn.textContent.startsWith('Open')) ||
                          (state === 'MERGED' && btn.textContent.startsWith('Merged')) ||
                          (state === 'CLOSED' && btn.textContent.startsWith('Closed'));
          btn.classList.toggle('active', isMatch);
        });
      }

      table.querySelectorAll('tbody tr.user-pr-row').forEach(row => {
        if (state === 'all' || row.getAttribute('data-state') === state) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    // Filter Branches inside a specific User Card
    function filterUserBranches(userAnchor, status) {
      const table = document.getElementById('branchTable_' + userAnchor);
      const tabs = document.getElementById('branchTabs_' + userAnchor);
      if (!table) return;

      if (tabs) {
        tabs.querySelectorAll('.card-tab-btn').forEach(btn => {
          const isMatch = (status === 'all' && btn.textContent.startsWith('All')) ||
                          (status === 'active' && btn.textContent.startsWith('Active')) ||
                          (status === 'stale' && btn.textContent.startsWith('Stale'));
          btn.classList.toggle('active', isMatch);
        });
      }

      table.querySelectorAll('tbody tr.user-branch-row').forEach(row => {
        if (status === 'all' || row.getAttribute('data-status') === status) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    // Live search/filter specifically within Contributor Activities view
    function filterContributorList(query) {
      const q = query.toLowerCase().trim();
      document.querySelectorAll('.contributor-row').forEach(row => {
        const username = row.getAttribute('data-username') || '';
        row.style.display = (!q || username.includes(q)) ? '' : 'none';
      });
      document.querySelectorAll('.contributor-card').forEach(card => {
        const username = card.getAttribute('data-username') || '';
        card.style.display = (!q || username.includes(q)) ? '' : 'none';
      });
    }

    // Initialize Contributor Scope from localStorage
    (function initContributorScope() {
      try {
        const saved = localStorage.getItem('fluffy_contributor_scope');
        if (saved) {
          setContributorScope(saved);
        }
      } catch (e) {}
    })();

    console.log('[Dashboard] Loaded with', DASHBOARD_DATA.results.length, 'repositories and', DASHBOARD_DATA.userActivities.length, 'contributors.');

    function clearSearch() {
      console.log('[Dashboard:Search] Cleared search. Returning to view:', previousView);
      const input = document.getElementById('searchInput');
      input.value = '';
      document.getElementById('searchClearBtn').style.display = 'none';
      currentSearchResults = null;
      switchView(previousView);
    }

    // Live search input listener
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      performSearch(e.target.value);
    });

    // Keyboard Shortcuts: '/' to focus search, 'Escape' to clear
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        console.log('[Dashboard:Shortcut] Pressed / to focus search input');
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        console.log('[Dashboard:Shortcut] Pressed Escape to clear search');
        clearSearch();
        searchInput.blur();
      }
    });

    // Toast helper
    function showToast(message, type = 'info') {
      let toast = document.getElementById('toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
      }
      toast.className = 'toast';
      if (type === 'error') toast.style.background = 'var(--danger)';
      else if (type === 'success') toast.style.background = 'var(--success)';
      else toast.style.background = 'var(--accent)';
      toast.textContent = message;
      setTimeout(() => {
        toast.className = 'toast hidden';
      }, 4000);
    }

    // Trigger Scan via Server API
    async function triggerScan() {
      if (window.location.protocol === 'file:') {
        console.warn('[Dashboard:Scan] Trigger failed: page opened via file:// protocol.');
        alert('To trigger scans directly from the browser, please run the project server using: npm start');
        return;
      }

      console.log('[Dashboard:Action] Triggering repository health scan via POST /api/scan...');
      const btn = document.getElementById('triggerScanBtn');
      const icon = document.getElementById('scanBtnIcon');
      const text = document.getElementById('scanBtnText');

      btn.disabled = true;
      icon.classList.add('spinning');
      text.textContent = 'Scanning...';
      showToast('Starting repository health scan...', 'info');

      const reqStart = performance.now();
      try {
        const res = await fetch('/api/scan', { method: 'POST' });
        const data = await res.json();
        const durationMs = Math.round(performance.now() - reqStart);
        console.log('[Dashboard:API] POST /api/scan completed in ' + durationMs + 'ms:', data);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Scan failed');
        }
        showToast('✔ Scan complete in ' + durationMs + 'ms! Updating page...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 600);
      } catch (err) {
        const durationMs = Math.round(performance.now() - reqStart);
        console.error('[Dashboard:API] Scan error after ' + durationMs + 'ms:', err);
        showToast('❌ Scan failed: ' + err.message, 'error');
        btn.disabled = false;
        icon.classList.remove('spinning');
        text.textContent = 'Run Report Now';
      }
    }

    // Remove Repository via Server API
    async function handleRemoveRepo(fullName) {
      if (window.location.protocol === 'file:') {
        alert('To manage repositories dynamically, please run the project server using: npm start');
        return;
      }
      if (!confirm('Are you sure you want to stop tracking "' + fullName + '"?')) {
        return;
      }

      const [owner, repo] = fullName.split('/');
      showToast('Removing ' + fullName + '...', 'info');
      const reqStart = performance.now();
      try {
        const res = await fetch('/api/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), {
          method: 'DELETE'
        });
        const data = await res.json();
        const durationMs = Math.round(performance.now() - reqStart);
        console.log('[Dashboard:API] DELETE /api/repos completed in ' + durationMs + 'ms:', data);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to remove repository');
        }
        showToast('✔ Removed ' + fullName + ' in ' + durationMs + 'ms! Refreshing...', 'success');
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        const durationMs = Math.round(performance.now() - reqStart);
        console.error('[Dashboard:API] Remove repo error after ' + durationMs + 'ms:', err);
        showToast('❌ Failed: ' + err.message, 'error');
      }
    }

    // Add Repository via Server API
    async function handleAddRepo() {
      if (window.location.protocol === 'file:') {
        console.warn('[Dashboard:Repo] Add repo failed: page opened via file:// protocol.');
        alert('To add repositories dynamically, please run the project server using: npm start');
        return;
      }

      const input = document.getElementById('newRepoInput');
      const addBtn = document.getElementById('addRepoBtn');
      const repoStr = input.value.trim();
      if (!repoStr) {
        showToast('Please enter a repository (e.g. facebook/react or github.com/facebook/react)', 'error');
        input.focus();
        return;
      }

      console.log('[Dashboard:Action] Adding repository via POST /api/repos:', repoStr);
      input.disabled = true;
      if (addBtn) addBtn.disabled = true;
      showToast('Verifying ' + repoStr + ' on GitHub...', 'info');

      const reqStart = performance.now();
      try {
        const res = await fetch('/api/repos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoStr })
        });
        const data = await res.json();
        const durationMs = Math.round(performance.now() - reqStart);
        console.log('[Dashboard:API] POST /api/repos completed in ' + durationMs + 'ms:', data);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to add repository');
        }
        showToast('✔ Repository verified & added in ' + durationMs + 'ms! Refreshing...', 'success');
        input.value = '';
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        const durationMs = Math.round(performance.now() - reqStart);
        console.error('[Dashboard:API] Add repo error after ' + durationMs + 'ms:', err);
        showToast('❌ ' + err.message, 'error');
      } finally {
        input.disabled = false;
        if (addBtn) addBtn.disabled = false;
      }
    }

    // Allow Enter key on newRepoInput
    document.getElementById('newRepoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddRepo();
    });

    // Live Auto-Reload Stream Client
    (function initLiveReload() {
      if (window.location.protocol === 'file:') return;

      let isReconnecting = false;
      let reconnectInterval = null;

      function connect() {
        const es = new EventSource('/api/live-reload');

        es.addEventListener('connected', () => {
          if (isReconnecting) {
            console.log('[DevServer:LiveReload] Reconnected to server. Reloading page...');
            window.location.reload();
          } else {
            console.log('[DevServer:LiveReload] Live auto-reload stream connected.');
          }
        });

        es.addEventListener('reload', (e) => {
          console.log('[DevServer:LiveReload] Reload event received:', e.data);
          window.location.reload();
        });

        es.onerror = () => {
          es.close();
          isReconnecting = true;
          if (!reconnectInterval) {
            reconnectInterval = setInterval(async () => {
              try {
                const res = await fetch('/api/data', { method: 'GET', cache: 'no-store' });
                if (res.ok) {
                  clearInterval(reconnectInterval);
                  reconnectInterval = null;
                  console.log('[DevServer:LiveReload] Dev server back online. Reloading page...');
                  window.location.reload();
                }
              } catch {
                // Server still restarting...
              }
            }, 250);
          }
        };
      }

      connect();
    })();