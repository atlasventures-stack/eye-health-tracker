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
            state.screenTime.totalToday = data.total_seconds;
            updateScreenTimeDisplay();
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
            t2020: { enabled: true, remaining: 20 * 60, interval: null },
            water: { enabled: true, remaining: 30 * 60, interval: null },
            drops: { enabled: true, remaining: 2 * 60 * 60, interval: null },
            break: { enabled: true, remaining: 30 * 60, interval: null }
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
        // 20-20-20 Timer
        setupTimer('2020', 20 * 60, () => {
            showBreakModal('20-20-20 Break!', 'Look at something 20 feet away for 20 seconds.');
            sendNotification('20-20-20 Break', 'Look at something 20 feet away for 20 seconds');
            state.counters.breaks++;
            document.getElementById('breaksCount').textContent = state.counters.breaks;
            Storage.save();
        });

        // Water Timer
        setupTimer('Water', 30 * 60, () => {
            showToast('Time to drink water! Stay hydrated.');
            sendNotification('Water Reminder', 'Time to drink some water!');
        });

        // Eye Drops Timer
        setupTimer('Drops', 2 * 60 * 60, () => {
            showToast('Time for eye drops! Use Refresh Tears.');
            sendNotification('Eye Drops Reminder', 'Time to use Refresh Tears!');
        });

        // Screen Break Timer
        setupTimer('Break', 30 * 60, () => {
            showBreakModal('Screen Break Time!', 'You\'ve been on screen for 30 minutes. Take a 5-minute break.');
            sendNotification('Screen Break', 'Take a 5-minute break from your screen');
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
    function initHistory() {
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
            const dayData = state.history[dateStr];
            const completion = dayData ? dayData.completionRate || 0 : 0;
            const isToday = dateStr === Storage.getToday();
            const isComplete = completion >= 80;

            return `
                <div class="day-cell ${isToday ? 'today' : ''} ${isComplete ? 'complete' : ''}">
                    <span class="day-name">${days[date.getDay()]}</span>
                    <span class="day-number">${date.getDate()}</span>
                    <span class="day-progress">${completion}%</span>
                </div>
            `;
        }).join('');
    }

    function updateStats() {
        const historyDates = Object.keys(state.history).sort().slice(-30); // Last 30 days

        // Average completion
        let totalCompletion = 0;
        historyDates.forEach(date => {
            totalCompletion += state.history[date].completionRate || 0;
        });
        const avgCompletion = historyDates.length > 0
            ? Math.round(totalCompletion / historyDates.length)
            : 0;
        document.getElementById('avgCompletion').textContent = avgCompletion + '%';

        // Streak
        let streak = 0;
        const today = new Date();
        for (let i = 0; i < 365; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const dayData = state.history[dateStr];

            if (dayData && dayData.completionRate >= 50) {
                streak++;
            } else if (i > 0) { // Don't break on today if it's incomplete
                break;
            }
        }
        document.getElementById('streakDays').textContent = streak;

        // Average screen time
        let totalScreenTime = 0;
        let daysWithScreenTime = 0;
        historyDates.forEach(date => {
            const st = state.history[date].screenTime;
            if (st && st.totalToday > 0) {
                totalScreenTime += st.totalToday;
                daysWithScreenTime++;
            }
        });
        const avgScreenTimeHours = daysWithScreenTime > 0
            ? Math.round(totalScreenTime / daysWithScreenTime / 3600)
            : 0;
        document.getElementById('avgScreenTime').textContent = avgScreenTimeHours + 'h';
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
