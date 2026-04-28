// DOM Elements
const remoteVideo = document.getElementById('remoteVideo');
const callToggleBtn = document.getElementById('callToggleBtn');
const iconCall = document.getElementById('icon-call');
const iconHangup = document.getElementById('icon-hangup');
const stargate = document.getElementById('stargate');

/*
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const resetSettings = document.getElementById('resetSettings');
*/

// WebRTC State variables
let localStream;
let peerConnection;
let pendingIceCandidates = []; // FIX: queue for candidates arriving before remoteDescription

function updatePageTitle(state) {
    document.title = state || 'waiting';
}

// Set initial state to waiting since we are ready for incoming connections
updatePageTitle('waiting');

// The signaling server WebSocket connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws`;
const signalingSocket = new WebSocket(wsUrl);

// TURN servers
let configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

async function fetchTurnConfig() {
    try {
        const response = await fetch('/api/turn-config');
        if (response.ok) {
            const turnData = await response.json();
            if (turnData.url && turnData.username) {
                configuration.iceServers.push({
                    urls: turnData.url,
                    username: turnData.username,
                    credential: turnData.credential
                });
                console.log('Successfully fetched secure TURN credentials');
            }
        }
    } catch (error) {
        console.error('Failed to fetch TURN config.', error);
    }
}
fetchTurnConfig();

// =======================
// WebGL Portal Animation
// =======================

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl');

let portalOpen = false;
let portalProgress = 0.0;
let targetProgress = 0.0;
let startTime = Date.now();

const defaultSettings = {
    maxRadius: 1.0, // Large enough to fill most screens
    openSpeed: 0.02,
    rippleSpeed: 1.5,
    distortionStrength: 0.015,
    baseColor: '#b3d9ff',
    highlightColor: '#bdecff',
    cameraResolution: 1080 // Default to 1080p
};

let settings = { ...defaultSettings };

function loadSettings() {
    const saved = localStorage.getItem('stargateSettings_v4');
    if (saved) {
        try {
            settings = { ...defaultSettings, ...JSON.parse(saved) };
        } catch(e) { console.error("Could not parse settings", e); }
    }
    updateUIFromSettings();
}

function saveSettings() {
    localStorage.setItem('stargateSettings_v4', JSON.stringify(settings));
}

function updateUIFromSettings() {
    if (!document.getElementById('set_maxRadius')) return;
    document.getElementById('set_maxRadius').value = settings.maxRadius;
    document.getElementById('val_maxRadius').textContent = settings.maxRadius;

    document.getElementById('set_openSpeed').value = settings.openSpeed;
    document.getElementById('val_openSpeed').textContent = settings.openSpeed;

    document.getElementById('set_rippleSpeed').value = settings.rippleSpeed;
    document.getElementById('val_rippleSpeed').textContent = settings.rippleSpeed;

    document.getElementById('set_distortionStrength').value = settings.distortionStrength;
    document.getElementById('val_distortionStrength').textContent = settings.distortionStrength;

    document.getElementById('set_baseColor').value = settings.baseColor;
    document.getElementById('set_highlightColor').value = settings.highlightColor;

    if (document.getElementById('set_cameraResolution')) {
        document.getElementById('set_cameraResolution').value = settings.cameraResolution || 1080;
    }
}

// Setup input listeners for realtime update
['maxRadius', 'openSpeed', 'rippleSpeed', 'distortionStrength'].forEach(key => {
    const el = document.getElementById(`set_${key}`);
    const valEl = document.getElementById(`val_${key}`);
    if (el) {
        el.addEventListener('input', (e) => {
            settings[key] = parseFloat(e.target.value);
            valEl.textContent = settings[key];
            saveSettings();
        });
    }
});

['baseColor', 'highlightColor'].forEach(key => {
    const el = document.getElementById(`set_${key}`);
    if (el) {
        el.addEventListener('input', (e) => {
            settings[key] = e.target.value;
            saveSettings();
        });
    }
});

const camResEl = document.getElementById('set_cameraResolution');
if (camResEl) {
    camResEl.addEventListener('change', (e) => {
        settings.cameraResolution = parseInt(e.target.value, 10);
        saveSettings();
    });
}

