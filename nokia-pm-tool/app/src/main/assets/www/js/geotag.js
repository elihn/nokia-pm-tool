// Geotagging, DMS coordinate conversion, and photo processing service
// 100% offline, zero watermark overlay, EXIF-orientation corrected, 1600px max resize

class GeotagService {
  constructor() {
    this.currentLocation = null;
  }

  // Convert decimal degrees to Telecom DMS format (matching Nokia PDF: -19°41'18,412"S, 47°2'15,414"E)
  static toDMS(coordinate, isLatitude) {
    if (coordinate === undefined || coordinate === null || isNaN(coordinate)) {
      return '';
    }
    const val = parseFloat(coordinate);
    const isNegative = val < 0;
    const abs = Math.abs(val);

    const degrees = Math.floor(abs);
    const minutesNotTruncated = (abs - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = (minutesNotTruncated - minutes) * 60;

    const secondsFormatted = seconds.toFixed(3).replace('.', ',');
    const direction = isLatitude ? (isNegative ? 'S' : 'N') : (isNegative ? 'W' : 'E');
    const signPrefix = isNegative ? '-' : '';

    return `${signPrefix}${degrees}°${minutes}'${secondsFormatted}"${direction}`;
  }

  // Get current GPS for Cover page (using AndroidBridge or Web Geolocation API)
  async getPosition() {
    // 1. Try AndroidBridge first if available
    if (window.AndroidBridge && typeof window.AndroidBridge.getDeviceGps === 'function') {
      try {
        const jsonStr = window.AndroidBridge.getDeviceGps();
        const res = JSON.parse(jsonStr);
        if (res && res.success) {
          this.currentLocation = {
            latitude: res.latitude,
            longitude: res.longitude,
            accuracy: res.accuracy || 10,
            altitude: res.altitude || 0,
            timestamp: Date.now()
          };
          return this.currentLocation;
        }
      } catch (err) {
        console.warn('AndroidBridge GPS query failed:', err);
      }
    }

    // 2. Web Geolocation API
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error('Geolocation is not supported by your browser/device.'));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
            timestamp: pos.timestamp || Date.now()
          };
          resolve(this.currentLocation);
        },
        (err) => {
          console.warn('Geolocation error:', err);
          if (this.currentLocation) {
            resolve(this.currentLocation);
          } else {
            reject(err);
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  // Process photo file:
  // - Preserves original image without stamping any watermark text (TimeStamp Camera handles text)
  // - No GPS query during capture
  // - Corrects EXIF orientation using createImageBitmap(file, { imageOrientation: 'from-image' })
  // - Resizes reasonably (max 1600px on longest side, JPEG quality 0.85) to keep TimeStamp text crisp
  async processPhotoFile(fileOrBlob, maxWidth = 1600, quality = 0.85) {
    let imgBitmap = null;

    // 1. Try createImageBitmap with automatic EXIF orientation
    try {
      imgBitmap = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
    } catch (e1) {
      try {
        imgBitmap = await createImageBitmap(fileOrBlob);
      } catch (e2) {
        // Fallback using HTMLImageElement
        imgBitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(fileOrBlob);
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image: ' + err));
          };
          img.src = url;
        });
      }
    }

    const naturalWidth = imgBitmap.width || imgBitmap.naturalWidth || 1200;
    const naturalHeight = imgBitmap.height || imgBitmap.naturalHeight || 900;

    const maxDim = maxWidth;
    let w = naturalWidth;
    let h = naturalHeight;

    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Draw the image onto canvas with EXIF orientation corrected
    ctx.drawImage(imgBitmap, 0, 0, w, h);

    if (typeof imgBitmap.close === 'function') {
      imgBitmap.close();
    }

    // Export as high-clarity JPEG (preserves TimeStamp text legibility)
    const base64Jpeg = canvas.toDataURL('image/jpeg', quality);

    return {
      base64: base64Jpeg,
      width: w,
      height: h,
      fileName: fileOrBlob.name || 'photo.jpg'
    };
  }

  // Alias for backward compatibility if any legacy caller invokes stampPhoto
  async stampPhoto(imageSource, metadata = {}) {
    return this.processPhotoFile(imageSource, 1600, 0.85);
  }
}

window.geotagService = new GeotagService();
