// ============================================
// Remote Desktop Service - Configuration
// ============================================

module.exports = {
  // Port the service listens on
  PORT: 9876,

  // Password required to connect (CHANGE THIS!)
  PASSWORD: 'changeme123',

  // Frames per second for screen capture (15-30 recommended)
  FPS: 30,

  // JPEG quality (1-100). Lower = smaller size, faster streaming.
  // 35-55 is the sweet spot for remote desktop.
  JPEG_QUALITY: 45,

  // Allow remote mouse & keyboard control
  ENABLE_INPUT: true,

  // ---- Cloudflare Tunnel ----
  // Enable Cloudflare Tunnel for remote access across networks
  CLOUDFLARE_TUNNEL_ENABLED: true,

  // Tunnel token from Cloudflare Zero Trust dashboard (for permanent subdomain)
  // Leave empty to use a quick tunnel with a random *.trycloudflare.com URL
  // To get a token: https://one.dash.cloudflare.com → Networks → Tunnels → Create
  CLOUDFLARE_TUNNEL_TOKEN: '',

  // Your hostname/subdomain (e.g., 'remote.yourdomain.com')
  // Only used with a tunnel token. Set this to the hostname you configured in the dashboard.
  CLOUDFLARE_TUNNEL_HOSTNAME: '',

  // Service name when installed as Windows Service
  SERVICE_NAME: 'System Network Helper',

  // Service description
  SERVICE_DESCRIPTION: 'Manages network connectivity assistance',
};
