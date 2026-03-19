/**
 * Theia3D C3D Parser
 *
 * Reads 4x4 transformation matrices from Theia3D C3D files.
 * Ported from testbiomech/extract_biomechanics.py.
 *
 * C3D stores rotation data in row-vector convention:
 *   - Upper-left 3x3 = R^T (must transpose to get R)
 *   - Last row [0:3] = translation (meters, global frame)
 *   - 17 floats per segment per frame (16 matrix + 1 residual)
 */

export interface C3DData {
  frameCount: number
  frameRate: number
  segmentCount: number
  segmentLabels: string[]
  /** Flat array: [frame][segment][x,y,z] → index = (frame * segmentCount + seg) * 3 */
  positions: Float32Array
  /** Flat array: [frame][segment][3x3 column-major] → index = (frame * segmentCount + seg) * 9 */
  rotations: Float32Array
}

/** Segment index map matching Theia3D output */
export const SEGMENT_INDICES: Record<string, number> = {
  worldbody: 0,
  head: 1,
  torso: 2,
  l_uarm: 3,
  l_larm: 4,
  l_hand: 5,
  r_uarm: 6,
  r_larm: 7,
  r_hand: 8,
  pelvis: 9,
  l_thigh: 10,
  l_shank: 11,
  l_foot: 12,
  l_toes: 13,
  r_thigh: 14,
  r_shank: 15,
  r_foot: 16,
  r_toes: 17,
  pelvis_shifted: 18,
}

export const SEGMENT_LABELS = Object.keys(SEGMENT_INDICES)

/**
 * Parse C3D parameter section to find ROTATION group parameters.
 * C3D parameter format: linked-list of group/parameter entries.
 */
function parseParameters(view: DataView, paramBlockStart: number): {
  dataStart: number
  used: number
  labels: string[]
  firstFrame: number
  lastFrame: number
  frameRate: number
} {
  // Read header values
  const firstFrame = view.getInt16(6, true)
  const lastFrame = view.getInt16(8, true)
  // Frame rate is at word 11-12 (byte offset 20), NOT word 6 (byte offset 10)
  const headerFrameRate = view.getFloat32(20, true)

  let offset = paramBlockStart + 4 // Skip 4-byte parameter header

  const groups: Record<number, string> = {}
  let rotationGroupId = 0
  let rotationRate = 0
  let dataStart = 0
  let used = 0
  const labels: string[] = []

  // Walk the parameter entries
  while (offset < view.byteLength - 2) {
    const nameLen = Math.abs(view.getInt8(offset))
    const groupId = view.getInt8(offset + 1)

    if (nameLen === 0) break // End of parameters

    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + offset + 2, nameLen)
    const name = String.fromCharCode(...nameBytes).trim().toUpperCase()

    if (groupId < 0) {
      // Group definition
      const absId = Math.abs(groupId)
      groups[absId] = name
      // Skip: nameLen + 2 bytes header + 2 bytes next offset
      const nextOffset = view.getInt16(offset + 2 + nameLen, true)
      // Description follows
      const descLen = view.getUint8(offset + 2 + nameLen + 2)
      if (name === 'ROTATION') {
        rotationGroupId = absId
      }
      offset += 2 + nameLen + 2 + 1 + descLen
      if (nextOffset === 0) break
    } else {
      // Parameter definition
      const nextOffset = view.getInt16(offset + 2 + nameLen, true)
      const dataType = view.getInt8(offset + 2 + nameLen + 2)
      const numDims = view.getUint8(offset + 2 + nameLen + 3)

      let dataOffset = offset + 2 + nameLen + 2 + 1 + 1 // after type and numDims
      const dims: number[] = []
      for (let d = 0; d < numDims; d++) {
        dims.push(view.getUint8(dataOffset + d))
      }
      dataOffset += numDims

      if (groupId === rotationGroupId) {
        if (name === 'DATA_START') {
          if (dataType === 2) { // int16
            dataStart = view.getInt16(dataOffset, true)
          } else if (dataType === 1) { // int8
            dataStart = view.getInt8(dataOffset)
          }
        } else if (name === 'USED') {
          if (dataType === 2) {
            used = view.getInt16(dataOffset, true)
          } else if (dataType === 1) {
            used = view.getInt8(dataOffset)
          }
        } else if (name === 'RATE') {
          if (dataType === 4) { // float32
            rotationRate = view.getFloat32(dataOffset, true)
          } else if (dataType === 2) { // int16
            rotationRate = view.getInt16(dataOffset, true)
          }
        } else if (name === 'LABELS') {
          if (dataType === -1 && dims.length === 2) { // character array
            const charLen = dims[0]
            const count = dims[1]
            for (let i = 0; i < count; i++) {
              const labelBytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset + i * charLen, charLen)
              const label = String.fromCharCode(...labelBytes).trim()
              labels.push(label)
            }
          }
        }
      }

      if (nextOffset === 0) break
      offset += 2 + nameLen + Math.abs(nextOffset)
    }
  }

  // Use ROTATION:RATE if available, fall back to header, then default 360
  const frameRate = rotationRate > 0 ? rotationRate : (headerFrameRate > 0 ? headerFrameRate : 360)
  return { dataStart, used, labels, firstFrame, lastFrame, frameRate }
}

