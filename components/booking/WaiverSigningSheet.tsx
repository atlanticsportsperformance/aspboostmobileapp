import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import { PendingWaiver, SignatureData } from '../../types/waiver';
import { signWaiver } from '../../lib/waiverApi';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;

const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  black: '#0A0A0A',
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  green500: '#22C55E',
  yellow500: '#EAB308',
  red500: '#EF4444',
};

interface WaiverSigningSheetProps {
  visible: boolean;
  waivers: PendingWaiver[];
  athleteId: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function WaiverSigningSheet({
  visible,
  waivers,
  athleteId,
  onClose,
  onComplete,
}: WaiverSigningSheetProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signature states
  const [checkboxAgreed, setCheckboxAgreed] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null);
  const [selectedSignatureType, setSelectedSignatureType] = useState<'checkbox' | 'typed_name' | 'drawn'>('checkbox');

  const webViewRef = useRef<WebView>(null);

  const currentWaiver = waivers[currentIndex];
  const isLastWaiver = currentIndex === waivers.length - 1;

  // Determine which signature type to use
  const signatureType = currentWaiver?.signatureType === 'any'
    ? selectedSignatureType
    : currentWaiver?.signatureType || 'checkbox';

  const resetSignatureState = () => {
    setCheckboxAgreed(false);
    setTypedName('');
    setDrawnSignature(null);
    setSelectedSignatureType('checkbox');
    setError(null);
  };

  const handleSign = async () => {
    if (!currentWaiver) return;

    // Validate signature
    let signatureData: SignatureData;
    switch (signatureType) {
      case 'checkbox':
        if (!checkboxAgreed) {
          setError('Please check the box to agree');
          return;
        }
        signatureData = { agreed: true };
        break;
      case 'typed_name':
        if (!typedName.trim()) {
          setError('Please type your full name');
          return;
        }
        signatureData = { typed_name: typedName.trim() };
        break;
      case 'drawn':
        if (!drawnSignature) {
          setError('Please draw your signature');
          return;
        }
        signatureData = { image_data: drawnSignature };
        break;
      default:
        setError('Invalid signature type');
        return;
    }

    setSigning(true);
    setError(null);

    const result = await signWaiver({
      waiver_id: currentWaiver.id,
      athlete_id: athleteId,
      signature_type: signatureType,
      signature_data: signatureData,
    });

    setSigning(false);

    if (result.success) {
      if (isLastWaiver) {
        onComplete();
      } else {
        resetSignatureState();
        setCurrentIndex(currentIndex + 1);
      }
    } else {
      setError(result.error || 'Failed to sign waiver');
    }
  };

  const handleClose = () => {
    resetSignatureState();
    setCurrentIndex(0);
    onClose();
  };

