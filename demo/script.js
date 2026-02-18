// Voting data storage
let votingData = {
    paneer: { likes: 0, dislikes: 0 },
    vegetable: { likes: 0, dislikes: 0 }
};

// Feedback storage
let feedbackData = [];

// Initialize page-specific functionality
document.addEventListener('DOMContentLoaded', function() {
    // Check which page we're on
    if (document.querySelector('#crowdLevel')) {
        initStudentDashboard();
    }
    if (document.querySelector('#totalStudents')) {
        initAdminDashboard();
    }
});

// Student Dashboard Functions
function initStudentDashboard() {
    // Initialize crowd level
    updateCrowdLevel();
    
    // Update crowd level every 10 seconds
    setInterval(updateCrowdLevel, 10000);
    
    // Load voting data from localStorage
    loadVotingData();
    
    // Load feedback data from localStorage
    loadFeedbackData();
}

function updateCrowdLevel() {
    // Simulate crowd levels: Low (0-40%), Medium (40-70%), High (70-100%)
    const levels = ['low', 'medium', 'high'];
    const percentages = [25, 55, 85];
    
    // Randomly select a level (weighted towards medium)
    const random = Math.random();
    let level, percentage;
    
    if (random < 0.3) {
        level = 'low';
        percentage = Math.floor(Math.random() * 30) + 10; // 10-40%
    } else if (random < 0.7) {
        level = 'medium';
        percentage = Math.floor(Math.random() * 30) + 40; // 40-70%
    } else {
        level = 'high';
        percentage = Math.floor(Math.random() * 25) + 70; // 70-95%
    }
    
    const indicator = document.getElementById('crowdIndicator');
    const fill = document.getElementById('crowdFill');
    
    if (indicator && fill) {
        // Update indicator
        indicator.textContent = level.charAt(0).toUpperCase() + level.slice(1);
        indicator.className = 'crowd-indicator ' + level;
        
        // Update fill bar
        fill.style.width = percentage + '%';
    }
}

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
        voteCount.textContent = `${votingData[item].likes} likes, ${votingData[item].dislikes} dislikes`;
    }
}

function loadVotingData() {
    const saved = localStorage.getItem('votingData');
    if (saved) {
        votingData = JSON.parse(saved);
        // Update displays
        Object.keys(votingData).forEach(item => {
            updateVoteDisplay(item);
        });
    }
}

function saveVotingData() {
    localStorage.setItem('votingData', JSON.stringify(votingData));
}

function submitFeedback(event) {
    event.preventDefault();
    
    const name = document.getElementById('feedbackName').value;
    const message = document.getElementById('feedbackMessage').value;
    
    if (name && message) {
        // Add to feedback data
        const feedback = {
            name: name,
            message: message,
            timestamp: new Date().toISOString()
        };
        
        feedbackData.push(feedback);
        saveFeedbackData();
        
        // Show success message
        const successMsg = document.getElementById('feedbackSuccess');
        if (successMsg) {
            successMsg.style.display = 'block';
            setTimeout(() => {
                successMsg.style.display = 'none';
            }, 3000);
        }
        
        // Reset form
        document.getElementById('feedbackForm').reset();
    }
}

function loadFeedbackData() {
    const saved = localStorage.getItem('feedbackData');
    if (saved) {
        feedbackData = JSON.parse(saved);
    }
}

function saveFeedbackData() {
    localStorage.setItem('feedbackData', JSON.stringify(feedbackData));
}

// Admin Dashboard Functions
function initAdminDashboard() {
    // Animate total students counter
    animateCounter('totalStudents', 0, 247, 2000);
    
    // Update wastage percentage
    updateWastage();
    
    // Load and display feedback
    loadAdminFeedback();
    
    // Update stats periodically
    setInterval(() => {
        updateWastage();
        loadAdminFeedback();
    }, 15000);
}

function animateCounter(elementId, start, end, duration) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const range = end - start;
    const increment = range / (duration / 16); // 60fps
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.floor(current);
    }, 16);
}

function updateWastage() {
    // Simulate wastage percentage (10-20%)
    const wastage = Math.floor(Math.random() * 11) + 10; // 10-20%
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
    // Load feedback from localStorage
    const saved = localStorage.getItem('feedbackData');
    let allFeedback = [];
    
    if (saved) {
        allFeedback = JSON.parse(saved);
    }
    
    // Update feedback stats
    const totalFeedback = document.getElementById('totalFeedback');
    const positiveFeedback = document.getElementById('positiveFeedback');
    const negativeFeedback = document.getElementById('negativeFeedback');
    
    if (totalFeedback) {
        animateCounter('totalFeedback', parseInt(totalFeedback.textContent) || 0, allFeedback.length, 500);
    }
    
    // Simple sentiment analysis (check for positive/negative keywords)
    let positive = 0;
    let negative = 0;
    
    allFeedback.forEach(feedback => {
        const message = feedback.message.toLowerCase();
        const positiveWords = ['good', 'great', 'excellent', 'nice', 'love', 'amazing', 'delicious', 'tasty', 'wonderful'];
        const negativeWords = ['bad', 'poor', 'terrible', 'awful', 'disgusting', 'worst', 'hate', 'disappointed'];
        
        const hasPositive = positiveWords.some(word => message.includes(word));
        const hasNegative = negativeWords.some(word => message.includes(word));
        
        if (hasPositive && !hasNegative) {
            positive++;
        } else if (hasNegative) {
            negative++;
        }
    });
    
    if (positiveFeedback) {
        positiveFeedback.textContent = positive;
    }
    if (negativeFeedback) {
        negativeFeedback.textContent = negative;
    }
    
    // Display recent feedback
    displayRecentFeedback(allFeedback.slice(-5).reverse()); // Last 5, most recent first
}

function displayRecentFeedback(feedbacks) {
    const feedbackList = document.getElementById('feedbackList');
    if (!feedbackList) return;
    
    if (feedbacks.length === 0) {
        feedbackList.innerHTML = '<p class="no-feedback">No feedback submitted yet.</p>';
        return;
    }
    
    feedbackList.innerHTML = feedbacks.map(feedback => {
        const date = new Date(feedback.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        return `
            <div class="feedback-item">
                <strong>${feedback.name}</strong>
                <p>${feedback.message}</p>
                <small style="color: #888; font-size: 0.85rem;">${dateStr}</small>
            </div>
        `;
    }).join('');
}
