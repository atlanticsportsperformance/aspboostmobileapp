import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { WebView } from 'react-native-webview';

interface HitTraxSwing {
  poi_x: number | null;
  poi_y: number | null;
  poi_z: number | null;
  strike_zone_bottom: number | null;
  strike_zone_top: number | null;
  strike_zone_width: number | null;
  exit_velocity: number;
  launch_angle: number | null;
}

interface ContactPoint3DProps {
  hittraxSwings: HitTraxSwing[];
}

const INCH_TO_METER = 0.0254;

export default function ContactPoint3D({ hittraxSwings }: ContactPoint3DProps) {
  const [showInfoModal, setShowInfoModal] = useState(false);

  // Calculate contact points
  const contactPoints = useMemo(() => {
    return hittraxSwings
      .filter(swing => {
        if (swing.poi_x === null || swing.poi_y === null || swing.poi_z === null) return false;
        if (isNaN(swing.poi_x) || isNaN(swing.poi_y) || isNaN(swing.poi_z)) return false;
        return true;
      })
      .map(swing => ({
        x: swing.poi_x! * INCH_TO_METER,
        y: swing.poi_y! * INCH_TO_METER,
        z: -(swing.poi_z! * INCH_TO_METER),
        exitVelocity: swing.exit_velocity,
      }));
  }, [hittraxSwings]);

  // Calculate average contact distance
  const avgContactDistance = useMemo(() => {
    const validSwings = hittraxSwings.filter(
      swing => swing.poi_z !== null && !isNaN(swing.poi_z)
    );
    if (validSwings.length === 0) return 0;
    const totalDistance = validSwings.reduce((sum, swing) => sum + swing.poi_z!, 0);
    return totalDistance / validSwings.length;
  }, [hittraxSwings]);

  // Get strike zone dimensions
  const strikeZone = useMemo(() => {
    const validSwing = hittraxSwings.find(
      s => s.strike_zone_bottom !== null && s.strike_zone_top !== null && s.strike_zone_width !== null
    );
    if (!validSwing) return null;
    return {
      bottom: validSwing.strike_zone_bottom!,
      top: validSwing.strike_zone_top!,
      width: validSwing.strike_zone_width!,
    };
  }, [hittraxSwings]);

  // Calculate 9-pocket grid
  const ninePocketGrid = useMemo(() => {
    const validSwings = hittraxSwings.filter(
      swing => swing.poi_x !== null && swing.poi_y !== null && swing.exit_velocity > 0 &&
               swing.strike_zone_bottom !== null && swing.strike_zone_top !== null &&
               swing.strike_zone_width !== null
    );

    if (validSwings.length === 0 || !strikeZone) {
      return Array(9).fill(null);
    }

    const grid = Array(9).fill(null).map(() => ({ total: 0, count: 0 }));

    validSwings.forEach(swing => {
      const szWidth = swing.strike_zone_width!;
      const szHeight = swing.strike_zone_top! - swing.strike_zone_bottom!;
      const szBottom = swing.strike_zone_bottom!;

      const relativeX = swing.poi_x! + (szWidth / 2);
      const relativeY = swing.poi_y! - szBottom;

      const col = Math.floor((relativeX / szWidth) * 3);
      const row = 2 - Math.floor((relativeY / szHeight) * 3);

      const gridCol = Math.max(0, Math.min(2, col));
      const gridRow = Math.max(0, Math.min(2, row));
      const gridIdx = gridRow * 3 + gridCol;

      grid[gridIdx].total += swing.exit_velocity;
      grid[gridIdx].count += 1;
    });

    return grid.map(cell => cell.count > 0 ? Math.round(cell.total / cell.count) : null);
  }, [hittraxSwings, strikeZone]);

  // Generate HTML with Three.js
  const html = useMemo(() => {
    const szData = strikeZone ? JSON.stringify(strikeZone) : 'null';
    const pointsData = JSON.stringify(contactPoints);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; touch-action: none; }
    #container { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="container"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
  <script>
    const INCH_TO_METER = 0.0254;
    const strikeZone = ${szData};
    const contactPoints = ${pointsData};

    // Setup
    const container = document.getElementById('container');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 100);
    camera.position.set(-1.5, 1.5, 1.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // OrbitControls - this is the real deal
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 5;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0.35, 0);
    controls.update();

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);
    const pointLight1 = new THREE.PointLight(0xffffff, 0.6);
    pointLight1.position.set(-5, 5, -5);
    scene.add(pointLight1);
    const pointLight2 = new THREE.PointLight(0x60a5fa, 0.4);
    pointLight2.position.set(0, 3, -2);
    scene.add(pointLight2);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(3, 3);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Grid
    const grid = new THREE.GridHelper(2.5, 25, 0x444444, 0x1a1a1a);
    scene.add(grid);

    // Home plate
    const plateWidth = 17 * INCH_TO_METER;
    const plateDepth = 17 * INCH_TO_METER;
    const plateShape = new THREE.Shape();
    plateShape.moveTo(-plateWidth / 2, 0);
    plateShape.lineTo(plateWidth / 2, 0);
    plateShape.lineTo(plateWidth / 2, -plateDepth * 0.6);
    plateShape.lineTo(0, -plateDepth);
    plateShape.lineTo(-plateWidth / 2, -plateDepth * 0.6);
    plateShape.lineTo(-plateWidth / 2, 0);
    const plateGeo = new THREE.ShapeGeometry(plateShape);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0, 0.001, -plateDepth);
    scene.add(plate);

    // Strike zone
    if (strikeZone) {
      const zoneWidth = strikeZone.width * INCH_TO_METER;
      const zoneHeight = (strikeZone.top - strikeZone.bottom) * INCH_TO_METER;
      const zoneBottom = strikeZone.bottom * INCH_TO_METER;
      const depth = 17 * INCH_TO_METER;

      const zoneShape = new THREE.Shape();
      zoneShape.moveTo(-zoneWidth / 2, 0);
      zoneShape.lineTo(zoneWidth / 2, 0);
      zoneShape.lineTo(zoneWidth / 2, -depth * 0.6);
      zoneShape.lineTo(0, -depth);
      zoneShape.lineTo(-zoneWidth / 2, -depth * 0.6);
      zoneShape.lineTo(-zoneWidth / 2, 0);

      const extrudeSettings = { steps: 1, depth: zoneHeight, bevelEnabled: false };
      const zoneGeo = new THREE.ExtrudeGeometry(zoneShape, extrudeSettings);
      const zoneMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
      });
      const zone = new THREE.Mesh(zoneGeo, zoneMat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(0, zoneBottom, -depth);
      scene.add(zone);
    }

    // Reference point
    const refGeo = new THREE.SphereGeometry(0.015, 16, 16);
    const refMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.8 });
    const refPoint = new THREE.Mesh(refGeo, refMat);
    refPoint.position.set(0, 0.005, 0);
    scene.add(refPoint);

    // Contact points
    contactPoints.forEach(point => {
      const color = point.exitVelocity >= 100 ? 0x10b981 :
                    point.exitVelocity >= 90 ? 0x3b82f6 :
                    point.exitVelocity >= 80 ? 0xf59e0b : 0xef4444;

      const sphereGeo = new THREE.SphereGeometry(0.03, 16, 16);
      const sphereMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(point.x, point.y, point.z);
      scene.add(sphere);
    });

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Handle resize
    window.addEventListener('resize', () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
  </script>
</body>
</html>
`;
  }, [contactPoints, strikeZone]);

  if (contactPoints.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No contact point data available for this session</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Contact Point 3D</Text>
      <Text style={styles.description}>
        Drag to rotate • Pinch to zoom • Two fingers to pan
      </Text>

      <View style={styles.webviewContainer}>
        <WebView
          source={{ html }}
          style={styles.webview}
          scrollEnabled={false}
          bounces={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={['*']}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
        />

        {/* Stats overlay */}
        <View style={styles.statsOverlay} pointerEvents="none">
          <Text style={styles.statsValue}>{avgContactDistance.toFixed(1)}"</Text>
          <Text style={styles.statsLabel}>Avg Distance</Text>
        </View>

        {/* Info button */}
        <TouchableOpacity style={styles.infoButton} onPress={() => setShowInfoModal(true)}>
          <Text style={styles.infoButtonText}>i</Text>
        </TouchableOpacity>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
          <Text style={styles.legendText}>&lt;80</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
          <Text style={styles.legendText}>80-89</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
          <Text style={styles.legendText}>90-99</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
          <Text style={styles.legendText}>100+</Text>
        </View>
      </View>

      {/* Info Modal */}
      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowInfoModal(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Contact Point Analysis</Text>
              <TouchableOpacity onPress={() => setShowInfoModal(false)}>
                <Text style={styles.modalCloseX}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Contact Distance Analysis */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Contact Distance from Home Plate</Text>
              <View style={styles.modalCard}>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Your Average:</Text>
                  <Text style={styles.modalValueLarge}>{avgContactDistance.toFixed(1)}"</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>MLB Average:</Text>
                  <Text style={[styles.modalValue, { color: '#3b82f6' }]}>20.0"</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>MLB Range:</Text>
                  <Text style={styles.modalValue}>17-23" (±3" std dev)</Text>
                </View>

                {/* Performance indicator */}
                <View style={styles.performanceIndicator}>
                  {avgContactDistance >= 17 && avgContactDistance <= 23 ? (
                    <>
                      <View style={[styles.indicatorDot, { backgroundColor: 'rgba(16,185,129,0.2)' }]}>
                        <Text style={{ color: '#10b981' }}>✓</Text>
                      </View>
                      <Text style={styles.indicatorText}>
                        Your contact point extension is within MLB range. Good extension and barrel control.
                      </Text>
                    </>
                  ) : avgContactDistance < 17 ? (
                    <>
                      <View style={[styles.indicatorDot, { backgroundColor: 'rgba(245,158,11,0.2)' }]}>
                        <Text style={{ color: '#f59e0b' }}>!</Text>
                      </View>
                      <Text style={styles.indicatorText}>
                        Contact point is closer to your body. May indicate getting jammed or not extending through the zone.
                      </Text>
                    </>
                  ) : (
                    <>
                      <View style={[styles.indicatorDot, { backgroundColor: 'rgba(59,130,246,0.2)' }]}>
                        <Text style={{ color: '#3b82f6' }}>i</Text>
                      </View>
                      <Text style={styles.indicatorText}>
                        Contact point is over-extended. May indicate reaching for pitches or casting the bat.
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </View>

            {/* 9-Pocket Grid */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Average Exit Velocity by Location</Text>
              <View style={styles.nineGrid}>
                {ninePocketGrid.map((ev, idx) => {
                  let bgColor = 'rgba(0,0,0,0.4)';
                  let borderColor = 'rgba(255,255,255,0.1)';
                  let textColor = '#fff';

                  if (ev !== null) {
                    if (ev >= 100) {
                      bgColor = 'rgba(16,185,129,0.3)';
                      borderColor = 'rgba(16,185,129,0.5)';
                      textColor = '#4ade80';
                    } else if (ev >= 90) {
                      bgColor = 'rgba(59,130,246,0.3)';
                      borderColor = 'rgba(59,130,246,0.5)';
                      textColor = '#60a5fa';
                    } else if (ev >= 80) {
                      bgColor = 'rgba(245,158,11,0.3)';
                      borderColor = 'rgba(245,158,11,0.5)';
                      textColor = '#fbbf24';
                    } else {
                      bgColor = 'rgba(239,68,68,0.3)';
                      borderColor = 'rgba(239,68,68,0.5)';
                      textColor = '#f87171';
                    }
                  }

                  return (
                    <View key={idx} style={[styles.gridCell, { backgroundColor: bgColor, borderColor }]}>
                      {ev !== null ? (
                        <>
                          <Text style={[styles.gridCellValue, { color: textColor }]}>{ev}</Text>
                          <Text style={styles.gridCellUnit}>mph</Text>
                        </>
                      ) : (
                        <Text style={styles.gridCellEmpty}>-</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={styles.gridCaption}>Strike zone divided into 3x3 grid (top to bottom, left to right)</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  description: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  webviewContainer: {
    width: '100%',
    height: 320,
    backgroundColor: '#000000',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  statsOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  statsValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  statsLabel: {
    fontSize: 9,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoButton: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 28,
    height: 28,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoButtonText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  emptyState: {
    height: 320,
    backgroundColor: '#000000',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: '#6B7280',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    maxWidth: 400,
    width: '100%',
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  modalCloseX: {
    fontSize: 20,
    color: '#9CA3AF',
  },
  modalSection: {
    padding: 16,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  modalCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalLabel: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  modalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  modalValueLarge: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  performanceIndicator: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: 8,
  },
  indicatorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicatorText: {
    flex: 1,
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 18,
  },
  nineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    maxWidth: 240,
    alignSelf: 'center',
  },
  gridCell: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridCellValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  gridCellUnit: {
    fontSize: 8,
    color: '#6B7280',
  },
  gridCellEmpty: {
    fontSize: 14,
    color: '#4B5563',
  },
  gridCaption: {
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 12,
  },
});
