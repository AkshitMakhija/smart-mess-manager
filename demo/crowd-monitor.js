/**
 * Smart Mess Manager - Live Crowd Monitor Engine
 * ----------------------------------------------------
 * Features:
 * 1. WebRTC wireless phone-to-laptop camera receiver via PeerJS
 * 2. In-browser Person Detection with TensorFlow.js + COCO-SSD
 * 3. Temporal count smoothing (moving median) to prevent jumpy numbers
 * 4. Privacy-first local processing (no video recording or external upload)
 * 5. Instant Fallbacks: Laptop Webcam and Simulation Mode
 * 6. Cross-tab state synchronization with Student Dashboard via localStorage
 */

// ==========================================
// 1. CONFIGURATION
// ==========================================
const CROWD_CONFIG = {
    // Crowd level thresholds (number of estimated people)
    lowThreshold: 5,        // 0 - 5: Low crowd
    moderateThreshold: 15,  // 6 - 15: Moderate crowd
                            // 16+: High crowd

    // Person detection parameters
    confidenceThreshold: 0.40, // Minimum confidence score (40%) to count as a person
    inferenceIntervalMs: 700,  // Milliseconds between detection frames (~1.4 fps for smooth CPU/GPU load)
    smoothingWindowSize: 5,    // Number of recent frames for temporal median smoothing

    // PeerJS room code prefix to avoid global ID collisions on public signaling server
    roomPrefix: 'smm-'
};

// ==========================================
// 2. STATE MANAGEMENT
// ==========================================
const state = {
    mode: 'disconnected',    // 'disconnected' | 'connecting' | 'phone' | 'webcam' | 'simulation'
    roomPin: null,           // 6-digit numeric PIN
    peerId: null,            // Full PeerJS ID: smm-XXXXXX
    peer: null,              // PeerJS instance
    activeCall: null,        // Active WebRTC MediaConnection
    mediaStream: null,       // Current MediaStream (phone or webcam)
    model: null,             // COCO-SSD model instance
    isModelLoading: false,
    isDetecting: false,
    detectionTimer: null,
    recentCounts: [],        // Window of recent person counts for median smoothing
    showBoundingBoxes: true, // Toggle bounding box overlay
    simulationInterval: null,
    lastInferenceMs: 0
};

// ==========================================
// 3. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    generateRoomCredentials();
    initPeerConnection();
    loadDetectionModel();
});

/**
 * Sets up DOM element references and event handlers
 */
function initUI() {
    // Elements
    const copyBtn = document.getElementById('copyLinkBtn');
    const webcamBtn = document.getElementById('useWebcamBtn');
    const simBtn = document.getElementById('startSimBtn');
    const toggleBoxesBtn = document.getElementById('toggleBoxesBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const simBadgeToggle = document.getElementById('simBadgeToggle');

    if (copyBtn) {
        copyBtn.addEventListener('click', copyCameraLink);
    }
    if (webcamBtn) {
        webcamBtn.addEventListener('click', startWebcamMode);
    }
    if (simBtn) {
        simBtn.addEventListener('click', startSimulationMode);
    }
    if (toggleBoxesBtn) {
        toggleBoxesBtn.addEventListener('click', () => {
            state.showBoundingBoxes = !state.showBoundingBoxes;
            toggleBoxesBtn.textContent = state.showBoundingBoxes ? 'Hide Bounding Boxes' : 'Show Bounding Boxes';
            const canvas = document.getElementById('detectionCanvas');
            if (canvas && !state.showBoundingBoxes) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });
    }
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', disconnectAll);
    }
    if (simBadgeToggle) {
        simBadgeToggle.addEventListener('click', startSimulationMode);
    }

    // Window resize handler to align canvas to video
    window.addEventListener('resize', alignCanvasToVideo);
}

