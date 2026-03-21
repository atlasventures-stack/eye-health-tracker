// Eye Health Tracker - Main Application
// Built for Avish

(function() {
    'use strict';

    // ==================== CONFIG ====================
    const LOCAL_API = 'http://localhost:8081';
    let useLocalTracker = false; // Will be set to true if local API is available
    let localTrackerPollInterval = null;

    // ==================== LOCAL TRACKER SYNC ====================
    async function checkLocalTracker() {
        try {
            const response = await fetch(LOCAL_API, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });
            if (response.ok) {
                const data = await response.json();
                if (data.source === 'auto-tracker') {
                    return data;
                }
            }
        } catch (e) {
            // Local tracker not available
        }
        return null;
    }

    async function syncFromLocalTracker() {
        const data = await checkLocalTracker();
        if (data) {
            // Sync screen time
            state.screenTime.totalToday = data.total_seconds;
            updateScreenTimeDisplay();

            // Sync counters from alert actions
            if (data.counts) {
                state.counters.breaks = data.counts.breaks || 0;
                document.getElementById('breaksCount').textContent = state.counters.breaks;
            }

            // Sync checklist items from scheduled alerts
            if (data.checklist) {
                // Morning checklist items
                if (data.checklist.morning) {
                    ['morning-water', 'morning-splash', 'morning-almonds', 'morning-neti'].forEach(id => {
                        state.checklist[id] = true;
                        const cb = document.querySelector(`input[data-id="${id}"]`);
                        if (cb) cb.checked = true;
                    });
                }
                // Evening checklist items
                if (data.checklist.evening) {
                    ['evening-nuts', 'evening-drops', 'evening-sunetra'].forEach(id => {
                        state.checklist[id] = true;
                        const cb = document.querySelector(`input[data-id="${id}"]`);
                        if (cb) cb.checked = true;
                    });
                }
                // Before bed checklist items
                if (data.checklist.bedtime) {
                    ['bed-milk', 'bed-triphala', 'bed-ghee', 'bed-almonds', 'bed-noscreen'].forEach(id => {
                        state.checklist[id] = true;
                        const cb = document.querySelector(`input[data-id="${id}"]`);
                        if (cb) cb.checked = true;
                    });
                }
                // Update progress bar
                updateProgress();
            }

            return true;
        }
        return false;
    }

    function startLocalTrackerSync() {
        // Initial sync
        syncFromLocalTracker();

        // Poll every 30 seconds
        localTrackerPollInterval = setInterval(async () => {
            const synced = await syncFromLocalTracker();
            if (!synced) {
                // Local tracker went offline
                useLocalTracker = false;
                clearInterval(localTrackerPollInterval);
                showManualScreenTimeUI();
                showToast('Local tracker disconnected. Using manual mode.');
            }
        }, 30000);
    }

    function showAutoScreenTimeUI() {
        const startBtn = document.getElementById('startSession');
        const stopBtn = document.getElementById('stopSession');
        const currentSessionEl = document.getElementById('currentSession');
        const sessionControls = document.querySelector('.session-controls');

        // Hide manual controls
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'none';
        if (currentSessionEl) currentSessionEl.style.display = 'none';

        // Show auto-sync indicator
        if (sessionControls) {
            sessionControls.innerHTML = `
                <div class="auto-sync-indicator">
                    <span class="sync-dot"></span>
                    <span>Auto-tracking from macOS</span>
                </div>
            `;
        }

        // Hide sessions list header text
        const sessionsListHeader = document.querySelector('.sessions-header');
        if (sessionsListHeader) {
            sessionsListHeader.innerHTML = '<h4>🔄 Synced with Menu Bar</h4>';
        }
    }

    function showManualScreenTimeUI() {
        const startBtn = document.getElementById('startSession');
        if (startBtn) startBtn.style.display = 'flex';
    }

    // ==================== STATE ====================
    const state = {
        checklist: {},
        counters: {
            breaks: 0,
            blinks: 0
        },
        limits: {},
        screenTime: {
            sessions: [],
            currentSession: null,
            totalToday: 0
        },
        timers: {
            t2020: { enabled: true, remaining: 60 * 60, interval: null },
            water: { enabled: true, remaining: 60 * 60, interval: null },
            drops: { enabled: true, remaining: 60 * 60, interval: null },
            break: { enabled: true, remaining: 60 * 60, interval: null }
        },
        history: {},
        notificationsEnabled: false
    };

    // ==================== STORAGE ====================
    const Storage = {
        KEY: 'eyeHealthTracker',

        getToday() {
            return new Date().toISOString().split('T')[0];
        },

        load() {
            try {
                const data = localStorage.getItem(this.KEY);
                if (data) {
                    const parsed = JSON.parse(data);
                    // Merge with defaults
                    Object.assign(state.history, parsed.history || {});

                    // Load today's data if exists
                    const today = this.getToday();
                    if (parsed.history && parsed.history[today]) {
                        const todayData = parsed.history[today];
                        state.checklist = todayData.checklist || {};
                        state.counters = todayData.counters || { breaks: 0, blinks: 0 };
                        state.limits = todayData.limits || {};
                        state.screenTime = todayData.screenTime || { sessions: [], totalToday: 0 };
                    }
                }
            } catch (e) {
                console.error('Error loading data:', e);
            }
        },

        save() {
            try {
                const today = this.getToday();
                state.history[today] = {
                    checklist: state.checklist,
                    counters: state.counters,
                    limits: state.limits,
                    screenTime: {
                        sessions: state.screenTime.sessions,
                        totalToday: state.screenTime.totalToday
                    },
                    completionRate: calculateCompletionRate()
                };
                localStorage.setItem(this.KEY, JSON.stringify({
                    history: state.history,
                    lastUpdated: new Date().toISOString()
                }));
            } catch (e) {
                console.error('Error saving data:', e);
            }
        },

        exportData() {
            return JSON.stringify({
                history: state.history,
                exportedAt: new Date().toISOString()
            }, null, 2);
        },

        reset() {
            if (confirm('Are you sure you want to reset ALL data? This cannot be undone.')) {
                localStorage.removeItem(this.KEY);
                location.reload();
            }
        }
    };

    // ==================== CHECKLIST ====================
    const CHECKLIST_ITEMS = [
        'morning-water', 'morning-splash', 'morning-almonds', 'morning-neti',
        'work-water1', 'work-water2', 'work-water3', 'work-water4',
        'work-drops-morning', 'work-drops-afternoon',
        'evening-nuts', 'evening-drops', 'evening-sunetra',
        'bed-milk', 'bed-triphala', 'bed-ghee', 'bed-almonds', 'bed-noscreen'
    ];

    function initChecklist() {
        CHECKLIST_ITEMS.forEach(id => {
            const checkbox = document.querySelector(`input[data-id="${id}"]`);
            if (checkbox) {
                checkbox.checked = state.checklist[id] || false;
                checkbox.addEventListener('change', () => {
                    state.checklist[id] = checkbox.checked;
                    updateProgress();
                    Storage.save();

                    // Play subtle sound
                    if (checkbox.checked) {
                        playSound('check');
                    }
                });
            }
        });
    }

    function calculateCompletionRate() {
        const total = CHECKLIST_ITEMS.length;
        const completed = CHECKLIST_ITEMS.filter(id => state.checklist[id]).length;
        return Math.round((completed / total) * 100);
    }

    function updateProgress() {
        const rate = calculateCompletionRate();
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');

        if (progressFill) progressFill.style.width = rate + '%';
        if (progressText) progressText.textContent = rate + '%';
    }

    // ==================== COUNTERS ====================
    function initCounters() {
        // Update display
        document.getElementById('breaksCount').textContent = state.counters.breaks;
        document.getElementById('blinksCount').textContent = state.counters.blinks;

        // Add event listeners
        document.querySelectorAll('.counter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const counter = btn.dataset.counter;
                const action = btn.dataset.action;

                if (action === 'increment') {
                    state.counters[counter]++;
                } else if (action === 'decrement' && state.counters[counter] > 0) {
                    state.counters[counter]--;
                }

                document.getElementById(counter + 'Count').textContent = state.counters[counter];
                Storage.save();
            });
        });
    }

    // ==================== LIMITS ====================
    function initLimits() {
        // Only screen time tracking now (Instagram and release removed)
    }

    // ==================== TIMERS ====================
    function formatTime(seconds) {
        if (seconds >= 3600) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function initTimers() {
        // ALERTS DISABLED - All alerts now come from macOS shell script only
        // Timers still run for visual countdown display, but no popups/notifications

        // 20-20-20 Timer (hourly) - display only, no alert
        setupTimer('2020', 60 * 60, () => {
            // Alert handled by macOS script - just update counter
            state.counters.breaks++;
            document.getElementById('breaksCount').textContent = state.counters.breaks;
            Storage.save();
        });

        // Water Timer (hourly) - display only, no alert
        setupTimer('Water', 60 * 60, () => {
            // Alert handled by macOS script
        });

        // Eye Drops Timer (hourly) - display only, no alert
        setupTimer('Drops', 60 * 60, () => {
            // Alert handled by macOS script
        });

        // Screen Break Timer (hourly) - display only, no alert
        setupTimer('Break', 60 * 60, () => {
            // Alert handled by macOS script
        });

        // Notification enable button
        document.getElementById('enableNotifications').addEventListener('click', requestNotificationPermission);
        updateNotificationStatus();
    }

    function setupTimer(name, duration, callback) {
        const timerKey = name.toLowerCase();
        const displayEl = document.getElementById(`timer${name}Display`);
        const toggleEl = document.getElementById(`timer${name}Toggle`);
        const resetEl = document.getElementById(`timer${name}Reset`);

        // Initialize remaining time
        if (!state.timers[timerKey]) {
            state.timers[timerKey] = { enabled: true, remaining: duration, interval: null };
        }

        // Update display
        displayEl.textContent = formatTime(state.timers[timerKey].remaining);

        // Toggle handler
        toggleEl.checked = state.timers[timerKey].enabled;
        toggleEl.addEventListener('change', () => {
            state.timers[timerKey].enabled = toggleEl.checked;
            if (toggleEl.checked) {
                startTimer(timerKey, duration, displayEl, callback);
            } else {
                stopTimer(timerKey);
            }
        });

        // Reset handler
        resetEl.addEventListener('click', () => {
            state.timers[timerKey].remaining = duration;
            displayEl.textContent = formatTime(duration);
            displayEl.classList.remove('warning', 'urgent');
            if (state.timers[timerKey].enabled) {
                stopTimer(timerKey);
                startTimer(timerKey, duration, displayEl, callback);
            }
        });

        // Start if enabled
        if (state.timers[timerKey].enabled) {
            startTimer(timerKey, duration, displayEl, callback);
        }
    }

    function startTimer(timerKey, duration, displayEl, callback) {
        stopTimer(timerKey); // Clear any existing interval

        state.timers[timerKey].interval = setInterval(() => {
            state.timers[timerKey].remaining--;

            if (state.timers[timerKey].remaining <= 0) {
                // Timer finished
                callback();
                state.timers[timerKey].remaining = duration; // Reset
                displayEl.classList.remove('warning', 'urgent');
            } else if (state.timers[timerKey].remaining <= 60) {
                displayEl.classList.add('urgent');
                displayEl.classList.remove('warning');
            } else if (state.timers[timerKey].remaining <= 180) {
                displayEl.classList.add('warning');
            }

            displayEl.textContent = formatTime(state.timers[timerKey].remaining);
        }, 1000);
    }

    function stopTimer(timerKey) {
        if (state.timers[timerKey] && state.timers[timerKey].interval) {
            clearInterval(state.timers[timerKey].interval);
            state.timers[timerKey].interval = null;
        }
    }

    // ==================== NOTIFICATIONS ====================
    async function requestNotificationPermission() {
        if (!('Notification' in window)) {
            alert('This browser does not support notifications');
            return;
        }

        const permission = await Notification.requestPermission();
        state.notificationsEnabled = permission === 'granted';
        updateNotificationStatus();

        if (permission === 'granted') {
            showToast('Notifications enabled!');
            // Register service worker for background notifications
            registerServiceWorker();
        }
    }

    function updateNotificationStatus() {
        const statusEl = document.getElementById('notificationStatus');
        const btnEl = document.getElementById('enableNotifications');

        if (!('Notification' in window)) {
            statusEl.textContent = 'Notifications not supported in this browser';
            btnEl.disabled = true;
            return;
        }

        if (Notification.permission === 'granted') {
            statusEl.textContent = 'Notifications are enabled';
            btnEl.textContent = 'Notifications Enabled';
            btnEl.disabled = true;
            state.notificationsEnabled = true;
        } else if (Notification.permission === 'denied') {
            statusEl.textContent = 'Notifications blocked. Please enable in browser settings.';
            btnEl.disabled = true;
        } else {
            statusEl.textContent = 'Click to enable browser notifications';
        }
    }

    function sendNotification(title, body) {
        if (state.notificationsEnabled && Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: 'icons/icon-192.png',
                badge: 'icons/icon-72.png',
                vibrate: [200, 100, 200],
                tag: 'eye-health-' + Date.now()
            });
        }
    }

    async function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker registered:', registration);
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    // ==================== SCREEN TIME ====================
    async function initScreenTime() {
        updateScreenTimeDisplay();

        // Check if local tracker is available (macOS auto-tracking)
        const localData = await checkLocalTracker();
        if (localData) {
            useLocalTracker = true;
            state.screenTime.totalToday = localData.total_seconds;
            updateScreenTimeDisplay();
            showAutoScreenTimeUI();
            startLocalTrackerSync();
            console.log('Connected to local screen time tracker');
            return; // Skip manual controls setup
        }

        // Fallback to manual tracking (for phone/other devices)
        const startBtn = document.getElementById('startSession');
        const stopBtn = document.getElementById('stopSession');
        const currentSessionEl = document.getElementById('currentSession');
        const sessionTimerEl = document.getElementById('sessionTimer');

        startBtn.addEventListener('click', () => {
            state.screenTime.currentSession = {
                start: Date.now(),
                interval: null
            };

            startBtn.style.display = 'none';
            stopBtn.style.display = 'flex';
            currentSessionEl.style.display = 'block';

            // Start session timer
            state.screenTime.currentSession.interval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - state.screenTime.currentSession.start) / 1000);
                sessionTimerEl.textContent = formatTime(elapsed);
            }, 1000);

            // Show active timers banner on checklist
            document.getElementById('activeTimers').style.display = 'flex';
        });

        stopBtn.addEventListener('click', () => {
            if (state.screenTime.currentSession) {
                const duration = Math.floor((Date.now() - state.screenTime.currentSession.start) / 1000);

                state.screenTime.sessions.push({
                    start: state.screenTime.currentSession.start,
                    end: Date.now(),
                    duration: duration
                });

                state.screenTime.totalToday += duration;

                clearInterval(state.screenTime.currentSession.interval);
                state.screenTime.currentSession = null;

                Storage.save();
                updateScreenTimeDisplay();
                updateSessionsList();
            }

            startBtn.style.display = 'flex';
            stopBtn.style.display = 'none';
            currentSessionEl.style.display = 'none';
            document.getElementById('activeTimers').style.display = 'none';
        });

        updateSessionsList();
    }

    function updateScreenTimeDisplay() {
        const totalSeconds = state.screenTime.totalToday;
        const totalHours = totalSeconds / 3600;
        const maxHours = 6;
        const percentage = Math.min((totalHours / maxHours) * 100, 100);

        // Update circle
        const circle = document.getElementById('screenTimeCircle');
        const circumference = 283; // 2 * PI * 45
        const offset = circumference - (percentage / 100) * circumference;
        circle.style.strokeDashoffset = offset;

        // Change color based on usage
        if (percentage >= 100) {
            circle.style.stroke = 'var(--danger)';
        } else if (percentage >= 75) {
            circle.style.stroke = 'var(--warning)';
        } else {
            circle.style.stroke = 'var(--accent)';
        }

        // Update text
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        document.getElementById('totalScreenTime').textContent =
            hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}` : `0:${minutes.toString().padStart(2, '0')}`;

        // Update limit status on checklist
        const limitStatus = document.querySelector('#screenTimeStatus .limit-value');
        if (limitStatus) {
            limitStatus.textContent = `${hours}h ${minutes}m`;
        }
    }

    function updateSessionsList() {
        const container = document.getElementById('sessionsList');

        if (state.screenTime.sessions.length === 0) {
            container.innerHTML = '<p class="no-sessions">No sessions recorded yet</p>';
            return;
        }

        container.innerHTML = state.screenTime.sessions.map(session => {
            const startTime = new Date(session.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTime = new Date(session.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const duration = formatTime(session.duration);

            return `
                <div class="session-item">
                    <span class="session-time">${startTime} - ${endTime}</span>
                    <span class="session-duration">${duration}</span>
                </div>
            `;
        }).reverse().join('');
    }

    // ==================== HISTORY ====================
    let screenTimeHistory = []; // Store fetched history

    async function fetchScreenTimeHistory() {
        try {
            const response = await fetch(LOCAL_API + '/history?days=14', {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });
            if (response.ok) {
                const data = await response.json();
                screenTimeHistory = data.history || [];
                return true;
            }
        } catch (e) {
            console.log('Could not fetch history from local API');
        }
        return false;
    }

    async function initHistory() {
        // Fetch history from local API
        await fetchScreenTimeHistory();
        renderDailyChart();
        renderAppBreakdown();
        updateWeekGrid();
        updateStats();

        document.getElementById('exportData').addEventListener('click', () => {
            const data = Storage.exportData();
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eye-health-data-${Storage.getToday()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Data exported!');
        });

        document.getElementById('resetData').addEventListener('click', Storage.reset);
    }

    // Render daily screen time bar chart
    function renderDailyChart() {
        const container = document.getElementById('dailyChart');
        if (!container) return;

        const last7Days = screenTimeHistory.slice(0, 7).reverse();

        if (last7Days.length === 0) {
            container.innerHTML = '<div class="no-data-message">No screen time data available</div>';
            return;
        }

        const maxHours = 12; // Scale bar to 12 hours max
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const todayStr = Storage.getToday();

        container.innerHTML = last7Days.map(entry => {
            const date = new Date(entry.date);
            const dayName = days[date.getDay()];
            const dayNum = date.getDate();
            const hours = entry.total_seconds / 3600;
            const widthPercent = Math.min((hours / maxHours) * 100, 100);

            // Color based on hours
            let colorClass = 'green';
            if (hours >= 8) colorClass = 'red';
            else if (hours >= 6) colorClass = 'yellow';

            const isToday = entry.date === todayStr;
            const hoursDisplay = Math.floor(hours);
            const minsDisplay = Math.floor((hours % 1) * 60);

            return `
                <div class="daily-bar-row ${isToday ? 'today' : ''}">
                    <div class="daily-bar-label">${dayName} ${dayNum}</div>
                    <div class="daily-bar-container">
                        <div class="daily-bar ${colorClass}" style="width: ${widthPercent}%"></div>
                    </div>
                    <div class="daily-bar-value">${hoursDisplay}h ${minsDisplay}m</div>
                </div>
            `;
        }).join('');
    }

    // Render app usage breakdown
    function renderAppBreakdown() {
        const container = document.getElementById('appBreakdown');
        if (!container) return;

        // Aggregate app usage from last 7 days
        const appTotals = {};
        const last7Days = screenTimeHistory.slice(0, 7);

        last7Days.forEach(day => {
            const topApps = day.top_apps || [];
            topApps.forEach(app => {
                if (!appTotals[app.name]) {
                    appTotals[app.name] = 0;
                }
                appTotals[app.name] += app.seconds;
            });
        });

        // Sort by total time
        const sortedApps = Object.entries(appTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5); // Top 5 apps

        if (sortedApps.length === 0) {
            container.innerHTML = '<div class="no-data-message">App breakdown will appear after tracking</div>';
            return;
        }

        const totalSeconds = sortedApps.reduce((sum, [_, secs]) => sum + secs, 0);

        // App icons mapping
        const appIcons = {
            'Google Chrome': '🌐',
            'Chrome': '🌐',
            'Safari': '🧭',
            'WhatsApp': '💬',
            'Slack': '💼',
            'stable': '💻',
            'Terminal': '💻',
            'Code': '📝',
            'VS Code': '📝',
            'Notion': '📓',
            'Finder': '📁',
            'Mail': '📧',
            'Zoom': '📹',
            'default': '📱'
        };

        container.innerHTML = sortedApps.map(([appName, seconds]) => {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const percent = Math.round((seconds / totalSeconds) * 100);
            const icon = appIcons[appName] || appIcons['default'];

            // Rename 'stable' to 'Claude Code'
            const displayName = appName === 'stable' ? 'Claude Code' : appName;

            return `
                <div class="app-row">
                    <div class="app-icon">${icon}</div>
                    <div class="app-name">${displayName}</div>
                    <div class="app-bar-container">
                        <div class="app-bar" style="width: ${percent}%"></div>
                    </div>
                    <div class="app-stats">
                        <strong>${hours}h ${mins}m</strong>
                        ${percent}%
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateWeekGrid() {
        const grid = document.getElementById('weekGrid');
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();

        // Get last 7 days
        const weekDays = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            weekDays.push(date);
        }

        grid.innerHTML = weekDays.map(date => {
            const dateStr = date.toISOString().split('T')[0];

            // Get screen time from API history
            const historyEntry = screenTimeHistory.find(h => h.date === dateStr);
            const screenTimeHours = historyEntry ? historyEntry.hours : 0;

            const isToday = dateStr === Storage.getToday();

            return `
                <div class="day-cell ${isToday ? 'today' : ''}" style="cursor: pointer;" onclick="showDayDetails('${dateStr}')">
                    <span class="day-name">${days[date.getDay()]}</span>
                    <span class="day-number">${date.getDate()}</span>
                    <span class="day-progress">${screenTimeHours}h</span>
                </div>
            `;
        }).join('');
    }

    // Show details for a specific day
    window.showDayDetails = function(dateStr) {
        const historyEntry = screenTimeHistory.find(h => h.date === dateStr);
        if (historyEntry) {
            const hours = Math.floor(historyEntry.total_seconds / 3600);
            const minutes = Math.floor((historyEntry.total_seconds % 3600) / 60);
            showToast(`${dateStr}: ${hours}h ${minutes}m screen time`);
        } else {
            showToast(`${dateStr}: No data recorded`);
        }
    };

    function updateStats() {
        // Use API history data for stats
        const last7Days = screenTimeHistory.slice(0, 7);
        const historyData = screenTimeHistory.slice(0, 30); // Last 30 days

        // Weekly total
        let weeklyTotal = 0;
        last7Days.forEach(entry => {
            weeklyTotal += entry.total_seconds || 0;
        });
        const weeklyHours = Math.round(weeklyTotal / 3600);
        const weeklyTotalEl = document.getElementById('weeklyTotal');
        if (weeklyTotalEl) weeklyTotalEl.textContent = weeklyHours + 'h';

        // Average screen time from API history
        let totalScreenTime = 0;
        let daysWithScreenTime = 0;
        historyData.forEach(entry => {
            if (entry.total_seconds > 0) {
                totalScreenTime += entry.total_seconds;
                daysWithScreenTime++;
            }
        });
        const avgScreenTimeHours = daysWithScreenTime > 0
            ? (totalScreenTime / daysWithScreenTime / 3600).toFixed(1)
            : 0;
        document.getElementById('avgScreenTime').textContent = avgScreenTimeHours + 'h';

        // Streak - count consecutive days with screen time data
        let streak = 0;
        const today = new Date();
        for (let i = 0; i < 365; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const historyEntry = screenTimeHistory.find(h => h.date === dateStr);

            if (historyEntry && historyEntry.total_seconds > 0) {
                streak++;
            } else if (i > 0) {
                break;
            }
        }
        document.getElementById('streakDays').textContent = streak;
    }

    // ==================== UI HELPERS ====================
    function initTabs() {
        const tabs = document.querySelectorAll('.tab');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;

                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                tab.classList.add('active');
                document.getElementById(target).classList.add('active');
            });
        });
    }

    function updateDate() {
        const dateEl = document.getElementById('currentDate');
        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        dateEl.textContent = new Date().toLocaleDateString('en-US', options);
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        const messageEl = document.getElementById('toastMessage');

        messageEl.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);

        document.getElementById('toastClose').onclick = () => {
            toast.classList.remove('show');
        };
    }

    function showBreakModal(title, message) {
        const modal = document.getElementById('breakModal');
        const messageEl = document.getElementById('breakMessage');
        const timerEl = document.getElementById('breakTimer');

        document.querySelector('#breakModal h2').textContent = title;
        messageEl.textContent = message;
        modal.classList.add('show');

        // Countdown
        let countdown = 20;
        timerEl.textContent = countdown;

        const countdownInterval = setInterval(() => {
            countdown--;
            timerEl.textContent = countdown;

            if (countdown <= 0) {
                clearInterval(countdownInterval);
                modal.classList.remove('show');
            }
        }, 1000);

        document.getElementById('dismissBreak').onclick = () => {
            clearInterval(countdownInterval);
            modal.classList.remove('show');
        };

        // Play sound
        playSound('break');
    }

    function playSound(type) {
        // Simple beep using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            if (type === 'check') {
                oscillator.frequency.value = 800;
                gainNode.gain.value = 0.1;
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.1);
            } else if (type === 'break') {
                oscillator.frequency.value = 440;
                gainNode.gain.value = 0.2;
                oscillator.start();

                // Two-tone beep
                setTimeout(() => {
                    oscillator.frequency.value = 550;
                }, 200);

                oscillator.stop(audioContext.currentTime + 0.4);
            }
        } catch (e) {
            // Audio not supported, fail silently
        }
    }

    // ==================== INITIALIZATION ====================
    function init() {
        Storage.load();
        updateDate();
        initTabs();
        initChecklist();
        initCounters();
        initLimits();
        initTimers();
        initScreenTime();
        initHistory();
        updateProgress();

        // Save periodically
        setInterval(() => Storage.save(), 60000);

        // Register service worker
        if ('serviceWorker' in navigator && Notification.permission === 'granted') {
            registerServiceWorker();
        }

        // Check for day change
        setInterval(() => {
            const currentDate = document.getElementById('currentDate').textContent;
            const options = { weekday: 'short', month: 'short', day: 'numeric' };
            const newDate = new Date().toLocaleDateString('en-US', options);

            if (currentDate !== newDate) {
                Storage.save();
                location.reload(); // Reset for new day
            }
        }, 60000);

        console.log('Eye Health Tracker initialized');
    }

    // Start the app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
