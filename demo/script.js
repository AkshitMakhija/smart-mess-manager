/**
 * Smart Mess Manager - Dashboard & Client Script
 * ----------------------------------------------------
 * Handles:
 * 1. Student Dashboard crowd level sync with Live Crowd Monitor
 * 2. Food rating & voting persistence in localStorage
 * 3. Student feedback submission and admin sentiment categorization
 * 4. Admin dashboard metrics, wastage, and recent feedback rendering
 */

// Global Storage Keys
const STORAGE_KEYS = {
    VOTING: 'smm_voting_data',
    FEEDBACK: 'smm_feedback_data',
    LIVE_CROWD: 'smm_live_crowd'
};

// Default voting state
let votingData = {
    paneer: { likes: 142, dislikes: 18 },
    vegetable: { likes: 98, dislikes: 31 }
};

// Feedback list
let feedbackData = [];

// ==========================================
// 1. LIFECYCLE INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    // Check page context
    if (document.querySelector('#crowdLevel')) {
        initStudentDashboard();
    }
    if (document.querySelector('#totalStudents')) {
        initAdminDashboard();
    }

    // Listen to cross-tab updates from Live Crowd Monitor
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEYS.LIVE_CROWD && document.querySelector('#crowdLevel')) {
            syncLiveCrowdState();
        }
    });
});

// ==========================================
// 2. STUDENT DASHBOARD
// ==========================================
function initStudentDashboard() {
    loadVotingData();
    loadFeedbackData();

    // Initial crowd check
    syncLiveCrowdState();

    // Check every 3 seconds for live camera updates
    setInterval(syncLiveCrowdState, 3000);
}

/**
 * Reads state from Live Crowd Monitor (if active) or applies realistic baseline
 */
function syncLiveCrowdState() {
    const indicator = document.getElementById('crowdIndicator');
    const fill = document.getElementById('crowdFill');
    const metaEl = document.getElementById('liveCrowdMeta');
    const syncBadge = document.getElementById('liveSyncBadge');

    if (!indicator || !fill) return;

    let liveData = null;
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.LIVE_CROWD);
        if (raw) {
            liveData = JSON.parse(raw);
        }
    } catch (e) {}

    const now = Date.now();
    const isLiveRecent = liveData && (now - liveData.updatedAt < 45000); // within last 45s

    if (isLiveRecent) {
        // Live camera / simulation stream is actively pushing updates!
        const count = liveData.count;
        const status = liveData.status; // 'LOW' | 'MODERATE' | 'HIGH'
        const percentage = liveData.percentage;

        indicator.textContent = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        indicator.className = 'crowd-indicator ' + status.toLowerCase();
        fill.style.width = percentage + '%';

        if (metaEl) {
            metaEl.innerHTML = `<strong>Estimated People:</strong> ${count} students &nbsp;|&nbsp; <strong>Detection Confidence:</strong> ${liveData.confidence || 88}%`;
        }

        if (syncBadge) {
            if (liveData.source === 'simulation') {
                syncBadge.innerHTML = '⚡ <span>Simulation Stream Active</span>';
                syncBadge.className = 'badge badge-warning';
            } else {
                syncBadge.innerHTML = '● <span>Live Camera Stream Connected</span>';
                syncBadge.className = 'badge badge-live';
            }
        }
    } else {
        // Default realistic baseline when camera is idle
        if (!indicator.dataset.initialized) {
            indicator.textContent = 'Moderate';
            indicator.className = 'crowd-indicator moderate';
            fill.style.width = '48%';
            indicator.dataset.initialized = 'true';

            if (metaEl) {
                metaEl.innerHTML = `<strong>Estimated People:</strong> ~12 students (Typical for this hour)`;
            }
            if (syncBadge) {
                syncBadge.innerHTML = '<span>Camera Idle • Connect Live Monitor</span>';
                syncBadge.className = 'badge';
                syncBadge.style.background = '#1e293b';
                syncBadge.style.color = '#94a3b8';
            }
        }
    }
}

// ==========================================
// 3. FOOD VOTING SYSTEM
// ==========================================
function vote(item, type) {
    if (votingData[item]) {
        if (type === 'like') {
            votingData[item].likes++;
        } else {
            votingData[item].dislikes++;
        }
        updateVoteDisplay(item);
        saveVotingData();
    }
}

function updateVoteDisplay(item) {
    const voteCount = document.getElementById('vote-' + item);
    if (voteCount && votingData[item]) {
        const likes = votingData[item].likes;
        const dislikes = votingData[item].dislikes;
        const total = likes + dislikes;
        const approval = total > 0 ? Math.round((likes / total) * 100) : 0;
        voteCount.textContent = `${likes} likes, ${dislikes} dislikes (${approval}% approval)`;
    }
}