/*
if (settingsBtn) settingsBtn.addEventListener('click', () => settingsPanel.classList.add('active'));
if (closeSettings) closeSettings.addEventListener('click', () => settingsPanel.classList.remove('active'));
if (resetSettings) resetSettings.addEventListener('click', () => {
    settings = { ...defaultSettings };
    updateUIFromSettings();
    saveSettings();
});
*/

loadSettings();

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16) / 255.0,
        parseInt(result[2], 16) / 255.0,
        parseInt(result[3], 16) / 255.0
    ] : [0, 0, 0];
}

if (!gl) {
    console.error('Unable to initialize WebGL.');
}

const vsSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_position * 0.5 + 0.5;
        v_texCoord.y = 1.0 - v_texCoord.y;
    }
`;

const fsSource = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_videoResolution;
    uniform float u_time;
    uniform float u_portalProgress;
    
    uniform float u_maxRadius;
    uniform float u_rippleSpeed;
    uniform float u_distortionStrength;
    uniform vec3 u_baseColor;
    uniform vec3 u_highlightColor;

    void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 raw_centered_uv = uv - 0.5;
        
        vec2 centered_uv = raw_centered_uv;
        centered_uv.x *= u_resolution.x / u_resolution.y;

        float circleDist = length(centered_uv);
        
        // Remove the mix with quadDist so ripples and waves stay entirely circular
        float dist = circleDist; 
        
        // u_maxRadius allows it to expand fullscreen
        float radius = mix(0.0, u_maxRadius, u_portalProgress);

        if (dist > radius + 0.005) {
            float idleAlpha = 1.0 - smoothstep(0.0, 0.05, u_portalProgress);
            vec3 bgColor = vec3(0.0);
            
            if (idleAlpha > 0.0) {
                float angle = atan(centered_uv.y, centered_uv.x);
                float radiusOffset = sin(angle * 8.0 + u_time * 2.0) * 0.005;
                float idleDist = dist + radiusOffset;
                
                float core = smoothstep(0.03, 0.0, idleDist);
                float glow = smoothstep(0.08, 0.0, idleDist) * 0.5;
                float pulse = 0.8 + 0.2 * sin(u_time * 3.0);
                
                vec3 idleColor = u_baseColor * glow + u_highlightColor * core;
                bgColor = idleColor * pulse * idleAlpha;
            }
            
            gl_FragColor = vec4(bgColor, 1.0);
            return;
        }

        vec2 video_uv = v_texCoord;
        float canvasAspect = u_resolution.x / u_resolution.y;
        float videoAspect = u_videoResolution.x / u_videoResolution.y;
        
        // Avoid division by zero when video resolution is 0
        if (videoAspect > 0.0) {
            if (canvasAspect > videoAspect) {
                float y_scale = videoAspect / canvasAspect;
                video_uv.y = (video_uv.y - 0.5) * y_scale + 0.5;
            } else {
                float x_scale = canvasAspect / videoAspect;
                video_uv.x = (video_uv.x - 0.5) * x_scale + 0.5;
            }
        }

        float t = u_time * u_rippleSpeed;
        
        float rippleDist = dist * 30.0 - t * 4.0;
        float concentric = sin(rippleDist);
        
        vec2 p = centered_uv * 12.0;
        float wave1 = sin(p.x * 0.8 + p.y * 0.6 + t);
        float wave2 = sin(p.x * -0.5 + p.y * 0.9 - t * 0.8);
        float wave3 = sin(p.x * 0.3 - p.y * 0.7 + t * 1.2);
        float shimmer = (wave1 + wave2 + wave3) * 0.33;

        float kawoosh = sin(u_portalProgress * 3.14159);
        
        float currentDistortion = mix(u_distortionStrength, 0.0001, u_portalProgress);
        
        // Add the burst during opening (kawoosh), lowered to 2.5 for a more subtle effect
        currentDistortion += kawoosh * (u_distortionStrength * 2.5) * smoothstep(radius, 0.0, dist);

        vec2 distortionDir = normalize(centered_uv + 0.0001);
        vec2 uvDisplacement = distortionDir * concentric * currentDistortion;
        
        // Scale the secondary shimmer down to 0.0001 when fully open
        float currentShimmer = mix(u_distortionStrength * 0.5, 0.0001, u_portalProgress);
        uvDisplacement += vec2(shimmer * currentShimmer, shimmer * currentShimmer);

        vec4 texColor = texture2D(u_image, video_uv + uvDisplacement);

        vec3 finalColor = mix(texColor.rgb, u_baseColor, 0.3);
        
        float highlight = smoothstep(0.5, 1.0, concentric * 0.5 + shimmer * 0.5);
        finalColor += u_highlightColor * highlight * 0.5;
        
        float centerGlow = smoothstep(radius, 0.0, dist) * kawoosh;
        finalColor += u_highlightColor * centerGlow * 0.5;

        float edge = smoothstep(radius - 0.02, radius, dist);
        finalColor = mix(finalColor, vec3(0.8, 0.95, 1.0), edge * (0.4 + 0.4 * sin(t * 2.0)));

        float alpha = 1.0 - smoothstep(radius, radius + 0.005, dist);

        gl_FragColor = vec4(finalColor, alpha);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader error: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);

const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, vertexShader);
gl.attachShader(shaderProgram, fragmentShader);
gl.linkProgram(shaderProgram);

gl.useProgram(shaderProgram);

const positions = new Float32Array([
    -1.0,  1.0,
    -1.0, -1.0,
     1.0,  1.0,
     1.0, -1.0,
]);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(shaderProgram, "a_position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

const resolutionLocation = gl.getUniformLocation(shaderProgram, "u_resolution");
const videoResolutionLocation = gl.getUniformLocation(shaderProgram, "u_videoResolution");
const timeLocation = gl.getUniformLocation(shaderProgram, "u_time");
const portalProgressLocation = gl.getUniformLocation(shaderProgram, "u_portalProgress");

const maxRadiusLocation = gl.getUniformLocation(shaderProgram, "u_maxRadius");
const rippleSpeedLocation = gl.getUniformLocation(shaderProgram, "u_rippleSpeed");
const distortionStrengthLocation = gl.getUniformLocation(shaderProgram, "u_distortionStrength");
const baseColorLocation = gl.getUniformLocation(shaderProgram, "u_baseColor");
const highlightColorLocation = gl.getUniformLocation(shaderProgram, "u_highlightColor");

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Set the canvas drawing buffer to the physical device resolution
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Send the physical resolution to the shader
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function updateTexture() {
    if (remoteVideo.readyState >= 2) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, remoteVideo);
        gl.uniform2f(videoResolutionLocation, remoteVideo.videoWidth, remoteVideo.videoHeight);
    } else {
        // When there's no video, upload a black pixel to avoid WebGL warnings
        const pixel = new Uint8Array([0, 0, 0, 255]);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        gl.uniform2f(videoResolutionLocation, 1, 1);
    }
}

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

function render() {
    portalProgress = lerp(portalProgress, targetProgress, settings.openSpeed);

    updateTexture();

    const currentTime = (Date.now() - startTime) / 1000.0;
    gl.uniform1f(timeLocation, currentTime);
    gl.uniform1f(portalProgressLocation, portalProgress);

    gl.uniform1f(maxRadiusLocation, settings.maxRadius);
    gl.uniform1f(rippleSpeedLocation, settings.rippleSpeed);
    gl.uniform1f(distortionStrengthLocation, settings.distortionStrength);

    const bColor = hexToRgb(settings.baseColor);
    gl.uniform3f(baseColorLocation, bColor[0], bColor[1], bColor[2]);

    const hColor = hexToRgb(settings.highlightColor);
    gl.uniform3f(highlightColorLocation, hColor[0], hColor[1], hColor[2]);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

requestAnimationFrame(render);


// =======================
// Signaling Logic
// =======================

signalingSocket.onopen = () => {
    console.log('Connected to the signaling server.');
};

signalingSocket.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'offer') {
        await handleOffer(message.offer);
    } else if (message.type === 'answer') {
        await handleAnswer(message.answer);
    } else if (message.type === 'ice-candidate') {
        await handleIceCandidate(message.candidate);
    } else if (message.type === 'hangup') {
        closePortalSession();
    }
};

function sendSignalingMessage(message) {
    if (signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify(message));
    }
}

// =======================
// Media and UI Logic
// =======================

// Helper to get getUserMedia constraints based on resolution setting
function getCameraConstraints() {
    const res = settings.cameraResolution || 1080;

    let width, height;
    if (res === 480) { width = 640; height = 480; }
    else if (res === 720) { width = 1280; height = 720; }
    else if (res === 2160) { width = 3840; height = 2160; }
    else { width = 1920; height = 1080; } // Default 1080p

    return {
        video: {
            width: { ideal: width },
            height: { ideal: height },
            facingMode: "user",
            frameRate: { ideal: 30, max: 60 }
        },
        audio: true
    };
}

function updateCallUI(isActive) {
    if (isActive) {
        callToggleBtn.classList.remove('state-call');
        callToggleBtn.classList.add('state-hangup');
        callToggleBtn.title = "Hang Up";
        iconCall.style.display = 'none';
        iconHangup.style.display = 'block';
    } else {
        callToggleBtn.classList.remove('state-hangup');
        callToggleBtn.classList.add('state-call');
        callToggleBtn.title = "Call";
        iconCall.style.display = 'block';
        iconHangup.style.display = 'none';
    }
}

callToggleBtn.onclick = async () => {
    // If currently open (or opening), this functions as a hangup
    if (portalOpen) {
        sendSignalingMessage({ type: 'hangup' });
        closePortalSession();
        return;
    }

    // Otherwise, initiate call
    callToggleBtn.disabled = true; // Briefly disable while fetching media

    portalOpen = true;
    targetProgress = 1.0;

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
        } catch (error) {
            console.error('Error accessing media devices.', error);
            alert('Could not access camera/mic. Please grant permissions.');
            portalOpen = false;
            targetProgress = 0.0;
            callToggleBtn.disabled = false;
            updateCallUI(false);
            return;
        }
    }

    updateCallUI(true);
    callToggleBtn.disabled = false;
    updatePageTitle('waiting');

    createPeerConnection();

    localStream.getTracks().forEach(track => {
        const sender = peerConnection.addTrack(track, localStream);
        if (track.kind === 'video') {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 8000000; // 8 Mbps
            sender.setParameters(params);
        }
    });

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignalingMessage({ type: 'offer', offer: offer });
    } catch (error) {
        console.error('Error creating offer.', error);
        closePortalSession();
    }
};

function closePortalSession() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    portalOpen = false;
    targetProgress = 0.0;
    pendingIceCandidates = []; // FIX: clear queue on session close

    remoteVideo.srcObject = null;
    updateCallUI(false);
    callToggleBtn.disabled = false;
    updatePageTitle();
}

// =======================
// WebRTC Peer Connection Core
// =======================

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignalingMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play();
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
            updatePageTitle('open');
        }
        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            closePortalSession();
        }
    };
}

// =======================
// Handling Signaling Messages
// =======================

async function handleOffer(offer) {
    if (!peerConnection) {
        createPeerConnection();
    }

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
        } catch (error) {
            console.error('Error accessing media devices on answer.', error);
        }
    }

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingIceCandidates(); // FIX: apply any queued candidates

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    sendSignalingMessage({ type: 'answer', answer: answer });

    portalOpen = true;
    targetProgress = 1.0;

    updateCallUI(true);
    updatePageTitle('waiting');
}

async function handleAnswer(answer) {
    if (!peerConnection) {
        console.error('No peer connection when receiving answer.');
        return;
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIceCandidates(); // FIX: apply any queued candidates
}

// FIX: queue candidates that arrive before remoteDescription is set
async function handleIceCandidate(candidate) {
    if (!peerConnection) {
        console.error('No peer connection when receiving ICE candidate.');
        return;
    }
    if (!peerConnection.remoteDescription) {
        pendingIceCandidates.push(candidate);
        return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error('Error adding received ICE candidate', e);
    }
}

// FIX: flush queued candidates after remoteDescription is set
async function flushPendingIceCandidates() {
    for (const candidate of pendingIceCandidates) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error flushing ICE candidate', e);
        }
    }
    pendingIceCandidates = [];
}