/**
 * SkeletonViewer3D — composite of a NATIVE video (expo-av) on top + a
 * WebView containing the Three.js skeleton on the bottom.
 *
 * Why native video instead of an HTMLMediaElement inside the WebView:
 * iOS WebKit's HTMLVideoElement has a known cold-play "zombie state"
 * where the engine reports playing internally (currentTime advances) but
 * the renderer pipeline never wakes up — so the displayed frame stays
 * frozen even though the element thinks it's playing. The user-side
 * workaround was scrubbing or pause/play cycling; both of those happen
 * to fire a real seeked event that wakes WebKit's renderer. Native
 * AVPlayer (via expo-av) doesn't have that issue at all, so we lift the
 * video out of the WebView entirely.
 *
 * Sync model:
 *   - Video is the master clock. expo-av reports positionMillis on each
 *     status update; we forward that into the WebView as setFrame(n).
 *   - The skeleton WebView no longer has its own playback timer; it
 *     just renders whatever frame setFrame() last set.
 *   - When paused (scrubbing), React calls setPositionAsync on the
 *     video AND injects setFrame(n) into the WebView so both are kept
 *     in lockstep.
 */

import React, {
  useRef,
  useMemo,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';

interface SkeletonViewer3DProps {
  c3dData: {
    positions: number[];
    rotations: number[];
    frameCount: number;
    segmentCount: number;
    frameRate: number;
  } | null;
  videoUrl: string | null;
  currentFrame: number;
  isPlaying: boolean;
  playSpeed: number;
  height?: number;
  onReady?: () => void;
  onFrameUpdate?: (frame: number) => void;
  onPlaybackEnd?: () => void;
}

const SkeletonViewer3D = forwardRef<any, SkeletonViewer3DProps>(
  (
    {
      c3dData,
      videoUrl,
      currentFrame,
      isPlaying,
      playSpeed,
      height = 600,
      onReady,
      onFrameUpdate,
      onPlaybackEnd,
    },
    ref,
  ) => {
    const webViewRef = useRef<WebView>(null);
    const videoRef = useRef<Video>(null);
    const isReadyRef = useRef(false);
    const dataSentRef = useRef(false);
    const skeletonReadyCalledRef = useRef(false);
    const videoReadyRef = useRef(false);

    // Frame the video has been seeked / advanced to, expressed as a
    // frame index. Used to skip redundant injectJavaScript calls.
    const lastInjectedFrameRef = useRef<number>(-1);

    useImperativeHandle(ref, () => ({
      sendCommand: (cmd: string) => {
        if (isReadyRef.current && webViewRef.current) {
          webViewRef.current.injectJavaScript(`${cmd}; true;`);
        }
      },
    }));

    const frameRate = c3dData?.frameRate ?? 360;

    // ────────────────────────────────────────────────────────────────
    // Skeleton (WebView) lifecycle
    // ────────────────────────────────────────────────────────────────

    // Send the C3D data once the WebView is ready.
    useEffect(() => {
      if (
        isReadyRef.current &&
        c3dData &&
        !dataSentRef.current &&
        webViewRef.current
      ) {
        dataSentRef.current = true;
        const msg = JSON.stringify({
          type: 'c3d',
          positions: c3dData.positions,
          rotations: c3dData.rotations,
          frameCount: c3dData.frameCount,
          segmentCount: c3dData.segmentCount,
          frameRate: c3dData.frameRate,
        });
        webViewRef.current.postMessage(msg);
      }
    }, [c3dData]);

    // Push a setFrame to the WebView. Cheap no-op if same as last call.
    const pushFrameToSkeleton = useCallback(
      (frame: number) => {
        const f = Math.round(frame);
        if (f === lastInjectedFrameRef.current) return;
        if (!isReadyRef.current || !webViewRef.current) return;
        lastInjectedFrameRef.current = f;
        webViewRef.current.injectJavaScript(`setFrame(${f}); true;`);
      },
      [],
    );

    // ────────────────────────────────────────────────────────────────
    // Video (native, expo-av) lifecycle
    // ────────────────────────────────────────────────────────────────

    // Play / pause the native video when isPlaying flips.
    useEffect(() => {
      const v = videoRef.current;
      if (!v || !videoUrl) return;
      if (isPlaying) {
        v.playAsync().catch(() => {});
      } else {
        v.pauseAsync().catch(() => {});
      }
    }, [isPlaying, videoUrl]);

    // Apply playback rate (expo-av needs an explicit setRateAsync call).
    // shouldCorrectPitch=false so a 0.25x rate doesn't pitch-shift audio
    // (the videos are typically muted but this is safer either way).
    useEffect(() => {
      const v = videoRef.current;
      if (!v || !videoUrl) return;
      v.setRateAsync(playSpeed, false).catch(() => {});
    }, [playSpeed, videoUrl]);

    // Seek when scrubbing (only when paused — during playback the video
    // is the clock and we don't want to keep yanking it).
    useEffect(() => {
      const v = videoRef.current;
      if (!v || !videoUrl || isPlaying || !c3dData) return;
      const ms = (currentFrame / frameRate) * 1000;
      v.setPositionAsync(ms, {
        toleranceMillisBefore: 0,
        toleranceMillisAfter: 0,
      }).catch(() => {});
      pushFrameToSkeleton(currentFrame);
    }, [currentFrame, isPlaying, videoUrl, c3dData, frameRate, pushFrameToSkeleton]);

    // Status updates while playing — forward the current position into
    // the skeleton + report it back to the parent (for the scrubber).
    const handleStatus = useCallback(
      (status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;

        // Mark the video as "first-frame ready" once expo-av reports it
        // loaded. We combine this with the skeleton-ready signal to
        // call onReady exactly once.
        if (!videoReadyRef.current) {
          videoReadyRef.current = true;
          maybeFireReady();
        }

        if (status.didJustFinish) {
          onPlaybackEnd?.();
          return;
        }

        const frame = (status.positionMillis / 1000) * frameRate;
        pushFrameToSkeleton(frame);
        if (status.isPlaying) {
          onFrameUpdate?.(Math.round(frame));
        }
      },
      [frameRate, onPlaybackEnd, onFrameUpdate, pushFrameToSkeleton],
    );

    // We treat the viewer as "ready" once BOTH the WebView signals it
    // and the video has reported a loaded status. If videoUrl is null
    // we just wait for the WebView.
    const maybeFireReady = useCallback(() => {
      if (skeletonReadyCalledRef.current) return;
      const skeletonReady = isReadyRef.current;
      const videoReady = !videoUrl || videoReadyRef.current;
      if (skeletonReady && videoReady) {
        skeletonReadyCalledRef.current = true;
        onReady?.();
      }
    }, [videoUrl, onReady]);

    // ────────────────────────────────────────────────────────────────
    // HTML for the skeleton WebView (no <video> anymore)
    // ────────────────────────────────────────────────────────────────

    const html = useMemo(() => buildHTML(), []);

    return (
      <View style={[styles.container, { height }]}>
        {/* Native video — top 40% of the viewer */}
        <View style={styles.videoWrap}>
          {videoUrl ? (
            <Video
              ref={videoRef}
              source={{ uri: videoUrl }}
              style={styles.video}
              rate={playSpeed}
              shouldPlay={false}
              resizeMode={ResizeMode.CONTAIN}
              isMuted
              progressUpdateIntervalMillis={16}
              onPlaybackStatusUpdate={handleStatus}
              useNativeControls={false}
            />
          ) : null}
        </View>

        {/* Skeleton WebView — bottom 60% */}
        <View style={styles.skeletonWrap}>
          <WebView
            ref={webViewRef}
            source={{ html }}
            scrollEnabled={false}
            bounces={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            originWhitelist={['*']}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            onMessage={(event) => {
              try {
                const data = JSON.parse(event.nativeEvent.data);
                if (data.type === 'ready') {
                  isReadyRef.current = true;
                  if (c3dData && !dataSentRef.current) {
                    dataSentRef.current = true;
                    webViewRef.current?.postMessage(
                      JSON.stringify({
                        type: 'c3d',
                        positions: c3dData.positions,
                        rotations: c3dData.rotations,
                        frameCount: c3dData.frameCount,
                        segmentCount: c3dData.segmentCount,
                        frameRate: c3dData.frameRate,
                      }),
                    );
                  }
                  maybeFireReady();
                }
              } catch {}
            }}
            style={styles.webview}
          />
        </View>
      </View>
    );
  },
);

SkeletonViewer3D.displayName = 'SkeletonViewer3D';
export default SkeletonViewer3D;

// ────────────────────────────────────────────────────────────────────
// Skeleton WebView HTML — Three.js only, no video element. Driven by
// setFrame(n) from React Native; the animate loop renders Three.js
// continuously so OrbitControls stays smooth, but it doesn't have its
// own playback clock anymore.
// ────────────────────────────────────────────────────────────────────

function buildHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a0a; }
  #skeleton-container { width: 100%; height: 100%; position: relative; }
  canvas { display: block; width: 100%; height: 100%; }
  #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    color: rgba(155,221,255,0.4); font-family: sans-serif; font-size: 12px; z-index: 10; }
</style>
</head>
<body>
<div id="skeleton-container">
  <div id="loading">Loading skeleton...</div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js"></script>
<script>
(function() {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────
  var SEGMENT_INDICES = {
    worldbody:0, head:1, torso:2, l_uarm:3, l_larm:4, l_hand:5,
    r_uarm:6, r_larm:7, r_hand:8, pelvis:9,
    l_thigh:10, l_shank:11, l_foot:12, l_toes:13,
    r_thigh:14, r_shank:15, r_foot:16, r_toes:17
  };

  var RENDERABLE = [
    'head','torso','pelvis',
    'l_uarm','l_larm','l_hand','r_uarm','r_larm','r_hand',
    'l_thigh','l_shank','l_foot','r_thigh','r_shank','r_foot'
  ];

  var BONES = [
    ['head','torso'], ['torso','pelvis'],
    ['torso','l_uarm'], ['l_uarm','l_larm'], ['l_larm','l_hand'],
    ['torso','r_uarm'], ['r_uarm','r_larm'], ['r_larm','r_hand'],
    ['pelvis','l_thigh'], ['l_thigh','l_shank'], ['l_shank','l_foot'],
    ['pelvis','r_thigh'], ['r_thigh','r_shank'], ['r_shank','r_foot']
  ];

  var MESH_MAP = {
    head:{file:'head.obj'}, torso:{file:'thorax.obj'}, pelvis:{file:'pelvis.obj'},
    r_uarm:{file:'right-arm.obj'}, r_larm:{file:'right-forearm.obj'}, r_hand:{file:'right-hand.obj'},
    r_thigh:{file:'right-thigh.obj'}, r_shank:{file:'right-leg.obj'}, r_foot:{file:'right-foot.obj'},
    l_uarm:{file:'right-arm.obj',mirror:true}, l_larm:{file:'right-forearm.obj',mirror:true},
    l_hand:{file:'right-hand.obj',mirror:true}, l_thigh:{file:'right-thigh.obj',mirror:true},
    l_shank:{file:'right-leg.obj',mirror:true}, l_foot:{file:'right-foot.obj',mirror:true}
  };

  var MESH_SIZE = {
    head:0.23, torso:0.48, pelvis:0.30,
    r_uarm:0.30, r_larm:0.27, r_hand:0.10,
    r_thigh:0.42, r_shank:0.44, r_foot:0.26,
    l_uarm:0.30, l_larm:0.27, l_hand:0.10,
    l_thigh:0.42, l_shank:0.44, l_foot:0.26
  };

  var PI = Math.PI;
  var PRE_ROT = {
    head:[0,PI,0], torso:[0,PI,0], pelvis:[0,PI,0],
    r_uarm:[0,0,0], r_larm:[0,0,0], r_hand:[0,PI,0],
    r_thigh:[0,PI,0], r_shank:[0,0,0], r_foot:[0,PI,0],
    l_uarm:[0,0,0], l_larm:[0,0,0], l_hand:[0,PI,0],
    l_thigh:[0,PI,0], l_shank:[0,0,0], l_foot:[0,PI,0]
  };

  var MESH_OFFSET = { head: [0, 0.08, -0.07] };
  var MESH_URL_BASE = 'https://aspboostapp.vercel.app/meshes/';

  // ─── Three.js scene setup ──────────────────────────────────────
  var container = document.getElementById('skeleton-container');
  var scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0a0a');

  var camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 100);
  // Default view rotated 180° around pelvis so we look at a right-handed
  // pitcher from the front rather than the back, and pulled 20% closer
  // (offset from target scaled by 0.8). OrbitControls let the user spin
  // and zoom freely from there.
  camera.position.set(-1.6, 1.4, -2.4);

  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 8;
  controls.target.set(0, 1, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 5, 2);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(10, 20, 0x333333, 0x222222));

  // Materials — meshes are body-tone PBR with a subtle cyan emissive
  // glow; joints are bright cyan markers; bones are muted gray rods.
  var meshMat = new THREE.MeshStandardMaterial({
    color: 0xd8d8d8, roughness: 0.55, metalness: 0.1,
    emissive: new THREE.Color(0x9bddff), emissiveIntensity: 0.04, side: THREE.DoubleSide
  });
  var meshMatMirror = new THREE.MeshStandardMaterial({
    color: 0xd8d8d8, roughness: 0.55, metalness: 0.1,
    emissive: new THREE.Color(0x9bddff), emissiveIntensity: 0.04, side: THREE.FrontSide
  });
  var jointMat = new THREE.MeshStandardMaterial({
    color: 0x9bddff, emissive: new THREE.Color(0x9bddff),
    emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.2
  });
  var boneMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.7, metalness: 0.05 });

  var jointGeo = new THREE.SphereGeometry(0.012, 10, 6);
  var boneGeo = new THREE.CylinderGeometry(0.005, 0.005, 2, 6);

  var joints = {}, segGroups = {}, boneObjs = {};

  RENDERABLE.forEach(function(name) {
    var joint = new THREE.Mesh(jointGeo, jointMat);
    scene.add(joint); joints[name] = joint;
    var group = new THREE.Group();
    scene.add(group); segGroups[name] = group;
  });

  BONES.forEach(function(pair) {
    var bone = new THREE.Mesh(boneGeo, boneMat);
    scene.add(bone); boneObjs[pair[0] + '-' + pair[1]] = bone;
  });

  // ─── Mesh loading ──────────────────────────────────────────────
  var loader = new THREE.OBJLoader();
  var loadedGeos = {}, loadedSizes = {};
  var uniqueFiles = [], seen = {};
  Object.keys(MESH_MAP).forEach(function(k) {
    var f = MESH_MAP[k].file;
    if (!seen[f]) { seen[f] = true; uniqueFiles.push(f); }
  });

  var meshLoadCount = 0;
  uniqueFiles.forEach(function(file) {
    loader.load(MESH_URL_BASE + file, function(obj) {
      obj.traverse(function(child) {
        if (child.isMesh && !loadedGeos[file]) {
          var geo = child.geometry.clone();
          geo.computeVertexNormals(); geo.computeBoundingBox();
          var size = new THREE.Vector3(); geo.boundingBox.getSize(size);
          loadedGeos[file] = geo; loadedSizes[file] = size;
        }
      });
      meshLoadCount++;
      if (meshLoadCount === uniqueFiles.length) attachMeshes();
    }, undefined, function() {
      meshLoadCount++;
      if (meshLoadCount === uniqueFiles.length) attachMeshes();
    });
  });

  function attachMeshes() {
    RENDERABLE.forEach(function(segName) {
      var info = MESH_MAP[segName]; if (!info) return;
      var geo = loadedGeos[info.file], bboxSize = loadedSizes[info.file];
      if (!geo || !bboxSize) return;
      var segLen = MESH_SIZE[segName] || 0.2;
      var maxDim = Math.max(bboxSize.x, bboxSize.y, bboxSize.z);
      var sf = maxDim > 0 ? segLen / maxDim : 1;
      var sx = info.mirror ? -sf : sf;
      var preRot = PRE_ROT[segName] || [0,0,0];
      var offset = MESH_OFFSET[segName] || null;
      var preGroup = new THREE.Group();
      preGroup.rotation.set(preRot[0], preRot[1], preRot[2]);
      if (offset) preGroup.position.set(offset[0], offset[1], offset[2]);
      var mat = info.mirror ? meshMatMirror : meshMat;
      var mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(sx, sf, sf);
      preGroup.add(mesh);
      segGroups[segName].add(preGroup);
    });
    document.getElementById('loading').style.display = 'none';
  }

  // ─── State ─────────────────────────────────────────────────────
  var c3d = null;
  var curFrame = 0;
  var pelvisTarget = new THREE.Vector3(0, 1, 0);

  // ─── API called from React Native ─────────────────────────────
  // The video element is gone -- React drives playback natively now
  // and forwards frame updates here. setFrame is the only entry point
  // for changing what the skeleton displays.
  window.setFrame = function(f) {
    curFrame = f;
    updateSkeleton(f);
  };

  // Listen for C3D data from React Native
  function handleMessage(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.type === 'c3d') {
        c3d = {
          positions: new Float32Array(data.positions),
          rotations: new Float32Array(data.rotations),
          frameCount: data.frameCount,
          segmentCount: data.segmentCount
        };
        curFrame = 1;
        updateSkeleton(1);
      }
    } catch(err) {}
  }
  window.addEventListener('message', handleMessage);
  document.addEventListener('message', handleMessage);

  // ─── Update skeleton for a given frame ─────────────────────────
  function updateSkeleton(frame) {
    if (!c3d) return;
    frame = Math.min(Math.max(Math.round(frame), 0), c3d.frameCount - 1);
    var sc = c3d.segmentCount;

    for (var i = 0; i < RENDERABLE.length; i++) {
      var name = RENDERABLE[i];
      var segIdx = SEGMENT_INDICES[name];
      if (segIdx === undefined || segIdx >= sc) continue;

      var posI = (frame * sc + segIdx) * 3;
      var cx = c3d.positions[posI];
      var cy = c3d.positions[posI + 2];
      var cz = -c3d.positions[posI + 1];

      var joint = joints[name];
      if (joint) joint.position.set(cx, cy, cz);

      var group = segGroups[name];
      if (group) {
        group.position.set(cx, cy, cz);
        var rotI = (frame * sc + segIdx) * 9;
        var r = c3d.rotations;
        var m = new THREE.Matrix4();
        m.makeBasis(
          new THREE.Vector3(r[rotI+0], r[rotI+2], -r[rotI+1]),
          new THREE.Vector3(r[rotI+6], r[rotI+8], -r[rotI+7]),
          new THREE.Vector3(-r[rotI+3], -r[rotI+5], r[rotI+4])
        );
        group.quaternion.setFromRotationMatrix(m);
      }

      if (name === 'pelvis') {
        pelvisTarget.lerp(new THREE.Vector3(cx, cy, cz), 0.05);
      }
    }

    for (var b = 0; b < BONES.length; b++) {
      var pName = BONES[b][0], cName = BONES[b][1];
      var bone = boneObjs[pName + '-' + cName];
      var pJ = joints[pName], cJ = joints[cName];
      if (!bone || !pJ || !cJ) continue;
      bone.position.lerpVectors(pJ.position, cJ.position, 0.5);
      var dir = new THREE.Vector3().subVectors(cJ.position, pJ.position);
      var len = dir.length();
      if (len < 0.001) continue;
      bone.scale.set(1, len / 2, 1);
      bone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.normalize());
    }

    controls.target.lerp(pelvisTarget, 0.03);
  }

  // ─── Animation Loop ────────────────────────────────────────────
  // Just keeps the Three.js scene rendering smoothly so OrbitControls
  // is responsive. setFrame() is what actually moves the skeleton --
  // animate() never reads any clock now. Decoupling means the skeleton
  // responds immediately to frame updates from native side without
  // depending on its own timing.
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function resizeRenderer() {
    var w = container.clientWidth, h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  }

  window.addEventListener('resize', resizeRenderer);
  setTimeout(resizeRenderer, 100);
  setTimeout(resizeRenderer, 500);

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
})();
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
    flexDirection: 'column',
  },
  videoWrap: {
    width: '100%',
    height: '40%',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  skeletonWrap: {
    width: '100%',
    height: '60%',
    backgroundColor: '#0a0a0a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