/**
 * Parse a Theia3D C3D file from an ArrayBuffer.
 *
 * Returns positions and rotations for all segments across all frames.
 * Rotations are stored column-major (Three.js compatible) after transposing
 * from the C3D row-vector convention.
 */
export function parseC3D(buffer: ArrayBuffer): C3DData {
  const view = new DataView(buffer)

  // Byte 0: parameter block pointer (1-indexed block number, each block = 512 bytes)
  const paramBlockNum = view.getUint8(0)
  const paramBlockStart = (paramBlockNum - 1) * 512

  const params = parseParameters(view, paramBlockStart)

  if (params.dataStart === 0) {
    throw new Error('ROTATION:DATA_START not found in C3D file — not a Theia3D file?')
  }
  if (params.used === 0) {
    throw new Error('ROTATION:USED not found in C3D file')
  }

  const frameCount = params.lastFrame - params.firstFrame + 1
  const segmentCount = params.used
  const frameRate = params.frameRate
  const segmentLabels = params.labels.length > 0
    ? params.labels.map(l => l.replace('_4X4', '').toLowerCase())
    : SEGMENT_LABELS.slice(0, segmentCount)

  // Seek to rotation data
  const floatsPerRot = 17 // 16 matrix floats + 1 residual
  const floatsPerFrame = segmentCount * floatsPerRot
  const dataByteOffset = (params.dataStart - 1) * 512

  const positions = new Float32Array(frameCount * segmentCount * 3)
  const rotations = new Float32Array(frameCount * segmentCount * 9)

  for (let frame = 0; frame < frameCount; frame++) {
    for (let seg = 0; seg < segmentCount; seg++) {
      const floatIdx = (frame * floatsPerFrame + seg * floatsPerRot)
      const byteIdx = dataByteOffset + floatIdx * 4

      // Read 4x4 matrix (row-major in file)
      // m[row][col] = view.getFloat32(byteIdx + (row * 4 + col) * 4, true)
      const m00 = view.getFloat32(byteIdx + 0, true)
      const m01 = view.getFloat32(byteIdx + 4, true)
      const m02 = view.getFloat32(byteIdx + 8, true)
      // m03 = 0
      const m10 = view.getFloat32(byteIdx + 16, true)
      const m11 = view.getFloat32(byteIdx + 20, true)
      const m12 = view.getFloat32(byteIdx + 24, true)
      // m13 = 0
      const m20 = view.getFloat32(byteIdx + 32, true)
      const m21 = view.getFloat32(byteIdx + 36, true)
      const m22 = view.getFloat32(byteIdx + 40, true)
      // m23 = 0
      // Last row = translation
      const tx = view.getFloat32(byteIdx + 48, true)
      const ty = view.getFloat32(byteIdx + 52, true)
      const tz = view.getFloat32(byteIdx + 56, true)
      // m33 = 1

      // Position
      const posIdx = (frame * segmentCount + seg) * 3
      positions[posIdx] = tx
      positions[posIdx + 1] = ty
      positions[posIdx + 2] = tz

      // Rotation: C3D stores R^T in the upper-left 3x3
      // Transpose to get R (columns = local axes in global coords)
      // Store column-major for Three.js Matrix4 compatibility
      const rotIdx = (frame * segmentCount + seg) * 9
      // Column 0 of R = Row 0 of R^T = [m00, m10, m20] → but transposed = [m00, m01, m02]
      // Wait — C3D row-vector: upper-left is R^T
      // So R = transpose of upper-left = columns of upper-left become rows
      // R[0][0] = m00, R[0][1] = m10, R[0][2] = m20
      // R[1][0] = m01, R[1][1] = m11, R[1][2] = m21
      // R[2][0] = m02, R[2][1] = m12, R[2][2] = m22
      // In column-major order (for Three.js): col0=[R00,R10,R20], col1=[R01,R11,R21], col2=[R02,R12,R22]
      rotations[rotIdx + 0] = m00  // R[0][0]
      rotations[rotIdx + 1] = m01  // R[1][0]
      rotations[rotIdx + 2] = m02  // R[2][0]
      rotations[rotIdx + 3] = m10  // R[0][1]
      rotations[rotIdx + 4] = m11  // R[1][1]
      rotations[rotIdx + 5] = m12  // R[2][1]
      rotations[rotIdx + 6] = m20  // R[0][2]
      rotations[rotIdx + 7] = m21  // R[1][2]
      rotations[rotIdx + 8] = m22  // R[2][2]
    }
  }

  return {
    frameCount,
    frameRate,
    segmentCount,
    segmentLabels,
    positions,
    rotations,
  }
}

/** Get position [x,y,z] for a segment at a given frame */
export function getPosition(data: C3DData, frame: number, segIndex: number): [number, number, number] {
  const i = (frame * data.segmentCount + segIndex) * 3
  return [data.positions[i], data.positions[i + 1], data.positions[i + 2]]
}

/** Get 3x3 rotation matrix (column-major) for a segment at a given frame */
export function getRotation(data: C3DData, frame: number, segIndex: number): Float32Array {
  const i = (frame * data.segmentCount + segIndex) * 9
  return data.rotations.subarray(i, i + 9)
}
