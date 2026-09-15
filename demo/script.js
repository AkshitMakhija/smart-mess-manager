/**
 * Smart Mess Manager - Dashboard & Client Script
 * ----------------------------------------------------
 * Features:
 * 1. Live Seat Availability & Capacity Tracker (synced with Live Camera)
 * 2. Interactive Meal Tabs with Nutrition & Allergen Tags
 * 3. Real-time Campus Clock & Meal Service Countdown Ticker
 * 4. Food Quality Voting (likes/dislikes) stored in localStorage
 * 5. Student Feedback Form with Sentiment Classification
 * 6. Admin Analytics & Wastage Audit
 */

const STORAGE_KEYS = {
    VOTING: 'smm_voting_data',
    FEEDBACK: 'smm_feedback_data',
    LIVE_CROWD: 'smm_live_crowd'
};

const TOTAL_MESS_SEATS = 250;

// Default initial voting data
let votingData = {
    paneer: { likes: 142, dislikes: 18 },
    vegetable: { likes: 98, dislikes: 31 }
};

let feedbackData = [];

// ==========================================
// 1. LIFECYCLE INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('#crowdLevel')) {
        initStudentDashboard();
    }
    if (document.querySelector('#totalStudents')) {
        initAdminDashboard();
    }

    // Cross-tab storage listener
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEYS.LIVE_CROWD && document.querySelector('#crowdLevel')) {
            syncLiveCrowdState();
        }
    });
});

// ==========================================
// 2. STUDENT DASHBOARD INITIALIZATION
// ==========================================
function initStudentDashboard() {
    loadVotingData();
    loadFeedbackData();
    syncLiveCrowdState();

    // Start Live Clock & Service Countdown Ticker
    startCampusClockTicker();

    // Poll live crowd state every 2 seconds
    setInterval(syncLiveCrowdState, 2000);
}

// ==========================================
// 3. FEATURE 4: CAMPUS CLOCK & SERVICE COUNTDOWN
// ==========================================
function startCampusClockTicker() {
    updateCampusClock();
    setInterval(updateCampusClock, 1000);
}

function updateCampusClock() {
    const clockEl = document.getElementById('campusLiveClock');
    const statusTitleEl = document.getElementById('serviceStatusTitle');
    const statusSubEl = document.getElementById('serviceTimingSub');
    const countdownEl = document.getElementById('mealCountdownTimer');

    if (!clockEl) return;

    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[now.getDay()];

    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockEl.textContent = `${dayName}, ${timeStr}`;

    // Determine Meal Service Slot
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentMins = hours * 60 + minutes;

    // Service Definitions (in minutes from midnight)
    // Breakfast: 7:30 (450) - 9:30 (570)
    // Lunch:    12:00 (720) - 14:30 (870)
    // Snacks:   17:00 (1020) - 18:00 (1080)
    // Dinner:   19:30 (1170) - 21:30 (1290)

    let activeService = null;
    let closesInMins = 0;
    let nextServiceText = '';

    if (currentMins >= 450 && currentMins < 570) {
        activeService = { name: 'Breakfast Service Active', sub: '7:30 AM – 9:30 AM • Fresh Morning Spread', endMins: 570 };
    } else if (currentMins >= 720 && currentMins < 870) {
        activeService = { name: 'Lunch Service Active', sub: '12:00 PM – 2:30 PM • Main Hall Counters Open', endMins: 870 };
    } else if (currentMins >= 1020 && currentMins < 1080) {
        activeService = { name: 'Evening Snacks Active', sub: '5:00 PM – 6:00 PM • Tea & Refreshments', endMins: 1080 };
    } else if (currentMins >= 1170 && currentMins < 1290) {
        activeService = { name: 'Dinner Service Active', sub: '7:30 PM – 9:30 PM • Hot Dinner Counters', endMins: 1290 };
    } else {
        // Between meals
        if (currentMins < 450) {
            nextServiceText = 'Breakfast opens at 7:30 AM';
        } else if (currentMins < 720) {
            nextServiceText = 'Lunch counters open at 12:00 PM';
        } else if (currentMins < 1020) {
            nextServiceText = 'Evening snacks served at 5:00 PM';
        } else if (currentMins < 1170) {
            nextServiceText = 'Dinner counters open at 7:30 PM';
        } else {
            nextServiceText = 'Kitchen closed for the night • Breakfast at 7:30 AM';
        }
    }

    if (activeService) {
        closesInMins = activeService.endMins - currentMins;
        const secondsLeft = 59 - now.getSeconds();
        if (statusTitleEl) statusTitleEl.textContent = activeService.name;
        if (statusSubEl) statusSubEl.textContent = activeService.sub;
        if (countdownEl) {
            countdownEl.textContent = `⏱️ Closes in ${closesInMins}m ${secondsLeft.toString().padStart(2, '0')}s`;
            countdownEl.style.color = '#fbbf24';
        }
    } else {
        if (statusTitleEl) statusTitleEl.textContent = 'Mess Hall Idle (Prep in Progress)';
        if (statusSubEl) statusSubEl.textContent = nextServiceText;
        if (countdownEl) {
            countdownEl.textContent = `⏳ ${nextServiceText}`;
            countdownEl.style.color = '#94a3b8';
        }
    }
}

