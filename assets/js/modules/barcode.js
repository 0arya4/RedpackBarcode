// ============================================================
// Barcode Scanner Module
// Uses html5-qrcode library to scan barcodes via phone camera
// Supports: Code128, Code39, EAN-13, EAN-8 (standard delivery barcodes)
// ============================================================

const BarcodeScanner = {

  scanner: null,
  isScanning: false,

  // Start scanning inside a given element ID
  async start(elementId, onSuccess) {
    if (this.isScanning) await this.stop();

    this.scanner = new Html5Qrcode(elementId);

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 120 },
      aspectRatio: 1.5,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
      ]
    };

    try {
      await this.scanner.start(
        { facingMode: 'environment' }, // Use back camera
        config,
        (decodedText) => {
          // Success — pass result and stop scanner
          Utils.vibrate();
          onSuccess(decodedText.trim());
        },
        () => {} // Ignore frame errors (normal during scanning)
      );
      this.isScanning = true;
    } catch (err) {
      console.error('[BarcodeScanner] Failed to start camera:', err);
      Utils.showToast('لەتوانای کامێرا نییە. مۆڵەت بدە.', 'error');
      throw err;
    }
  },

  // Stop the scanner and release camera
  async stop() {
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
        this.scanner.clear();
      } catch (e) {
        // Already stopped
      }
      this.isScanning = false;
      this.scanner = null;
    }
  }
};
