#pragma once

// Copy this file to secrets.h (same folder) and fill in your values.
// secrets.h is ignored by git, so your Wi-Fi password and device token stay local.

// 2.4 GHz Wi-Fi network shared with the laptop running the backend.
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// Backend address as seen from the ESP32: the laptop's LAN IP and port, no trailing slash.
// Start the backend with HOST=0.0.0.0. "localhost" would mean the ESP32 itself.
#define API_BASE_URL "http://192.168.1.10:3000"

// Device token from the website's My devices screen (shown once when the device is added).
#define DEVICE_TOKEN "paste-the-device-token-here"