// ==========================================
// 4. ROOM CODE & QR GENERATION
// ==========================================
function generateRoomCredentials() {
    // Generate a clean 6-digit numeric PIN
    state.roomPin = Math.floor(100000 + Math.random() * 900000).toString();
    state.peerId = CROWD_CONFIG.roomPrefix + state.roomPin;

    // Display PIN in UI
    const pinEl = document.getElementById('roomPinDisplay');
    if (pinEl) {
        pinEl.textContent = state.roomPin;
    }

    // Build the absolute Camera URL
    const cameraUrl = buildCameraUrl(state.peerId);
    const linkInput = document.getElementById('cameraUrlInput');
    if (linkInput) {
        linkInput.value = cameraUrl;
    }

    // Render QR code
    generateQRCode(cameraUrl);
}

/**
 * Builds dynamic absolute camera URL relative to current location
 */
function buildCameraUrl(fullRoomId) {
    const url = new URL(window.location.href);
    let path = url.pathname;

    if (path.endsWith('/live-crowd.html')) {
        path = path.replace('/live-crowd.html', '/camera.html');
    } else if (path.endsWith('/live-crowd')) {
        path = path.replace('/live-crowd', '/camera');
    } else {
        const lastSlash = path.lastIndexOf('/');
        path = path.substring(0, lastSlash + 1) + 'camera.html';
    }

    url.pathname = path;
    url.search = `?room=${encodeURIComponent(fullRoomId)}`;
    url.hash = '';
    return url.toString();
}

/**
 * Uses client-side qrcodejs library to render the QR code
 */