// ==========================================
// 4. FEATURE 1: LIVE SEAT & ZONE CAPACITY CALCULATION
// ==========================================
function syncLiveCrowdState() {
    const indicator = document.getElementById('crowdIndicator');
    const fill = document.getElementById('crowdFill');
    const metaEl = document.getElementById('liveCrowdMeta');
    const syncBadge = document.getElementById('liveSyncBadge');

    const availableSeatsEl = document.getElementById('availableSeatsCount');
    const occupiedSeatsEl = document.getElementById('occupiedSeatsCount');
    const capacityPercentEl = document.getElementById('capacityPercentText');
    const capacityMeterFill = document.getElementById('capacityMeterFill');

    const zoneATag = document.getElementById('zoneATag');
    const zoneBTag = document.getElementById('zoneBTag');

    let liveData = null;
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.LIVE_CROWD);
        if (raw) {
            liveData = JSON.parse(raw);
        }
    } catch (e) {}

    const now = Date.now();
    const isLiveRecent = liveData && (now - liveData.updatedAt < 45000);

    let count = 14;
    let status = 'MODERATE';
    let percentage = 45;
    let isLiveSource = false;

    if (isLiveRecent) {
        count = liveData.count;
        status = liveData.status;
        percentage = liveData.percentage;
        isLiveSource = true;

        if (syncBadge) {
            if (liveData.source === 'simulation') {
                syncBadge.innerHTML = '⚡ <span>Simulation Stream Active</span>';
                syncBadge.className = 'badge badge-warning';
            } else {
                syncBadge.innerHTML = '● <span>Live Camera Stream Connected</span>';
                syncBadge.className = 'badge badge-live';
            }
        }
        if (metaEl) {
            metaEl.innerHTML = `<strong>Estimated People:</strong> ${count} students &nbsp;|&nbsp; <strong>Detection Confidence:</strong> ${liveData.confidence || 88}%`;
        }
    } else {
        count = 14;
        status = 'MODERATE';
        percentage = 48;
        if (syncBadge) {
            syncBadge.innerHTML = '<span>Camera Idle • Connect Live Monitor</span>';
            syncBadge.className = 'badge';
            syncBadge.style.background = '#1e293b';
            syncBadge.style.color = '#94a3b8';
        }
        if (metaEl) {
            metaEl.innerHTML = `<strong>Estimated People:</strong> ~${count} students (Typical for this hour)`;
        }
    }

    // 1. Update Crowd Indicator Card
    if (indicator) {
        indicator.textContent = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        indicator.className = 'crowd-indicator ' + status.toLowerCase();
    }
    if (fill) {
        fill.style.width = percentage + '%';
    }

    // 2. Update Feature 1: Seat Availability Metrics
    const freeSeats = Math.max(0, TOTAL_MESS_SEATS - count);
    const capacityPct = Math.min(100, Math.round((count / TOTAL_MESS_SEATS) * 100));

    if (availableSeatsEl) availableSeatsEl.textContent = freeSeats;
    if (occupiedSeatsEl) occupiedSeatsEl.textContent = count;
    if (capacityPercentEl) capacityPercentEl.textContent = `${capacityPct}% Full (${count}/${TOTAL_MESS_SEATS} Seats)`;

    if (capacityMeterFill) {
        capacityMeterFill.style.width = `${Math.max(5, capacityPct)}%`;
        if (capacityPct < 30) {
            capacityMeterFill.className = 'capacity-meter-fill low';
        } else if (capacityPct < 70) {
            capacityMeterFill.className = 'capacity-meter-fill moderate';
        } else {
            capacityMeterFill.className = 'capacity-meter-fill high';
        }
    }

    // 3. Update Zone Density Breakdown
    if (zoneATag) {
        if (count <= 5) {
            zoneATag.textContent = 'Queue Free (0m Wait)';
            zoneATag.className = 'zone-tag fast';
        } else if (count <= 15) {
            zoneATag.textContent = 'Moderate Queue (~3m)';
            zoneATag.className = 'zone-tag moderate';
        } else {
            zoneATag.textContent = 'Busy Queue (>7m)';
            zoneATag.className = 'zone-tag busy';
        }
    }

    if (zoneBTag) {
        const freeTablePct = Math.round((freeSeats / TOTAL_MESS_SEATS) * 100);
        zoneBTag.textContent = `${freeTablePct}% Tables Free`;
        zoneBTag.className = freeTablePct > 60 ? 'zone-tag fast' : (freeTablePct > 25 ? 'zone-tag moderate' : 'zone-tag busy');
    }
}

