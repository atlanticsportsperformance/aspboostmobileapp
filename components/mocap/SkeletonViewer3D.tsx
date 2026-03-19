import React, { useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

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
  ({ c3dData, videoUrl, currentFrame, isPlaying, playSpeed, height = 600, onReady, onFrameUpdate, onPlaybackEnd }, ref) => {
    const webViewRef = useRef<WebView>(null);
    const isReadyRef = useRef(false);
    const dataSentRef = useRef(false);

    useImperativeHandle(ref, () => ({
      sendCommand: (cmd: string) => {
        if (isReadyRef.current && webViewRef.current) {
          webViewRef.current.injectJavaScript(`${cmd}; true;`);
        }
      },
    }));

    // Send C3D data once ready
    useEffect(() => {
      if (isReadyRef.current && c3dData && !dataSentRef.current && webViewRef.current) {
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

    // Send video URL
    useEffect(() => {
      if (isReadyRef.current && videoUrl && webViewRef.current) {
        webViewRef.current.injectJavaScript(`loadVideo(${JSON.stringify(videoUrl)}); true;`);
      }
    }, [videoUrl]);

    // Send frame updates when paused (scrubbing)
    useEffect(() => {
      if (isReadyRef.current && webViewRef.current && !isPlaying) {
        webViewRef.current.injectJavaScript(`setFrame(${Math.round(currentFrame)}); true;`);
      }
    }, [currentFrame, isPlaying]);

    // Play/pause
    useEffect(() => {
      if (!isReadyRef.current || !webViewRef.current) return;
      if (isPlaying) {
        webViewRef.current.injectJavaScript(`startPlayback(${playSpeed}, ${Math.round(currentFrame)}); true;`);
      } else {
        webViewRef.current.injectJavaScript(`stopPlayback(); true;`);
      }
    }, [isPlaying, playSpeed]);

    const html = useMemo(() => buildHTML(), []);

    return (
      <View style={[styles.container, { height }]}>
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
                  webViewRef.current?.postMessage(JSON.stringify({
                    type: 'c3d',
                    positions: c3dData.positions,
                    rotations: c3dData.rotations,
                    frameCount: c3dData.frameCount,
                    segmentCount: c3dData.segmentCount,
                    frameRate: c3dData.frameRate,
                  }));
                }
                if (videoUrl) {
                  webViewRef.current?.injectJavaScript(`loadVideo(${JSON.stringify(videoUrl)}); true;`);
                }
                onReady?.();
              } else if (data.type === 'frame') {
                onFrameUpdate?.(data.frame);
              } else if (data.type === 'ended') {
                onPlaybackEnd?.();
              }
            } catch (e) {}
          }}
          style={styles.webview}
        />
      </View>
    );
  }
);

SkeletonViewer3D.displayName = 'SkeletonViewer3D';
export default SkeletonViewer3D;

function buildHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a0a; }
  #video-container { width: 100%; height: 40%; background: #000; position: relative; }
  #video { width: 100%; height: 100%; object-fit: contain; background: #000; }
  #skeleton-container { width: 100%; height: 60%; position: relative; }
  canvas { display: block; width: 100%; height: 100%; }
  #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    color: rgba(155,221,255,0.4); font-family: sans-serif; font-size: 12px; z-index: 10; }
</style>
</head>
<body>
<div id="video-container">
  <video id="video" playsinline muted preload="auto"></video>
</div>
<div id="skeleton-container">
  <div id="loading">Loading skeleton...</div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js"></script>
<script>
(function() {
  'use strict';

  var video = document.getElementById('video');

  // ─── Constants ─────────────────────────────────────────────────
  var SEGMENT_INDICES = {
    worldbody:0, head:1, torso:2, l_uarm:3, l_larm:4, l_hand:5,
    r_uarm:6, r_larm:7, r_hand:8, pelvis:9,
    l_thigh:10, l_shank:11, l_foot:12, l_toes:13,
    r_thigh:14, r_shank:15, r_foot:16, r_toes:17, pelvis_shifted:18
  };

  var RENDERABLE = [
    'head','torso','pelvis',
    'r_uarm','r_larm','r_hand',
    'l_uarm','l_larm','l_hand',
    'r_thigh','r_shank','r_foot',
    'l_thigh','l_shank','l_foot'
  ];

  var BONES = [
    ['pelvis','torso'],['torso','head'],
    ['torso','r_uarm'],['r_uarm','r_larm'],['r_larm','r_hand'],
    ['torso','l_uarm'],['l_uarm','l_larm'],['l_larm','l_hand'],
    ['pelvis','r_thigh'],['r_thigh','r_shank'],['r_shank','r_foot'],
    ['pelvis','l_thigh'],['l_thigh','l_shank'],['l_shank','l_foot']
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

  // ─── Scene Setup ───────────────────────────────────────────────
  var container = document.getElementById('skeleton-container');
  var scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0a0a');

  var camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 100);
  camera.position.set(2, 1.5, 3);

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

  // Materials
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

  // Load OBJ meshes
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
  var playing = false;
  var speed = 0.25;
  var frameRate = 360;
  var lastFrameTime = 0;
  var pelvisTarget = new THREE.Vector3(0, 1, 0);

  // ─── API called from React Native ─────────────────────────────

  window.loadVideo = function(url) {
    video.src = url;
    video.load();
  };

  window.setFrame = function(f) {
    curFrame = f;
    if (c3d) {
      // Sync video to this exact frame — synchronous in WebView
      var targetTime = f / frameRate;
      if (Math.abs(video.currentTime - targetTime) > 0.02) {
        video.currentTime = targetTime;
      }
    }
    updateSkeleton(f);
    renderer.render(scene, camera);
  };

  window.startPlayback = function(spd, fromFrame) {
    speed = spd;
    curFrame = fromFrame;
    playing = true;
    video.playbackRate = spd;
    var targetTime = fromFrame / frameRate;
    video.currentTime = targetTime;
    video.play().catch(function(){});
    lastFrameTime = performance.now();
  };

  window.stopPlayback = function() {
    playing = false;
    video.pause();
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
        frameRate = data.frameRate || 360;
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
  var frameReportCounter = 0;
  var lastDriftCorrection = 0;

  function animate() {
    requestAnimationFrame(animate);

    if (playing && c3d) {
      // Use video as the master clock — read its current time and derive the C3D frame
      // This keeps them perfectly in sync without ever setting video.currentTime during playback
      var videoTime = video.currentTime;
      curFrame = videoTime * frameRate;

      if (curFrame >= c3d.frameCount) {
        curFrame = c3d.frameCount - 1;
        playing = false;
        video.pause();
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ended' }));
      }

      updateSkeleton(curFrame);

      // Report frame back to RN every 3 frames for scrubber update
      frameReportCounter++;
      if (frameReportCounter % 3 === 0) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'frame', frame: Math.round(curFrame) }));
      }
    }

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

  // Resize after layout settles — fixes initial crushed render
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
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