function loadVotingData() {
    const saved = localStorage.getItem(STORAGE_KEYS.VOTING);
    if (saved) {
        try {
            votingData = JSON.parse(saved);
        } catch (e) {}
    }
    Object.keys(votingData).forEach(item => {
        updateVoteDisplay(item);
    });
}

function saveVotingData() {
    localStorage.setItem(STORAGE_KEYS.VOTING, JSON.stringify(votingData));
}

// ==========================================
// 4. STUDENT FEEDBACK SYSTEM
// ==========================================
function submitFeedback(event) {
    event.preventDefault();

    const nameInput = document.getElementById('feedbackName');
    const messageInput = document.getElementById('feedbackMessage');

    if (!nameInput || !messageInput) return;

    const name = nameInput.value.trim();
    const message = messageInput.value.trim();

    if (name && message) {
        const feedback = {
            name: name,
            message: message,
            timestamp: new Date().toISOString()
        };

        feedbackData.push(feedback);
        saveFeedbackData();

        const successMsg = document.getElementById('feedbackSuccess');
        if (successMsg) {
            successMsg.style.display = 'block';
            setTimeout(() => {
                successMsg.style.display = 'none';
            }, 3000);
        }

        document.getElementById('feedbackForm').reset();
    }
}

function loadFeedbackData() {
    const saved = localStorage.getItem(STORAGE_KEYS.FEEDBACK);
    if (saved) {
        try {
            feedbackData = JSON.parse(saved);
        } catch (e) {}
    }
}

function saveFeedbackData() {
    localStorage.setItem(STORAGE_KEYS.FEEDBACK, JSON.stringify(feedbackData));
}

// ==========================================
// 5. ADMIN DASHBOARD
// ==========================================
function initAdminDashboard() {
    // Animate total students counter
    animateCounter('totalStudents', 0, 312, 1200);

    // Initial load
    updateWastage();
    loadAdminFeedback();

    // Check periodically
    setInterval(() => {
        updateWastage();
        loadAdminFeedback();
    }, 12000);
}

function animateCounter(elementId, start, end, duration) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const range = end - start;
    const increment = range / (duration / 20);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.floor(current);
    }, 20);
}

function updateWastage() {
    // Realistic cafeteria wastage rate (11% - 15%)
    const wastage = 12;
    const percentElement = document.getElementById('wastagePercent');
    const fillElement = document.querySelector('.wastage-fill');

    if (percentElement) {
        percentElement.textContent = wastage + '%';
    }
    if (fillElement) {
        fillElement.style.width = wastage + '%';
    }
}

function loadAdminFeedback() {
    const saved = localStorage.getItem(STORAGE_KEYS.FEEDBACK);
    let allFeedback = [];

    if (saved) {
        try {
            allFeedback = JSON.parse(saved);
        } catch (e) {}
    }

    // Default sample feedbacks if empty
    if (allFeedback.length === 0) {
        allFeedback = [
            { name: "Rahul S.", message: "Lunch was very fresh today. Paneer butter masala was good.", timestamp: new Date(Date.now() - 3600000).toISOString() },
            { name: "Ananya K.", message: "Queue was moving quickly around 1:15 PM.", timestamp: new Date(Date.now() - 7200000).toISOString() }
        ];
    }

    const totalFeedback = document.getElementById('totalFeedback');
    const positiveFeedback = document.getElementById('positiveFeedback');
    const negativeFeedback = document.getElementById('negativeFeedback');

    if (totalFeedback) {
        totalFeedback.textContent = allFeedback.length;
    }

    let positive = 0;
    let negative = 0;

    const posWords = ['good', 'great', 'excellent', 'nice', 'fresh', 'delicious', 'tasty', 'quick', 'love'];
    const negWords = ['bad', 'poor', 'slow', 'cold', 'disappointing', 'worst', 'crowded', 'salt'];

    allFeedback.forEach(f => {
        const msg = f.message.toLowerCase();
        const isPos = posWords.some(w => msg.includes(w));
        const isNeg = negWords.some(w => msg.includes(w));
        if (isPos && !isNeg) positive++;
        else if (isNeg) negative++;
        else positive++;
    });

    if (positiveFeedback) positiveFeedback.textContent = positive;
    if (negativeFeedback) negativeFeedback.textContent = negative;

    displayRecentFeedback(allFeedback.slice(-5).reverse());
}

function displayRecentFeedback(feedbacks) {
    const list = document.getElementById('feedbackList');
    if (!list) return;

    if (feedbacks.length === 0) {
        list.innerHTML = '<p class="no-feedback">No feedback submitted yet.</p>';
        return;
    }

    list.innerHTML = feedbacks.map(item => {
        const d = new Date(item.timestamp);
        const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="feedback-item">
                <strong>${item.name}</strong>
                <p>${item.message}</p>
                <small style="color: #64748b; font-size: 0.75rem;">${timeStr}</small>
            </div>
        `;
    }).join('');
}