// ==========================================
// 5. FEATURE 3: INTERACTIVE MEAL TABS SWITCHER
// ==========================================
function switchMealTab(slotId) {
    // Update active tab buttons
    const buttons = document.querySelectorAll('.meal-tab-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const indicator = btn.querySelector('.meal-active-indicator');
        if (indicator) indicator.remove();
    });

    // Find clicked button
    const targetBtn = Array.from(buttons).find(b => b.getAttribute('onclick')?.includes(slotId));
    if (targetBtn) {
        targetBtn.classList.add('active');
        if (slotId === 'lunch') {
            const ind = document.createElement('span');
            ind.className = 'meal-active-indicator';
            targetBtn.prepend(ind);
        }
    }

    // Switch panes
    const panes = document.querySelectorAll('.meal-slot-pane');
    panes.forEach(p => p.classList.remove('active'));

    const targetPane = document.getElementById(`pane-${slotId}`);
    if (targetPane) {
        targetPane.classList.add('active');
    }
}

// ==========================================
// 6. FOOD VOTING SYSTEM
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
        voteCount.textContent = `${likes} likes, ${dislikes} dislikes (${approval}% student approval)`;
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
// 7. STUDENT FEEDBACK SYSTEM
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
            }, 3500);
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
// 8. ADMIN DASHBOARD INITIALIZATION
// ==========================================
function initAdminDashboard() {
    animateCounter('totalStudents', 0, 312, 1200);
    updateWastage();
    loadAdminFeedback();

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
    const wastage = 12;
    const percentElement = document.getElementById('wastagePercent');
    const fillElement = document.querySelector('.wastage-fill');

    if (percentElement) percentElement.textContent = wastage + '%';
    if (fillElement) fillElement.style.width = wastage + '%';
}

function loadAdminFeedback() {
    const saved = localStorage.getItem(STORAGE_KEYS.FEEDBACK);
    let allFeedback = [];

    if (saved) {
        try {
            allFeedback = JSON.parse(saved);
        } catch (e) {}
    }

    if (allFeedback.length === 0) {
        allFeedback = [
            { name: "Rahul S. (2427030012)", message: "Lunch paneer butter masala was warm and fresh.", timestamp: new Date(Date.now() - 3600000).toISOString() },
            { name: "Ananya K. (2427030045)", message: "Queue moved quickly around 1:15 PM.", timestamp: new Date(Date.now() - 7200000).toISOString() }
        ];
    }

    const totalFeedback = document.getElementById('totalFeedback');
    const positiveFeedback = document.getElementById('positiveFeedback');
    const negativeFeedback = document.getElementById('negativeFeedback');

    if (totalFeedback) totalFeedback.textContent = allFeedback.length;

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
