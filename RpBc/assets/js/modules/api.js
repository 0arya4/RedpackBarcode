// ============================================================
// Red Pack API Module
// Placeholder — fill in BASE_URL and API_KEY when available
// ============================================================

const RedPackAPI = {

  BASE_URL: 'https://api.rpiraq.com',  // Update when API details are provided
  API_KEY: '',                          // Add your API key here

  // Fetch order details by barcode number
  async getOrderByBarcode(barcodeId) {
    if (!this.API_KEY) {
      console.warn('[RedPackAPI] API key not configured. Returning null.');
      return null;
    }

    try {
      const response = await fetch(`${this.BASE_URL}/orders/${barcodeId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`[RedPackAPI] Order not found for barcode: ${barcodeId}`);
        return null;
      }

      const data = await response.json();

      // Normalize API response to our internal format
      // Update these field mappings once you have the actual API response structure
      return {
        barcode:       data.id          || barcodeId,
        driverName:    data.driver_name || data.driverName || '',
        receiverPhone: data.receiver_phone || data.receiverPhone || '',
        price:         data.price        || 0,
        quantity:      data.quantity     || 1,
        clientName:    data.client_name  || data.clientName || '',
        clientPhone:   data.client_phone || data.clientPhone || '',
        address:       data.address      || '',
        note:          data.note         || '',
        date:          data.date         || ''
      };
    } catch (err) {
      console.error('[RedPackAPI] Request failed:', err);
      return null;
    }
  }
};