  // HTML for signature canvas
  const signatureCanvasHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #1F2937;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        canvas {
          background: #374151;
          border-radius: 8px;
          touch-action: none;
        }
        .controls {
          margin-top: 12px;
          display: flex;
          gap: 12px;
        }
        button {
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .clear-btn {
          background: #374151;
          color: #9CA3AF;
          border: 1px solid #4B5563;
        }
      </style>
    </head>
    <body>
      <canvas id="canvas" width="${SCREEN_WIDTH - 80}" height="150"></canvas>
      <div class="controls">
        <button class="clear-btn" onclick="clearCanvas()">Clear</button>
      </div>
      <script>
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        function getPos(e) {
          const rect = canvas.getBoundingClientRect();
          const touch = e.touches ? e.touches[0] : e;
          return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
          };
        }

        function startDrawing(e) {
          isDrawing = true;
          const pos = getPos(e);
          lastX = pos.x;
          lastY = pos.y;
          e.preventDefault();
        }

        function draw(e) {
          if (!isDrawing) return;
          e.preventDefault();
          const pos = getPos(e);
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
          lastX = pos.x;
          lastY = pos.y;
          sendSignature();
        }

        function stopDrawing() {
          isDrawing = false;
          sendSignature();
        }

        function clearCanvas() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'clear' }));
        }

        function sendSignature() {
          const dataUrl = canvas.toDataURL('image/png');
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'signature', data: dataUrl }));
        }

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
      </script>
    </body>
    </html>
  `;

  const handleWebViewMessage = (event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'signature') {
        setDrawnSignature(message.data);
      } else if (message.type === 'clear') {
        setDrawnSignature(null);
      }
    } catch (e) {
      console.error('Error parsing WebView message:', e);
    }
  };

  const renderSignatureInput = () => {
    // If waiver allows any signature type, show selector
    if (currentWaiver?.signatureType === 'any') {
      return (
        <View>
          <Text style={styles.signatureLabel}>Choose signature method:</Text>
          <View style={styles.signatureTypeSelector}>
            {(['checkbox', 'typed_name', 'drawn'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.signatureTypeButton,
                  selectedSignatureType === type && styles.signatureTypeButtonActive,
                ]}
                onPress={() => setSelectedSignatureType(type)}
              >
                <Ionicons
                  name={
                    type === 'checkbox' ? 'checkbox-outline' :
                    type === 'typed_name' ? 'text-outline' : 'pencil-outline'
                  }
                  size={18}
                  color={selectedSignatureType === type ? COLORS.black : COLORS.gray400}
                />
                <Text style={[
                  styles.signatureTypeText,
                  selectedSignatureType === type && styles.signatureTypeTextActive,
                ]}>
                  {type === 'checkbox' ? 'Checkbox' :
                   type === 'typed_name' ? 'Type Name' : 'Draw'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {renderSignatureField()}
        </View>
      );
    }

    return renderSignatureField();
  };

  const renderSignatureField = () => {
    switch (signatureType) {
      case 'checkbox':
        return (
          <TouchableOpacity
            style={styles.checkboxContainer}
            onPress={() => setCheckboxAgreed(!checkboxAgreed)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, checkboxAgreed && styles.checkboxChecked]}>
              {checkboxAgreed && (
                <Ionicons name="checkmark" size={16} color={COLORS.black} />
              )}
            </View>
            <Text style={styles.checkboxLabel}>
              I have read and agree to the terms above
            </Text>
          </TouchableOpacity>
        );

      case 'typed_name':
        return (
          <View style={styles.typedNameContainer}>
            <Text style={styles.signatureLabel}>Type your full legal name:</Text>
            <TextInput
              style={styles.typedNameInput}
              value={typedName}
              onChangeText={setTypedName}
              placeholder="Your Full Name"
              placeholderTextColor={COLORS.gray500}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>
        );

      case 'drawn':
        return (
          <View style={styles.drawnContainer}>
            <Text style={styles.signatureLabel}>Draw your signature below:</Text>
            <View style={styles.canvasContainer}>
              <WebView
                ref={webViewRef}
                source={{ html: signatureCanvasHtml }}
                style={styles.webView}
                scrollEnabled={false}
                bounces={false}
                onMessage={handleWebViewMessage}
              />
            </View>
            {drawnSignature && (
              <View style={styles.signaturePreview}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.green500} />
                <Text style={styles.signaturePreviewText}>Signature captured</Text>
              </View>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  // Simple HTML content renderer (strips tags for basic display)
  const renderWaiverContent = (html: string) => {
    // Basic HTML to text conversion for display
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    return text;
  };

  if (!visible || !currentWaiver) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Ionicons name="document-text" size={20} color={COLORS.yellow500} />
                <Text style={styles.headerTitle}>
                  Waiver {currentIndex + 1} of {waivers.length}
                </Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                <Ionicons name="close" size={24} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>

            {/* Progress bar */}
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${((currentIndex + 1) / waivers.length) * 100}%` },
                ]}
              />
            </View>

            {/* Waiver Name */}
            <Text style={styles.waiverName}>{currentWaiver.name}</Text>
            {currentWaiver.description && (
              <Text style={styles.waiverDescription}>{currentWaiver.description}</Text>
            )}

            {/* Waiver Content */}
            <ScrollView style={styles.contentScroll} showsVerticalScrollIndicator={true}>
              <View style={styles.contentCard}>
                <Text style={styles.waiverContent}>
                  {renderWaiverContent(currentWaiver.content)}
                </Text>
              </View>
            </ScrollView>

            {/* Signature Section */}
            <View style={styles.signatureSection}>
              {renderSignatureInput()}

              {error && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={16} color={COLORS.red500} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </View>

            {/* Action Button */}
            <TouchableOpacity
              style={styles.signButton}
              onPress={handleSign}
              disabled={signing}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                style={styles.signButtonGradient}
              >
                {signing ? (
                  <ActivityIndicator size="small" color={COLORS.black} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.black} />
                    <Text style={styles.signButtonText}>
                      {isLastWaiver ? 'Sign & Continue to Booking' : 'Sign & Continue'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.black,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_HEIGHT * 0.9,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  closeButton: {
    padding: 4,
  },
  progressBar: {
    height: 3,
    backgroundColor: COLORS.gray800,
    marginHorizontal: 20,
    borderRadius: 2,
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  waiverName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  waiverDescription: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  contentScroll: {
    maxHeight: SCREEN_HEIGHT * 0.35,
    marginHorizontal: 20,
  },
  contentCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  waiverContent: {
    fontSize: 14,
    color: COLORS.gray400,
    lineHeight: 22,
  },
  signatureSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  signatureLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 12,
  },
  signatureTypeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  signatureTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  signatureTypeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  signatureTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray400,
  },
  signatureTypeTextActive: {
    color: COLORS.black,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.gray500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.white,
  },
  typedNameContainer: {
    gap: 8,
  },
  typedNameInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    fontStyle: 'italic',
    color: COLORS.white,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  drawnContainer: {
    gap: 8,
  },
  canvasContainer: {
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  signaturePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signaturePreviewText: {
    fontSize: 12,
    color: COLORS.green500,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.red500,
  },
  signButton: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  signButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  signButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.black,
  },
});
