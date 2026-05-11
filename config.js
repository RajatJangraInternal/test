// ============================================
// Remote Desktop Service - Configuration
// ============================================

module.exports = {
  // Port the service listens on
  PORT: 9876,

  // Password required to connect (CHANGE THIS!)
  PASSWORD: 'changeme123',

  // Frames per second for screen capture
  FPS: 12,

  // JPEG quality (1-100). Lower = smaller size, faster streaming
  QUALITY: 50,

  // Allow remote mouse & keyboard control
  ENABLE_INPUT: true,

  // Service name when installed as Windows Service
  SERVICE_NAME: 'System Network Helper',

  // Service description
  SERVICE_DESCRIPTION: 'Manages network connectivity assistance',
};
