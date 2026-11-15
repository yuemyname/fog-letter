import { Condensation } from './condensation.mjs';
import { lipShape, MouthGesture } from './mouth-gesture.mjs';
import { handMode, HandGesture, writingPoint } from './hand-gesture.mjs';
const $ = id => document.getElementById(id);
const video = $('camera'), canvas = $('mist'), ctx = canvas.getContext('2d');
const cursor = $('cursor'), pen = cursor.getContext('2d');
const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d');
const glass = document.createElement('canvas'), glassCtx = glass.getContext('2d');
let field, alphaImage, width, height, dpr, active = false, started = false;
let stream, handTracker, faceTracker, visionFiles, visionModule, visionPromise;
let mouthEnabled = false, mouthLevel = 0;
const mouthGesture = new MouthGesture();
const handGesture = new HandGesture();
let handEnabled = false, lastHand = null, lastFrame = 0, lastFaceFrame = 0;
let lastDraw = 0, noticeTimer, pointer = null, breathClock = 0, demoClouds = [];
let mouth = null, mouthSeen = 0, latestHand = null, handPreview = null;
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
  lastHand = null; handGesture.reset(); latestHand = null; pointer = null; mouth = null; mouthLevel = 0; mouthGesture.reset();
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
function erase(a, b, radius = 25) { field.wipe(a, b, radius); }
canvas.addEventListener('pointerdown', e => {
  if (!active) return;
  canvas.setPointerCapture(e.pointerId);
  pointer = {id: e.pointerId, point: {x: e.clientX, y: e.clientY}, radius: e.pointerType === 'touch' ? 27 : 25};
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
  const elapsed = Math.max(0, (t - lastDraw) / 1000);
  const dt = Math.min(.05, elapsed); lastDraw = t;
  if (!active) return;
  if (mouthEnabled && mouth && t - mouthSeen < 220 && mouthLevel > .06) {
    breathClock += dt;
    if (breathClock > .115) {
      field.breathe(mouth.x, mouth.y, mouthLevel * 1.4); breathClock = 0;
    }
  } else breathClock = 0;
  for (const cloud of demoClouds) {
    cloud.delay -= dt;
    if (cloud.delay <= 0) { field.breathe(cloud.x, cloud.y, cloud.strength); cloud.done = true; }
  }
  demoClouds = demoClouds.filter(c => !c.done);
  field.step(elapsed);
  field.writeAlpha(alphaImage.data); maskCtx.putImageData(alphaImage, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (video.readyState >= 2) drawMirror();
  ctx.fillStyle = video.readyState >= 2 ? 'rgba(228,237,239,.64)' : 'rgba(226,237,234,.82)';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(glass, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true; ctx.drawImage(mask, 0, 0, width, height); ctx.restore();
  // Only writing shows a fingertip cursor; a fist uses the wider wiping contact.
  pen.clearRect(0, 0, width, height);
  if (handEnabled && handPreview && t - handPreview.time < 200) {
    const thumb = handPreview.points[4], index = handPreview.points[8];
    const writing = latestHand?.mode === 'write' && t - latestHand.time < 160;
    pen.strokeStyle = writing ? '#b9f9d5dd' : '#ffffffaa'; pen.lineWidth = 1.5;
    pen.beginPath(); pen.moveTo(thumb.x, thumb.y); pen.lineTo(index.x, index.y); pen.stroke();
    for (const point of [thumb, index]) {
      pen.beginPath(); pen.arc(point.x, point.y, writing ? 5 : 7, 0, Math.PI * 2); pen.stroke();
    }
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
    requestAnimationFrame(track);
    void enableFace(); void enableHands();
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
function setMouthLabel() {
  $('mouth').setAttribute('aria-pressed', String(mouthEnabled));
  $('mouth').querySelector('span').textContent = mouthEnabled ? '입모양 켜짐' : '입모양 꺼짐';
}
$('mouth').onclick = async () => {
  if (!stream) { notice('입모양 감지는 카메라 모드에서 사용할 수 있어요.'); return; }
  if (!faceTracker) { await enableFace(); return; }
  mouthEnabled = !mouthEnabled; mouthGesture.reset(); mouthLevel = 0;
  mouth = null; breathClock = 0; setMouthLabel();
};
async function getVision() {
  if (!visionPromise) visionPromise = (async () => {
    visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
    visionFiles = await visionModule.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
  })().catch(error => { visionPromise = null; throw error; });
  await visionPromise;
}
function position(point) {
  const vw = video.videoWidth, vh = video.videoHeight, scale = Math.max(width / vw, height / vh);
  return {x: width - (point.x * vw * scale + (width - vw * scale) / 2), y: point.y * vh * scale + (height - vh * scale) / 2};
}
async function enableHands() {
  if (!stream) { notice('손 추적은 카메라 모드에서 사용할 수 있어요.'); return; }
  if (handTracker) { handEnabled = !handEnabled; setHands(); return; }
  if ($('hands').disabled) return;
  $('hands').disabled = true; $('hands').querySelector('span').textContent = '손 추적 준비 중';
  $('handStatus').textContent = '손 인식 모델을 불러오고 있어요';
  try {
    await getVision();
    handTracker = await visionModule.HandLandmarker.createFromOptions(visionFiles, {
      baseOptions: {modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'},
      runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .4, minHandPresenceConfidence: .4, minTrackingConfidence: .4
    });
    handEnabled = true; setHands();
  } catch { notice('손 추적을 불러오지 못했어요. 화면을 직접 문질러 사용할 수 있어요.'); $('hands').querySelector('span').textContent = '손 추적 다시 시도'; $('handStatus').textContent = '손 추적을 불러오지 못했어요 · 다시 시도해 주세요'; }
  finally { $('hands').disabled = false; }
}
async function enableFace() {
  if ($('mouth').disabled) return;
  $('mouth').disabled = true; $('mouth').querySelector('span').textContent = '입모양 준비 중';
  try {
    await getVision();
    faceTracker = await visionModule.FaceLandmarker.createFromOptions(visionFiles, {
      baseOptions: {modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
      minFaceDetectionConfidence: .55, minFacePresenceConfidence: .55, minTrackingConfidence: .55
    });
    mouthEnabled = true; setMouthLabel();
    $('hint').textContent = '입술을 오므려 후— 하는 모양을 해보세요';
  } catch {
    mouthEnabled = false; mouthLevel = 0; mouth = null; mouthGesture.reset();
    $('mouth').querySelector('span').textContent = '입모양 다시 시도';
    notice('입모양 감지를 불러오지 못했어요. ‘김 서리기’ 버튼으로 사용할 수 있어요.');
  } finally { $('mouth').disabled = false; }
}
function setHands() {
  $('hands').setAttribute('aria-pressed', String(handEnabled));
  $('hands').querySelector('span').textContent = handEnabled ? '손 추적 켜짐' : '손 추적 꺼짐';
  $('handStatus').textContent = handEnabled ? '손 전체를 카메라에 보여주세요' : '손 추적 꺼짐';
  handPreview = null; lastHand = null; latestHand = null; handGesture.reset(); pen.clearRect(0, 0, width, height);
}
function wipeFist(points, previous) {
  const center = {x: (points[0].x + points[5].x + points[9].x + points[13].x + points[17].x) / 5,
    y: (points[0].y + points[5].y + points[9].y + points[13].y + points[17].y) / 5};
  const span = distance(points[5], points[17]);
  const angle = Math.atan2(points[9].y - points[0].y, points[9].x - points[0].x);
  field.wipe(previous ? previous.center : center, center, Math.max(28, Math.min(95, span * .65)), .9, angle);
  return center;
}
function track(t) {
  requestAnimationFrame(track);
  if (video.readyState < 2 || video.currentTime === track.lastVideoTime) return;
  if (t - lastFrame < 50) return;
  lastFrame = t; track.lastVideoTime = video.currentTime;
  if (mouthEnabled && faceTracker && t - lastFaceFrame > 80) {
    const dt = Math.min(.12, (t - lastFaceFrame) / 1000); lastFaceFrame = t;
    try {
      const result = faceTracker.detectForVideo(video, t);
      const shape = lipShape(result.faceLandmarks?.[0], result.faceBlendshapes?.[0]?.categories,
        video.videoWidth, video.videoHeight);
      mouthLevel = mouthGesture.update(shape, dt);
      if (shape) {
        const next = position(shape.center);
        mouth = mouth && t - mouthSeen < 220 ? mixPoint(mouth, next, .75) : next;
        mouthSeen = t;
        if (mouthLevel > .1) $('hint').textContent = '입 주변에서 김이 퍼지고 있어요';
      } else {
        mouth = null; mouthLevel = 0; breathClock = 0;
        $('hint').textContent = '카메라에 얼굴과 입이 보이게 해주세요';
      }
    } catch {
      faceTracker.close(); faceTracker = null; mouthEnabled = false; mouthLevel = 0;
      mouth = null; mouthGesture.reset(); setMouthLabel();
      notice('입모양 감지가 중단되었어요. 입모양 버튼을 눌러 다시 시도해 주세요.');
    }
  }
  if (!handEnabled || !handTracker) return;
  try {
    const hand = handTracker.detectForVideo(video, t).landmarks?.[0];
    if (!hand) {
      lastHand = null; latestHand = null; handPreview = null; handGesture.reset();
      $('handStatus').textContent = '손이 보이지 않아요 · 손 전체를 카메라에 보여주세요';
      return;
    }
    handPreview = {points: hand.map(position), time: t};
    const mode = handGesture.update(handMode(hand, video.videoWidth, video.videoHeight, handGesture.candidate === 'write'), t);
    if (mode === 'none') {
      lastHand = null; latestHand = null;
      $('handStatus').textContent = handGesture.candidate === 'write' ? '집기 인식 중…' : '손 인식됨 · 엄지와 검지 끝을 붙여주세요';
      return;
    }
    let points = hand.map(position), point = mode === 'erase' ? points[9] : writingPoint(points);
    const continuous = lastHand && lastHand.mode === mode && t - lastHand.time < 180 && distance(lastHand.point, point) < width * .22;
    const previous = continuous ? lastHand : null;
    if (previous) { points = points.map((p, i) => mixPoint(previous.points[i], p, .65)); point = mode === 'erase' ? points[9] : writingPoint(points); }
    let center = null;
    if (mode === 'erase') center = wipeFist(points, previous);
    else {
      const radius = Math.max(20, Math.min(32, distance(points[5], points[17]) * .21));
      erase(previous ? previous.point : point, point, radius);
    }
    lastHand = {points, point, center, mode, time: t}; latestHand = lastHand;
    $('handStatus').textContent = mode === 'erase' ? '주먹 인식 · 지우는 중' : '집기 인식 · 글씨 쓰는 중';
  } catch { handEnabled = false; setHands(); notice('손 추적이 중단되었어요. 화면을 직접 문질러 주세요.'); }
}
$('hands').onclick = enableHands;
addEventListener('pagehide', () => {
  stream?.getTracks().forEach(t => t.stop());
  handTracker?.close(); faceTracker?.close();
});
