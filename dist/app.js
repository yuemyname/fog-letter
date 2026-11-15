import { Condensation, BreathEnvelope } from './condensation.mjs';
const $ = id => document.getElementById(id);
const video = $('camera'), canvas = $('mist'), ctx = canvas.getContext('2d');
const cursor = $('cursor'), pen = cursor.getContext('2d');
const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d');
const glass = document.createElement('canvas'), glassCtx = glass.getContext('2d');
let field, alphaImage, width, height, dpr, active = false, started = false;
let stream, micStream, audioContext, handTracker, faceTracker, visionFiles, visionModule;
let handEnabled = false, lastHand = null, lastFrame = 0, lastFaceFrame = 0;
let lastDraw = 0, noticeTimer, pointer = null, audioLevel = 0, breathClock = 0, demoClouds = [];
let mouth = null, mouthSeen = 0, latestHand = null;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mixPoint = (a, b, k) => ({x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k});
function notice(text) {
  $('status').textContent = text; $('status').style.display = 'block';
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('status').style.display = 'none', 5000);
}
function resize() {
  const previous = field;
  width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 1.5);
  for (const c of [canvas, cursor]) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); pen.setTransform(dpr, 0, 0, dpr, 0, 0);
  field = new Condensation(width, height);
  if (previous) for (let y = 0; y < field.rows; y++) for (let x = 0; x < field.columns; x++) {
    const px = Math.min(previous.columns - 1, Math.floor(x / field.columns * previous.columns));
    const py = Math.min(previous.rows - 1, Math.floor(y / field.rows * previous.rows));
    field.water[y * field.columns + x] = previous.water[py * previous.columns + px];
  }
  mask.width = field.columns; mask.height = field.rows;
  alphaImage = maskCtx.createImageData(mask.width, mask.height);
  glass.width = Math.round(width * dpr); glass.height = Math.round(height * dpr);
  glassCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Fixed microdroplets belong to the glass, so they do not flicker between frames.
  let seed = 309;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < Math.min(7500, width * height / 180); i++) {
    const x = random() * width, y = random() * height, r = .3 + random() ** 3 * 2.1;
    glassCtx.beginPath(); glassCtx.ellipse(x, y, r, r * 1.25, 0, 0, Math.PI * 2);
    glassCtx.fillStyle = `rgba(255,255,255,${.04 + random() * .16})`; glassCtx.fill();
    if (r > 1) { glassCtx.beginPath(); glassCtx.arc(x + .3, y + .6, r * .55, 0, Math.PI); glassCtx.strokeStyle = '#52696d22'; glassCtx.lineWidth = .6; glassCtx.stroke(); }
  }
  lastHand = null; pointer = null;
}
addEventListener('resize', resize); resize();
function breathOrigin(now) {
  return mouth && now - mouthSeen < 1800 ? mouth : {x: width * .5, y: height * .59};
}
function addFog() {
  const origin = breathOrigin(performance.now());
  field.breathe(origin.x, origin.y, 1.5);
  demoClouds.push({delay: .24, x: origin.x, y: origin.y, strength: 1.4}, {delay: .5, x: origin.x, y: origin.y, strength: 1.1});
}
function erase(a, b, radius = 17) { field.wipe(a, b, radius); }
canvas.addEventListener('pointerdown', e => {
  if (!active) return;
  canvas.setPointerCapture(e.pointerId);
  pointer = {id: e.pointerId, point: {x: e.clientX, y: e.clientY}, radius: e.pointerType === 'touch' ? 19 : 15};
  erase(pointer.point, pointer.point, pointer.radius);
});
canvas.addEventListener('pointermove', e => {
  if (!pointer || e.pointerId !== pointer.id) return;
  const events = e.getCoalescedEvents?.() || [e];
  for (const event of events.length ? events : [e]) {
    const point = {x: event.clientX, y: event.clientY};
    erase(pointer.point, point, pointer.radius); pointer.point = point;
  }
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, e => {
  if (pointer?.id === e.pointerId) pointer = null;
});
function drawMirror() {
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const w = video.videoWidth * scale, h = video.videoHeight * scale;
  ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1);
  ctx.filter = 'blur(13px)';
  ctx.drawImage(video, (width - w) / 2 - 16, (height - h) / 2 - 16, w + 32, h + 32); ctx.restore();
}
function render(t) {
  requestAnimationFrame(render);
  if (t - lastDraw < 30) return;
  const dt = Math.min(.05, Math.max(0, (t - lastDraw) / 1000)); lastDraw = t;
  if (!active) return;
  if (audioLevel > .06 && audioContext?.state === 'running') {
    breathClock += dt;
    if (breathClock > .115) {
      const origin = breathOrigin(t);
      field.breathe(origin.x, origin.y, audioLevel * 1.4); breathClock = 0;
    }
  } else breathClock = 0;
  for (const cloud of demoClouds) {
    cloud.delay -= dt;
    if (cloud.delay <= 0) { field.breathe(cloud.x, cloud.y, cloud.strength); cloud.done = true; }
  }
  demoClouds = demoClouds.filter(c => !c.done);
  field.step(dt);
  field.writeAlpha(alphaImage.data); maskCtx.putImageData(alphaImage, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (video.readyState >= 2) drawMirror();
  ctx.fillStyle = video.readyState >= 2 ? 'rgba(228,237,239,.64)' : 'rgba(226,237,234,.82)';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(glass, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true; ctx.drawImage(mask, 0, 0, width, height); ctx.restore();
  // Small, unobtrusive fingertip feedback. The palm has no circular eraser outline.
  pen.clearRect(0, 0, width, height);
  if (latestHand && t - latestHand.time < 160 && !latestHand.open) {
    pen.beginPath(); pen.arc(latestHand.point.x, latestHand.point.y, 3, 0, Math.PI * 2);
    pen.fillStyle = '#ffffff88'; pen.fill();
  }
}
requestAnimationFrame(render);
function enter() { active = true; $('welcome').hidden = true; $('controls').hidden = false; }
$('demo').onclick = () => {
  enter(); addFog(); $('hint').textContent = '화면을 문질러 마음을 남겨보세요';
  notice('체험 모드 · 김 서리기를 누르면 입김처럼 번져요.');
};
$('start').onclick = async () => {
  if (started) return; started = true; $('start').textContent = '거울을 여는 중…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 1280}, height: {ideal: 720}}, audio: false});
    video.srcObject = stream; await video.play(); enter(); $('ambient').style.display = 'none';
    // The mirror starts clear: only exhalation deposits new condensation.
    void enableHands(); await enableMic();
  } catch {
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    notice('카메라를 열 수 없어요. 권한을 허용하거나 체험 모드를 이용해 주세요.');
    started = false; $('start').innerHTML = '거울 열기 <span>↗</span>';
  }
};
$('fog').onclick = addFog;
$('wipe').onclick = () => { field.clear(); demoClouds = []; breathClock = 0; };
$('help').onclick = () => $('guide').hidden = !$('guide').hidden;
$('closeGuide').onclick = () => $('guide').hidden = true;
async function enableMic() {
  if (audioContext) { await audioContext.resume(); return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
    audioContext = new AudioContext(); await audioContext.resume();
    const source = audioContext.createMediaStreamSource(micStream), analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = .35; source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize), bins = new Float32Array(analyser.frequencyBinCount);
    const envelope = new BreathEnvelope(); let previous = performance.now(), calibrating = .6;
    const detect = now => {
      if (!audioContext || audioContext.state === 'closed') return;
      const dt = Math.min(.1, (now - previous) / 1000); previous = now;
      if (audioContext.state === 'running') {
        analyser.getFloatTimeDomainData(samples); analyser.getFloatFrequencyData(bins);
        let sum = 0; for (const v of samples) sum += v * v;
        const rms = Math.sqrt(sum / samples.length);
        // Spectral flatness from 150–6000 Hz suppresses strongly tonal sounds.
        const lo = Math.max(1, Math.ceil(150 * analyser.fftSize / audioContext.sampleRate));
        const hi = Math.min(bins.length, Math.floor(6000 * analyser.fftSize / audioContext.sampleRate));
        let linear = 0, logs = 0;
        for (let i = lo; i < hi; i++) { const power = Math.max(1e-12, 10 ** (bins[i] / 10)); linear += power; logs += Math.log(power); }
        const count = Math.max(1, hi - lo), flatness = Math.exp(logs / count) / Math.max(1e-12, linear / count);
        calibrating -= dt;
        if (calibrating > 0) { envelope.noise = Math.max(.002, rms); audioLevel = 0; }
        else audioLevel = envelope.update(rms, flatness, dt);
        if (audioLevel > .12) $('hint').textContent = '입김이 유리에 번지고 있어요';
      } else audioLevel = 0;
      requestAnimationFrame(detect);
    };
    requestAnimationFrame(detect); setMicLabel(true);
  } catch {
    micStream?.getTracks().forEach(t => t.stop());
    if (audioContext) { await audioContext.close().catch(() => {}); audioContext = null; }
    notice('마이크를 사용할 수 없어요. ‘김 서리기’ 버튼으로도 사용할 수 있어요.');
  }
}
function setMicLabel(on) {
  $('sound').setAttribute('aria-pressed', String(on));
  $('sound').querySelector('span').textContent = on ? '입김 켜짐' : '입김 꺼짐';
}
$('sound').onclick = async () => {
  if (!audioContext) { await enableMic(); return; }
  if (audioContext.state === 'running') { await audioContext.suspend(); audioLevel = 0; setMicLabel(false); }
  else { await audioContext.resume(); setMicLabel(true); }
};
function position(point) {
  const vw = video.videoWidth, vh = video.videoHeight, scale = Math.max(width / vw, height / vh);
  return {x: width - (point.x * vw * scale + (width - vw * scale) / 2), y: point.y * vh * scale + (height - vh * scale) / 2};
}
async function enableHands() {
  if (!stream) { notice('손 추적은 카메라 모드에서 사용할 수 있어요.'); return; }
  if (handTracker) { handEnabled = !handEnabled; setHands(); return; }
  if ($('hands').disabled) return;
  $('hands').disabled = true; $('hands').querySelector('span').textContent = '손 추적 준비 중';
  try {
    visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
    visionFiles = await visionModule.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
    handTracker = await visionModule.HandLandmarker.createFromOptions(visionFiles, {
      baseOptions: {modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'},
      runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .55, minTrackingConfidence: .55
    });
    handEnabled = true; setHands(); requestAnimationFrame(track);
    // A separate, lower-rate face detector locates the mouth without uploading video.
    void enableFace();
  } catch { notice('손 추적을 불러오지 못했어요. 화면을 직접 문질러 사용할 수 있어요.'); $('hands').querySelector('span').textContent = '손 추적 다시 시도'; }
  finally { $('hands').disabled = false; }
}
async function enableFace() {
  try {
    faceTracker = await visionModule.FaceDetector.createFromOptions(visionFiles, {
      baseOptions: {modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'},
      runningMode: 'VIDEO', minDetectionConfidence: .6
    });
  } catch { /* If unavailable, exhalations originate near the center of the mirror. */ }
}
function setHands() {
  $('hands').setAttribute('aria-pressed', String(handEnabled));
  $('hands').querySelector('span').textContent = handEnabled ? '손 추적 켜짐' : '손 추적 꺼짐';
  lastHand = null; latestHand = null; pen.clearRect(0, 0, width, height);
}
function wipePalm(points, previous) {
  const span = distance(points[5], points[17]);
  const center = {x: (points[0].x + points[5].x + points[9].x + points[13].x + points[17].x) / 5,
    y: (points[0].y + points[5].y + points[9].y + points[13].y + points[17].y) / 5};
  const before = previous ? previous.center : center;
  const angle = Math.atan2(points[9].y - points[0].y, points[9].x - points[0].x);
  // Palm contact follows its orientation; individual fingers leave their own trails.
  field.wipe(before, center, Math.max(20, Math.min(110, span * .58)), .83, angle);
  for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
    const radius = Math.max(5, Math.min(21, span * .115));
    for (let j = 0; j < chain.length; j++) {
      const index = chain[j];
      field.wipe(previous ? previous.points[index] : points[index], points[index], radius);
      if (j > 0) field.wipe(points[chain[j - 1]], points[index], radius);
    }
  }
  return center;
}
function track(t) {
  requestAnimationFrame(track);
  if (!handEnabled || video.readyState < 2 || t - lastFrame < 50 || video.currentTime === track.lastVideoTime) return;
  lastFrame = t; track.lastVideoTime = video.currentTime;
  if (faceTracker && t - lastFaceFrame > 200) {
    lastFaceFrame = t;
    try {
      const faces = faceTracker.detectForVideo(video, t).detections;
      const lip = faces?.[0]?.keypoints?.[3];
      if (lip) { const next = position(lip); mouth = mouth ? mixPoint(mouth, next, .32) : next; mouthSeen = t; }
    } catch { faceTracker.close(); faceTracker = null; }
  }
  try {
    const hand = handTracker.detectForVideo(video, t).landmarks?.[0];
    if (!hand) { lastHand = null; latestHand = null; return; }
    const extended = [8, 12, 16, 20].map(tip => distance(hand[tip], hand[0]) > distance(hand[tip - 2], hand[0]) * 1.12);
    const open = extended.every(Boolean), writing = extended[0] && !extended[1] && !extended[2];
    if (!open && !writing) { lastHand = null; latestHand = null; return; }
    let points = hand.map(position), point = points[open ? 9 : 8];
    const continuous = lastHand && lastHand.open === open && t - lastHand.time < 180 && distance(lastHand.point, point) < width * .22;
    const previous = continuous ? lastHand : null;
    if (previous) { points = points.map((p, i) => mixPoint(previous.points[i], p, .65)); point = points[open ? 9 : 8]; }
    let center = null;
    if (open) center = wipePalm(points, previous);
    else { const radius = Math.max(9, Math.min(19, distance(points[5], points[17]) * .105)); erase(previous ? previous.point : point, point, radius); }
    lastHand = {points, point, center, open, time: t}; latestHand = lastHand;
    $('hint').textContent = open ? '손바닥으로 유리를 닦고 있어요' : '검지로 마음을 쓰고 있어요';
  } catch { handEnabled = false; setHands(); notice('손 추적이 중단되었어요. 화면을 직접 문질러 주세요.'); }
}
$('hands').onclick = enableHands;
addEventListener('pagehide', () => {
  stream?.getTracks().forEach(t => t.stop()); micStream?.getTracks().forEach(t => t.stop());
  audioContext?.close(); handTracker?.close(); faceTracker?.close();
});