function generateQRCode(url) {
    const qrContainer = document.getElementById('qrcodeContainer');
    if (!qrContainer) return;

    qrContainer.innerHTML = '';
    try {
        if (typeof QRCode !== 'undefined') {
            new QRCode(qrContainer, {
                text: url,
                width: 190,
                height: 190,
                colorDark: '#0f172a',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        } else {
            qrContainer.innerHTML = `<div class="qr-placeholder">QR Code Generator ready on: <code>${url}</code></div>`;
        }
    } catch (err) {
        console.warn('QR Code generation notice:', err);
    }
}

function copyCameraLink() {
    const cameraUrl = buildCameraUrl(state.peerId);
    navigator.clipboard.writeText(cameraUrl).then(() => {
        showToast('Camera link copied! Open it on your phone.');
        const btn = document.getElementById('copyLinkBtn');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '✓ Link Copied';
            setTimeout(() => { btn.innerHTML = orig; }, 2500);
        }
    }).catch(() => {
        // Fallback if clipboard API is restricted
        const linkInput = document.getElementById('cameraUrlInput');
        if (linkInput) {
            linkInput.select();
            document.execCommand('copy');
            showToast('Camera link copied!');
        }
    });
}

// ==========================================
// 5. WEBRTC & PEERJS CONNECTION
// ==========================================
function initPeerConnection() {
    updateStatusMessage('Connecting to peer network...');

    try {
        state.peer = new Peer(state.peerId, {
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        state.peer.on('open', (id) => {
            console.log('[PeerJS] Connected to signaling broker with ID:', id);
            updateStatusMessage('Waiting for phone camera to connect...');
            const statusDot = document.getElementById('connectionStatusDot');
            if (statusDot) statusDot.className = 'status-dot waiting';
        });

        // Handle incoming phone video call
        state.peer.on('call', (call) => {
            console.log('[PeerJS] Incoming call from phone camera');
            state.activeCall = call;

            updateStatusMessage('Phone connected! Establishing video stream...');

            // Answer without sending local stream (one-way video from phone to laptop)
            call.answer();

            call.on('stream', (remoteStream) => {
                console.log('[PeerJS] Received remote camera stream');
                handleIncomingStream(remoteStream, 'phone');
            });

            call.on('close', () => {
                console.log('[PeerJS] Phone camera disconnected');
                handleStreamDisconnect('Phone camera disconnected.');
            });

            call.on('error', (err) => {
                console.error('[PeerJS] Call error:', err);
                handleStreamDisconnect('Phone connection lost. Reconnecting...');
            });
        });

        state.peer.on('error', (err) => {
            console.warn('[PeerJS] Error:', err.type, err.message);
            if (err.type === 'unavailable-id') {
                // Regenerate if collision occurred
                generateRoomCredentials();
                initPeerConnection();
            } else {
                updateStatusMessage('Waiting for camera connection...');
            }
        });

        state.peer.on('disconnected', () => {
            console.log('[PeerJS] Disconnected from signaling server, reconnecting...');
            if (state.peer && !state.peer.destroyed) {
                state.peer.reconnect();
            }
        });

    } catch (err) {
        console.error('PeerJS initialization error:', err);
        updateStatusMessage('WebRTC initialization failed. You can use Webcam or Simulation Mode.');
    }
}

// ==========================================
// 6. STREAM HANDLING (PHONE & WEBCAM)
// ==========================================
function handleIncomingStream(stream, source) {
    state.mode = source;
    state.mediaStream = stream;

    // Switch UI views: Hide setup QR, show live monitor panel
    const setupCard = document.getElementById('setupCard');
    const monitorCard = document.getElementById('monitorCard');
    if (setupCard) setupCard.style.display = 'none';
    if (monitorCard) monitorCard.style.display = 'block';

    // Bind stream to video element
    const video = document.getElementById('monitorVideo');
    if (video) {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            alignCanvasToVideo();
            startDetectionLoop();
        };
    }

    // Update badges
    const sourceBadge = document.getElementById('streamSourceBadge');
    if (sourceBadge) {
        sourceBadge.textContent = source === 'phone' ? 'LIVE PHONE CAMERA' : 'LAPTOP WEBCAM';
        sourceBadge.className = 'badge badge-live';
    }

    const camStatus = document.getElementById('cameraStatusText');
    if (camStatus) {
        camStatus.textContent = source === 'phone' ? 'Connected (Wireless Phone Stream)' : 'Connected (Laptop Webcam)';
    }

    showToast(source === 'phone' ? 'Phone camera connected successfully!' : 'Laptop webcam active.');
}

function handleStreamDisconnect(message) {
    stopDetectionLoop();
    state.mode = 'disconnected';

    // Show setup card again
    const setupCard = document.getElementById('setupCard');
    const monitorCard = document.getElementById('monitorCard');
    if (setupCard) setupCard.style.display = 'block';
    if (monitorCard) monitorCard.style.display = 'none';

    updateStatusMessage(message || 'Phone camera disconnected. Waiting for connection...');
    const statusDot = document.getElementById('connectionStatusDot');
    if (statusDot) statusDot.className = 'status-dot waiting';

    // Reset metrics in localStorage
    localStorage.removeItem('smm_live_crowd');
}

/**
 * Fallback Mode 1: Instant Laptop Webcam
 */
async function startWebcamMode() {
    try {
        updateStatusMessage('Requesting laptop webcam access...');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        handleIncomingStream(stream, 'webcam');
    } catch (err) {
        console.error('Webcam access error:', err);
        showToast('Could not access laptop webcam. Please check permissions.', 'error');
        updateStatusMessage('Webcam access was denied. You can still use Simulation Mode.');
    }
}

/**
 * Disconnect active streams and return to setup
 */
function disconnectAll() {
    stopDetectionLoop();
    stopSimulationMode();

    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }
    if (state.activeCall) {
        state.activeCall.close();
        state.activeCall = null;
    }

    handleStreamDisconnect('Disconnected. Ready for new connection.');
}

// ==========================================
// 7. TENSORFLOW.JS PERSON DETECTION
// ==========================================
async function loadDetectionModel() {
    state.isModelLoading = true;
    const modelStatusEl = document.getElementById('modelStatusBadge');
    if (modelStatusEl) {
        modelStatusEl.textContent = 'Loading AI Model (COCO-SSD)...';
        modelStatusEl.className = 'badge badge-warning';
    }

    try {
        if (typeof cocoSsd !== 'undefined') {
            // Load lightweight mobile model for real-time in-browser inference
            state.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
            console.log('[AI] TensorFlow.js COCO-SSD loaded successfully');
            if (modelStatusEl) {
                modelStatusEl.textContent = 'AI Model: Ready (COCO-SSD Person Detection)';
                modelStatusEl.className = 'badge badge-success';
            }
        } else {
            console.warn('[AI] COCO-SSD library not yet available');
        }
    } catch (err) {
        console.error('[AI] Model loading error:', err);
        if (modelStatusEl) {
            modelStatusEl.textContent = 'AI Model offline (Simulation Mode ready)';
            modelStatusEl.className = 'badge badge-warning';
        }
    } finally {
        state.isModelLoading = false;
    }
}

function startDetectionLoop() {
    if (state.isDetecting) return;
    state.isDetecting = true;
    state.recentCounts = [];
    runDetection();
}

function stopDetectionLoop() {
    state.isDetecting = false;
    if (state.detectionTimer) {
        clearTimeout(state.detectionTimer);
        state.detectionTimer = null;
    }
    const canvas = document.getElementById('detectionCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

async function runDetection() {
    if (!state.isDetecting) return;

    const video = document.getElementById('monitorVideo');
    if (!video || video.paused || video.ended || video.readyState < 2) {
        state.detectionTimer = setTimeout(runDetection, 300);
        return;
    }

    // Ensure model is ready
    if (!state.model) {
        if (!state.isModelLoading) {
            await loadDetectionModel();
        }
        state.detectionTimer = setTimeout(runDetection, 500);
        return;
    }

    const t0 = performance.now();

    try {
        // Run inference directly on video element
        const predictions = await state.model.detect(video);
        const t1 = performance.now();
        state.lastInferenceMs = Math.round(t1 - t0);

        // Filter for "person" class with sufficient confidence
        const people = predictions.filter(
            p => p.class === 'person' && p.score >= CROWD_CONFIG.confidenceThreshold
        );

        const rawCount = people.length;

        // Apply Temporal Smoothing (Median Filter) to prevent jumpy counts
        state.recentCounts.push(rawCount);
        if (state.recentCounts.length > CROWD_CONFIG.smoothingWindowSize) {
            state.recentCounts.shift();
        }
        const smoothedCount = calculateMedian(state.recentCounts);

        // Average confidence calculation
        let avgScore = 0;
        if (people.length > 0) {
            const sum = people.reduce((acc, p) => acc + p.score, 0);
            avgScore = Math.round((sum / people.length) * 100);
        } else {
            avgScore = 95; // Baseline detector confidence
        }

        // Render subtle bounding boxes
        if (state.showBoundingBoxes) {
            drawDetections(people, video);
        }

        // Update UI metrics and sync to student dashboard
        updateMetricsDisplay(smoothedCount, avgScore, state.lastInferenceMs);

    } catch (err) {
        console.warn('[AI] Inference frame warning:', err);
    }

    // Schedule next inference frame with throttle interval
    state.detectionTimer = setTimeout(runDetection, CROWD_CONFIG.inferenceIntervalMs);
}

/**
 * Calculates the statistical median of an array of numbers
 * Example: [16, 17, 19, 17, 18] -> Sorted: [16, 17, 17, 18, 19] -> Median: 17
 */
function calculateMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
        return sorted[mid];
    }
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Draws professional, non-intrusive bounding boxes with corner accents and confidence tags
 */
function drawDetections(people, video) {
    const canvas = document.getElementById('detectionCanvas');
    if (!canvas) return;

    alignCanvasToVideo();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / (video.videoWidth || canvas.width);
    const scaleY = canvas.height / (video.videoHeight || canvas.height);

    people.forEach((person, idx) => {
        const [x, y, w, h] = person.bbox;
        const rx = x * scaleX;
        const ry = y * scaleY;
        const rw = w * scaleX;
        const rh = h * scaleY;
        const score = Math.round(person.score * 100);

        // Subtle box border
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);

        // Corner accents for a modern CV aesthetic
        const cornerLen = Math.min(14, rw / 4, rh / 4);
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 3;

        // Top-left
        ctx.beginPath();
        ctx.moveTo(rx, ry + cornerLen);
        ctx.lineTo(rx, ry);
        ctx.lineTo(rx + cornerLen, ry);
        ctx.stroke();

        // Top-right
        ctx.beginPath();
        ctx.moveTo(rx + rw - cornerLen, ry);
        ctx.lineTo(rx + rw, ry);
        ctx.lineTo(rx + rw, ry + cornerLen);
        ctx.stroke();

        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(rx, ry + rh - cornerLen);
        ctx.lineTo(rx, ry + rh);
        ctx.lineTo(rx + cornerLen, ry + rh);
        ctx.stroke();

        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(rx + rw - cornerLen, ry + rh);
        ctx.lineTo(rx + rw, ry + rh);
        ctx.lineTo(rx + rw, ry + rh - cornerLen);
        ctx.stroke();

        // Clean label badge above box
        const labelText = `Person ${score}%`;
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const textMetrics = ctx.measureText(labelText);
        const tagHeight = 18;
        const tagWidth = textMetrics.width + 12;

        const tagY = ry > 22 ? ry - tagHeight : ry + 2;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(rx, tagY, tagWidth, tagHeight);

        ctx.fillStyle = '#93c5fd';
        ctx.fillText(labelText, rx + 6, tagY + 13);
    });
}

function alignCanvasToVideo() {
    const video = document.getElementById('monitorVideo');
    const canvas = document.getElementById('detectionCanvas');
    if (!video || !canvas) return;

    const rect = video.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
}

// ==========================================
// 8. METRICS & DASHBOARD SYNCHRONIZATION
// ==========================================
function updateMetricsDisplay(count, confidenceScore, latencyMs) {
    // 1. Estimated People Count
    const countEl = document.getElementById('peopleCountDisplay');
    if (countEl) {
        countEl.textContent = count;
    }

    // 2. Crowd Status Calculation
    let statusText = 'LOW';
    let statusClass = 'status-low';
    let statusDesc = 'Short queues, plenty of available seating';
    let percentage = 25;

    if (count <= CROWD_CONFIG.lowThreshold) {
        statusText = 'LOW';
        statusClass = 'status-low';
        statusDesc = 'Minimal queue, quick meal service';
        percentage = Math.min(35, Math.max(15, count * 7));
    } else if (count <= CROWD_CONFIG.moderateThreshold) {
        statusText = 'MODERATE';
        statusClass = 'status-moderate';
        statusDesc = 'Moderate rush, queue moving smoothly';
        percentage = Math.min(70, 40 + (count - CROWD_CONFIG.lowThreshold) * 3);
    } else {
        statusText = 'HIGH';
        statusClass = 'status-high';
        statusDesc = 'Heavy rush, expected wait time 10-15 mins';
        percentage = Math.min(95, 75 + (count - CROWD_CONFIG.moderateThreshold) * 2);
    }

    const statusBadge = document.getElementById('crowdStatusBadge');
    if (statusBadge) {
        statusBadge.textContent = statusText;
        statusBadge.className = `crowd-status-badge ${statusClass}`;
    }

    const statusDescEl = document.getElementById('crowdStatusDesc');
    if (statusDescEl) {
        statusDescEl.textContent = statusDesc;
    }

    // 3. Confidence & Latency
    const confEl = document.getElementById('confidenceScoreDisplay');
    if (confEl) {
        confEl.textContent = `${confidenceScore}%`;
    }

    const latencyEl = document.getElementById('inferenceLatencyDisplay');
    if (latencyEl && latencyMs) {
        latencyEl.textContent = `~${latencyMs} ms`;
    }

    const lastUpdatedEl = document.getElementById('lastUpdatedTime');
    if (lastUpdatedEl) {
        const now = new Date();
        lastUpdatedEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // 4. Broadcast / Persist to localStorage for Student Dashboard integration
    try {
        const payload = {
            count: count,
            status: statusText,
            percentage: percentage,
            source: state.mode,
            confidence: confidenceScore,
            updatedAt: Date.now()
        };
        localStorage.setItem('smm_live_crowd', JSON.stringify(payload));
    } catch (e) {
        // Ignore quota/private mode restrictions
    }
}

// ==========================================
// 9. FALLBACK MODE 2: SIMULATION MODE
// ==========================================
/**
 * Guaranteed offline demonstration mode
 * Generates realistic student crowd transitions (8 -> 11 -> 14 -> 18 -> 21...)
 */
function startSimulationMode() {
    stopDetectionLoop();
    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(t => t.stop());
        state.mediaStream = null;
    }

    state.mode = 'simulation';

    // Switch UI views
    const setupCard = document.getElementById('setupCard');
    const monitorCard = document.getElementById('monitorCard');
    if (setupCard) setupCard.style.display = 'none';
    if (monitorCard) monitorCard.style.display = 'block';

    const sourceBadge = document.getElementById('streamSourceBadge');
    if (sourceBadge) {
        sourceBadge.textContent = 'SIMULATION MODE ACTIVE';
        sourceBadge.className = 'badge badge-warning';
    }

    const camStatus = document.getElementById('cameraStatusText');
    if (camStatus) {
        camStatus.textContent = 'Simulating Cafeteria Live Feed';
    }

    // Simulated sequence of realistic crowd shifts
    const simulatedCounts = [8, 11, 14, 18, 21, 19, 15, 12, 9, 13, 17, 20, 16];
    let simIndex = 0;

    // Render animated canvas simulation if no video stream
    renderSimulationCanvas();

    function triggerSimStep() {
        if (state.mode !== 'simulation') return;
        const currentSimCount = simulatedCounts[simIndex % simulatedCounts.length];
        simIndex++;

        // Draw animated simulated bounding boxes
        drawSimulatedBoxes(currentSimCount);

        const confidence = 86 + Math.floor(Math.random() * 8);
        updateMetricsDisplay(currentSimCount, confidence, 24);
    }

    triggerSimStep();

    clearInterval(state.simulationInterval);
    state.simulationInterval = setInterval(triggerSimStep, 3500);

    showToast('Simulation Mode activated. Realistic demo counts running.');
}

function stopSimulationMode() {
    clearInterval(state.simulationInterval);
    state.simulationInterval = null;
}

function renderSimulationCanvas() {
    const video = document.getElementById('monitorVideo');
    if (video) {
        video.srcObject = null;
        video.poster = '';
    }
}

function drawSimulatedBoxes(count) {
    const canvas = document.getElementById('detectionCanvas');
    const video = document.getElementById('monitorVideo');
    if (!canvas) return;

    alignCanvasToVideo();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw simulated person silhouettes and bounding boxes
    const w = canvas.width || 640;
    const h = canvas.height || 400;

    // Draw simulated scene background if video has no feed
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid/hall lines
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.7);
    ctx.lineTo(w, h * 0.7);
    ctx.moveTo(w * 0.2, h * 0.7);
    ctx.lineTo(w * 0.1, h);
    ctx.moveTo(w * 0.8, h * 0.7);
    ctx.lineTo(w * 0.9, h);
    ctx.stroke();

    // Scene label
    ctx.fillStyle = '#64748b';
    ctx.font = '500 13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Campus Cafeteria Entrance (Simulation Stream)', w / 2, 35);
    ctx.textAlign = 'left';

    // Draw N subtle bounding boxes
    const numVisible = Math.min(count, 8); // draw up to 8 on screen
    for (let i = 0; i < numVisible; i++) {
        const boxW = 55 + (i % 3) * 10;
        const boxH = 110 + (i % 3) * 15;
        const posX = 40 + (i * ((w - 120) / Math.max(1, numVisible - 1))) + ((i % 2) * 8);
        const posY = h * 0.35 + ((i % 3) * 15);

        // Person silhouette icon / outline
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(posX, posY, boxW, boxH);

        // Box border
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(posX, posY, boxW, boxH);

        // Confidence label
        const conf = 85 + (i * 2) % 12;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(posX, posY - 18, 70, 16);
        ctx.fillStyle = '#93c5fd';
        ctx.font = '600 10px sans-serif';
        ctx.fillText(`Person ${conf}%`, posX + 4, posY - 6);
    }
}

// ==========================================
// 10. UTILITIES
// ==========================================
function updateStatusMessage(msg) {
    const el = document.getElementById('connectionStatusText');
    if (el) el.textContent = msg;
}

function showToast(message, type = 'info') {
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast-notification show ${type}`;
    setTimeout(() => {
        toast.className = 'toast-notification';
    }, 3200);
}
